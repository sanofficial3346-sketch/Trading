import { NormalizedMarketCandle } from '../marketData/mexcPublicMarketClient';
import {
  StructurePoint,
  StructurePointType,
  StructureStrength,
  StructureState,
  StructureParameters,
  StructureDetectionResult,
  StructuralRange,
  StructuralRangeBoundary,
  TypedStructuralAnchor,
  BearishRange,
  BullishRange,
  createBearishRange,
  createBullishRange,
  assertBearishRange,
  assertBullishRange,
  StructureBreakEvent,
  ActiveRetracementInfo,
  InitializationStructureResult,
  StructureEventLogItem,
  ALGORITHM_VERSION_V6,
  ALGORITHM_VERSION_V6_REV2,
  assertSingleStructureType,
} from './structureTypes';
import {
  StructureDecisionAudit,
  RejectedStructureEvent,
  CandleReplayStep,
  EngineStateSnapshot,
} from './structureAuditTypes';

interface InitialRangeDiscovery {
  direction: 'BULLISH' | 'BEARISH';
  topPrice: number;
  topCandle: NormalizedMarketCandle;
  topIndex: number;
  bottomPrice: number;
  bottomCandle: NormalizedMarketCandle;
  bottomIndex: number;
}

/**
 * STRUCTURE_V6_FIB_QUALIFIED_RANGE Engine (REV2)
 *
 * STRICT EXTERNAL MARKET STRUCTURE ENGINE
 *
 * Core Specification & Invariants:
 * 1. Body-close break of active range boundary begins an expansion candidate leg.
 *    No confirmed structural points are generated upon break.
 * 2. Mandatory Retracement Qualification:
 *    - Minimum retracement candle count (default: 4 candles from candidate extreme).
 *    - Minimum Fibonacci depth (default: 0.382 from active anchor to candidate extreme).
 *    - Wick touching or exceeding 0.382 satisfies Fib requirement.
 * 3. Same-Leg Extension:
 *    - If price makes another extreme in continuation direction before qualifying retracement,
 *      extend candidate extreme and recalculate Fib from anchor.
 * 4. Confirmation:
 *    - ONLY when BOTH candle count >= 4 AND Fib >= 0.382 are satisfied:
 *      Confirm candidate extreme and qualifying intervening anchor.
 *      Lock new range: LH <-> LL or HL <-> HH.
 * 5. Reversals:
 *    - When active LH is broken by candle CLOSE, upward impulse is a Bullish HH candidate.
 *      Fib anchor = previous confirmed LL.
 *    - When active HL is broken by candle CLOSE, downward impulse is a Bearish LL candidate.
 *      Fib anchor = previous confirmed HH.
 * 6. Swing Alternation Invariant:
 *    - LL -> LH -> LL (LH = highest candle high between previous LL and new LL).
 *    - HH -> HL -> HH (HL = lowest candle low between previous HH and new HH).
 * 7. Hard Wick Gate:
 *    - Wick breaches without body close are strictly logged to rejectedEvents and ignored.
 * 8. Clean Chart:
 *    - Confirmed points contain strictly ONE type: HH, HL, LH, or LL.
 */
export function detectStructureV6FibQualifiedRange(
  allCandles: NormalizedMarketCandle[],
  customParams?: Partial<StructureParameters>
): StructureDetectionResult {
  const startTime = Date.now();
  const effectiveAlgorithmVersion = customParams?.algorithmVersion ?? ALGORITHM_VERSION_V6_REV2;

  const analysisCandles = Math.max(
    50,
    Math.min(1000, customParams?.analysisCandles ?? 280)
  );
  const warmUpCandles = Math.max(
    0,
    Math.min(200, customParams?.initializationSearchCandles ?? customParams?.warmUpCandles ?? 70)
  );
  const minRetracementCandles = Math.max(
    1,
    Math.min(20, customParams?.minimumRetracementCandles ?? 4)
  );
  const minRetracementFib = Math.max(
    0.1,
    Math.min(0.9, customParams?.minimumRetracementFib ?? 0.382)
  );
  const lookback = analysisCandles + warmUpCandles;

  // Filter closed candles only
  const closedCandles = allCandles.filter((c) => c.isClosed !== false);
  const totalAvailable = closedCandles.length;
  const startIndex = Math.max(0, totalAvailable - lookback);
  const evaluationCandles = closedCandles.slice(startIndex);

  if (evaluationCandles.length < 2) {
    return createEmptyV6Result(startTime, effectiveAlgorithmVersion, minRetracementCandles, minRetracementFib);
  }

  const mainAnalysisStartIndex = Math.min(warmUpCandles, evaluationCandles.length - 1);
  const mainStartTimeStr = evaluationCandles[mainAnalysisStartIndex]?.openTime ?? null;

  // Output containers
  const points: StructurePoint[] = [];
  const ranges: StructuralRange[] = [];
  const breakEvents: StructureBreakEvent[] = [];
  const eventLogs: StructureEventLogItem[] = [];
  const audits: StructureDecisionAudit[] = [];
  const rejectedEvents: RejectedStructureEvent[] = [];
  const candleReplaySteps: CandleReplayStep[] = [];

  let rangeSequenceIndex = 0;
  let activeRange: StructuralRange | null = null;
  let currentState: StructureState = StructureState.UNDEFINED;

  // Phase tracking
  let currentPhase: 'RANGE_LOCKED' | 'EXPANSION_CANDIDATE' = 'RANGE_LOCKED';

  // Candidate leg state
  let candidateExtremeType: StructurePointType | null = null;
  let candidateExtremePrice = 0;
  let candidateExtremeCandle: NormalizedMarketCandle | null = null;
  let candidateExtremeIndex = -1;

  // Fib anchor state
  let fibAnchorPrice = 0;
  let fibAnchorCandle: NormalizedMarketCandle | StructuralRangeBoundary | null = null;
  let fibAnchorLabel = '';

  // Retracement tracking state
  let retracementExtremePrice = 0;
  let retracementExtremeCandle: NormalizedMarketCandle | null = null;
  let retracementExtremeIndex = -1;

  // Active confirmed anchors
  let lastConfirmedLHPoint: StructurePoint | null = null;
  let lastConfirmedHLPoint: StructurePoint | null = null;
  let lastConfirmedLLPoint: StructurePoint | null = null;
  let lastConfirmedHHPoint: StructurePoint | null = null;

  // ==========================================
  // INITIALIZATION / SEEDING
  // ==========================================
  const initializationLogs: string[] = [];
  let initResult: InitializationStructureResult;

  if (customParams?.manualStart) {
    const ms = customParams.manualStart;
    initializationLogs.push(`MANUAL INITIALIZATION: Seeding ${ms.direction} starting structure.`);
    rangeSequenceIndex++;
    const rangeId = `${ms.direction}_RANGE_${rangeSequenceIndex}`;

    if (ms.direction === 'BEARISH') {
      const lhAnchor: TypedStructuralAnchor<StructurePointType.LH> = {
        type: StructurePointType.LH,
        price: ms.top.price,
        candleTime: ms.top.candleTime,
        candleTimeUnix: ms.top.candleTimeUnix ?? new Date(ms.top.candleTime).getTime(),
        candleIndex: ms.top.candleIndex ?? 0,
        label: `LH${rangeSequenceIndex}`,
        rangeId,
      };
      const llAnchor: TypedStructuralAnchor<StructurePointType.LL> = {
        type: StructurePointType.LL,
        price: ms.bottom.price,
        candleTime: ms.bottom.candleTime,
        candleTimeUnix: ms.bottom.candleTimeUnix ?? new Date(ms.bottom.candleTime).getTime(),
        candleIndex: ms.bottom.candleIndex ?? 1,
        label: `LL${rangeSequenceIndex}`,
        rangeId,
      };
      activeRange = createBearishRange(lhAnchor, llAnchor, rangeId, rangeSequenceIndex);
      currentState = StructureState.BEARISH;

      const p1 = createPointFromBoundary(lhAnchor, rangeId, 'BEARISH', true, false, effectiveAlgorithmVersion);
      const p2 = createPointFromBoundary(llAnchor, rangeId, 'BEARISH', false, true, effectiveAlgorithmVersion);
      points.push(p1, p2);
      lastConfirmedLHPoint = p1;
      lastConfirmedLLPoint = p2;
    } else {
      const hhAnchor: TypedStructuralAnchor<StructurePointType.HH> = {
        type: StructurePointType.HH,
        price: ms.top.price,
        candleTime: ms.top.candleTime,
        candleTimeUnix: ms.top.candleTimeUnix ?? new Date(ms.top.candleTime).getTime(),
        candleIndex: ms.top.candleIndex ?? 0,
        label: `HH${rangeSequenceIndex}`,
        rangeId,
      };
      const hlAnchor: TypedStructuralAnchor<StructurePointType.HL> = {
        type: StructurePointType.HL,
        price: ms.bottom.price,
        candleTime: ms.bottom.candleTime,
        candleTimeUnix: ms.bottom.candleTimeUnix ?? new Date(ms.bottom.candleTime).getTime(),
        candleIndex: ms.bottom.candleIndex ?? 1,
        label: `HL${rangeSequenceIndex}`,
        rangeId,
      };
      activeRange = createBullishRange(hhAnchor, hlAnchor, rangeId, rangeSequenceIndex);
      currentState = StructureState.BULLISH;

      const p1 = createPointFromBoundary(hhAnchor, rangeId, 'BULLISH', true, false, effectiveAlgorithmVersion);
      const p2 = createPointFromBoundary(hlAnchor, rangeId, 'BULLISH', false, true, effectiveAlgorithmVersion);
      points.push(p1, p2);
      lastConfirmedHHPoint = p1;
      lastConfirmedHLPoint = p2;
    }
    ranges.push(activeRange);
    initResult = {
      initialState: currentState,
      initialSequence: currentState === StructureState.BEARISH ? 'LH → LL' : 'HL → HH',
      warmUpCandlesUsed: 0,
      usedWarmUp: false,
      initialTrend: currentState,
      candlesEvaluated: evaluationCandles.length,
      warmUpCandlesCount: 0,
      initialFoundAt: activeRange.top.candleTime,
      initialFoundTimeUnix: activeRange.top.candleTimeUnix,
      initialLH: activeRange.direction === 'BEARISH' ? activeRange.top.price : null,
      initialLL: activeRange.direction === 'BEARISH' ? activeRange.bottom.price : null,
      initialHH: activeRange.direction === 'BULLISH' ? activeRange.top.price : null,
      initialHL: activeRange.direction === 'BULLISH' ? activeRange.bottom.price : null,
      warmUpStartIndex: 0,
      mainAnalysisStartIndex: 0,
      mainAnalysisStartTime: evaluationCandles[0]?.openTime ?? null,
      warmUpCandlesMax: 0,
      initializationLogs,
    };
  } else {
    // Standard Warm-Up Initial External Range Discovery
    const warmUpSlice = evaluationCandles.slice(0, warmUpCandles > 0 ? warmUpCandles : 30);
    const discovered = discoverInitialExternalRange(warmUpSlice);

    if (discovered) {
      rangeSequenceIndex++;
      const rangeId = `${discovered.direction}_RANGE_${rangeSequenceIndex}`;
      initializationLogs.push(
        `Discovered ${discovered.direction} starting range: Top=${discovered.topPrice.toFixed(2)} (${discovered.topCandle.openTime}), Bottom=${discovered.bottomPrice.toFixed(2)} (${discovered.bottomCandle.openTime}).`
      );

      if (discovered.direction === 'BEARISH') {
        const lhAnchor: TypedStructuralAnchor<StructurePointType.LH> = {
          type: StructurePointType.LH,
          price: discovered.topPrice,
          candleTime: discovered.topCandle.openTime,
          candleTimeUnix: discovered.topCandle.openTimeUnix,
          candleIndex: discovered.topIndex,
          label: `LH${rangeSequenceIndex}`,
          rangeId,
        };
        const llAnchor: TypedStructuralAnchor<StructurePointType.LL> = {
          type: StructurePointType.LL,
          price: discovered.bottomPrice,
          candleTime: discovered.bottomCandle.openTime,
          candleTimeUnix: discovered.bottomCandle.openTimeUnix,
          candleIndex: discovered.bottomIndex,
          label: `LL${rangeSequenceIndex}`,
          rangeId,
        };
        activeRange = createBearishRange(lhAnchor, llAnchor, rangeId, rangeSequenceIndex);
        currentState = StructureState.BEARISH;

        const p1 = createPointFromBoundary(lhAnchor, rangeId, 'BEARISH', true, false, effectiveAlgorithmVersion);
        const p2 = createPointFromBoundary(llAnchor, rangeId, 'BEARISH', false, true, effectiveAlgorithmVersion);
        p1.isWarmUpAnchor = true;
        p2.isWarmUpAnchor = true;
        points.push(p1, p2);
        lastConfirmedLHPoint = p1;
        lastConfirmedLLPoint = p2;
      } else {
        const hhAnchor: TypedStructuralAnchor<StructurePointType.HH> = {
          type: StructurePointType.HH,
          price: discovered.topPrice,
          candleTime: discovered.topCandle.openTime,
          candleTimeUnix: discovered.topCandle.openTimeUnix,
          candleIndex: discovered.topIndex,
          label: `HH${rangeSequenceIndex}`,
          rangeId,
        };
        const hlAnchor: TypedStructuralAnchor<StructurePointType.HL> = {
          type: StructurePointType.HL,
          price: discovered.bottomPrice,
          candleTime: discovered.bottomCandle.openTime,
          candleTimeUnix: discovered.bottomCandle.openTimeUnix,
          candleIndex: discovered.bottomIndex,
          label: `HL${rangeSequenceIndex}`,
          rangeId,
        };
        activeRange = createBullishRange(hhAnchor, hlAnchor, rangeId, rangeSequenceIndex);
        currentState = StructureState.BULLISH;

        const p1 = createPointFromBoundary(hhAnchor, rangeId, 'BULLISH', true, false, effectiveAlgorithmVersion);
        const p2 = createPointFromBoundary(hlAnchor, rangeId, 'BULLISH', false, true, effectiveAlgorithmVersion);
        p1.isWarmUpAnchor = true;
        p2.isWarmUpAnchor = true;
        points.push(p1, p2);
        lastConfirmedHHPoint = p1;
        lastConfirmedHLPoint = p2;
      }
      ranges.push(activeRange);
      initResult = {
        initialState: currentState,
        initialSequence: currentState === StructureState.BEARISH ? 'LH → LL' : 'HL → HH',
        warmUpCandlesUsed: warmUpSlice.length,
        usedWarmUp: true,
        initialTrend: currentState,
        candlesEvaluated: evaluationCandles.length,
        warmUpCandlesCount: warmUpSlice.length,
        initialFoundAt: activeRange.top.candleTime,
        initialFoundTimeUnix: activeRange.top.candleTimeUnix,
        initialLH: activeRange.direction === 'BEARISH' ? activeRange.top.price : null,
        initialLL: activeRange.direction === 'BEARISH' ? activeRange.bottom.price : null,
        initialHH: activeRange.direction === 'BULLISH' ? activeRange.top.price : null,
        initialHL: activeRange.direction === 'BULLISH' ? activeRange.bottom.price : null,
        warmUpStartIndex: 0,
        mainAnalysisStartIndex,
        mainAnalysisStartTime: mainStartTimeStr,
        warmUpCandlesMax: warmUpCandles,
        initializationLogs,
      };
    } else {
      initResult = {
        initialState: StructureState.UNDEFINED,
        initialSequence: 'NONE',
        warmUpCandlesUsed: 0,
        usedWarmUp: false,
        initialTrend: StructureState.UNDEFINED,
        candlesEvaluated: evaluationCandles.length,
        warmUpCandlesCount: 0,
        initialFoundAt: null,
        initialFoundTimeUnix: null,
        initialLH: null,
        initialLL: null,
        initialHH: null,
        initialHL: null,
        warmUpStartIndex: 0,
        mainAnalysisStartIndex,
        mainAnalysisStartTime: mainStartTimeStr,
        warmUpCandlesMax: warmUpCandles,
        initializationLogs,
      };
    }
  }

  // Determine loop start: process candles following the initial anchor formations
  const initialAnchorMaxIdx = activeRange
    ? Math.max(activeRange.top.candleIndex ?? 0, activeRange.bottom.candleIndex ?? 0)
    : 0;
  const loopStart = Math.max(1, initialAnchorMaxIdx + 1);

  // Fill replay steps for warm-up candles
  for (let w = 0; w < loopStart; w++) {
    const c = evaluationCandles[w];
    recordStep(
      candleReplaySteps,
      w,
      c,
      currentState,
      currentPhase,
      activeRange,
      ['Warm-up initialization range setup.'],
      null,
      null
    );
  }

  // ==========================================
  // MAIN ANALYSIS LOOP (Chronological, 1 pass)
  // ==========================================
  for (let i = loopStart; i < evaluationCandles.length; i++) {
    const candle = evaluationCandles[i];
    const decisionTrace: string[] = [];
    let breakIdThisCandle: string | null = null;
    let pointCreatedThisCandle: string | null = null;

    if (!activeRange) {
      // Fallback if no initial range could be locked
      recordStep(
        candleReplaySteps,
        i,
        candle,
        currentState,
        currentPhase,
        null,
        ['Awaiting initial external range discovery.'],
        null,
        null
      );
      continue;
    }

    // ----------------------------------------------------
    // PHASE 1: RANGE_LOCKED
    // ----------------------------------------------------
    if (currentPhase === 'RANGE_LOCKED') {
      if (activeRange.direction === 'BEARISH') {
        const activeLH = activeRange.top.price;
        const activeLL = activeRange.bottom.price;

        // Continuation Break (close < activeLL)
        if (candle.close < activeLL) {
          const breakId = `break_bear_cont_${activeRange.rangeId}_${candle.openTimeUnix}`;
          breakIdThisCandle = breakId;
          decisionTrace.push(
            `BEARISH CONTINUATION BREAK: Candle closed at ${candle.close.toFixed(2)} < active LL (${activeLL.toFixed(2)}).`
          );

          breakEvents.push({
            id: breakId,
            candleTime: candle.openTime,
            candleTimeUnix: candle.openTimeUnix,
            candleIndex: i,
            price: candle.close,
            brokenLevel: activeLL,
            breakType: 'BEARISH_CONTINUATION',
            label: `BEARISH CONTINUATION (${activeRange.bottom.label})`,
            regimeId: activeRange.rangeId,
          });

          activeRange.status = 'BROKEN_CONTINUATION';
          activeRange.endedAt = candle.openTime;
          activeRange.endedAtUnix = candle.openTimeUnix;
          activeRange.breakEventId = breakId;
          activeRange.breakCandleTime = candle.openTime;
          activeRange.breakCandleClose = candle.close;

          currentPhase = 'EXPANSION_CANDIDATE';
          candidateExtremeType = StructurePointType.LL;
          candidateExtremePrice = candle.low;
          candidateExtremeCandle = candle;
          candidateExtremeIndex = i;

          fibAnchorPrice = activeRange.top.price;
          fibAnchorCandle = activeRange.top;
          fibAnchorLabel = activeRange.top.label;

          retracementExtremePrice = -Infinity;
          retracementExtremeCandle = null;
          retracementExtremeIndex = -1;
        }
        // Reversal Break (close > activeLH)
        else if (candle.close > activeLH) {
          const breakId = `break_bear_rev_${activeRange.rangeId}_${candle.openTimeUnix}`;
          breakIdThisCandle = breakId;
          decisionTrace.push(
            `BULLISH REVERSAL BREAK: Candle closed at ${candle.close.toFixed(2)} > active LH (${activeLH.toFixed(2)}).`
          );

          breakEvents.push({
            id: breakId,
            candleTime: candle.openTime,
            candleTimeUnix: candle.openTimeUnix,
            candleIndex: i,
            price: candle.close,
            brokenLevel: activeLH,
            breakType: 'BEARISH_STRUCTURE_BROKEN',
            label: `BEARISH BROKEN (${activeRange.top.label})`,
            regimeId: activeRange.rangeId,
          });

          activeRange.status = 'BROKEN_REVERSAL';
          activeRange.endedAt = candle.openTime;
          activeRange.endedAtUnix = candle.openTimeUnix;
          activeRange.breakEventId = breakId;
          activeRange.breakCandleTime = candle.openTime;
          activeRange.breakCandleClose = candle.close;

          // Reversal to Bullish Expansion Candidate
          currentPhase = 'EXPANSION_CANDIDATE';
          candidateExtremeType = StructurePointType.HH;
          candidateExtremePrice = candle.high;
          candidateExtremeCandle = candle;
          candidateExtremeIndex = i;

          // Anchor for Bullish Reversal = previous confirmed LL
          fibAnchorPrice = activeRange.bottom.price;
          fibAnchorCandle = activeRange.bottom;
          fibAnchorLabel = activeRange.bottom.label;

          retracementExtremePrice = Infinity;
          retracementExtremeCandle = null;
          retracementExtremeIndex = -1;
        }
        // Wick breach checks (Logged to rejected events)
        else {
          if (candle.low < activeLL) {
            recordWickRejection(
              rejectedEvents,
              candle,
              i,
              activeLL,
              candle.low,
              activeRange.rangeId,
              'REJECTED_LOW',
              `Wick touched ${candle.low.toFixed(2)} < LL ${activeLL.toFixed(2)}, but close ${candle.close.toFixed(2)} remained inside.`
            );
          }
          if (candle.high > activeLH) {
            recordWickRejection(
              rejectedEvents,
              candle,
              i,
              activeLH,
              candle.high,
              activeRange.rangeId,
              'REJECTED_HIGH',
              `Wick touched ${candle.high.toFixed(2)} > LH ${activeLH.toFixed(2)}, but close ${candle.close.toFixed(2)} remained inside.`
            );
          }
          decisionTrace.push('Internal price action: candle inside locked bearish range boundaries.');
        }
      } else {
        // Bullish Range Active
        const activeHH = activeRange.top.price;
        const activeHL = activeRange.bottom.price;

        // Continuation Break (close > activeHH)
        if (candle.close > activeHH) {
          const breakId = `break_bull_cont_${activeRange.rangeId}_${candle.openTimeUnix}`;
          breakIdThisCandle = breakId;
          decisionTrace.push(
            `BULLISH CONTINUATION BREAK: Candle closed at ${candle.close.toFixed(2)} > active HH (${activeHH.toFixed(2)}).`
          );

          breakEvents.push({
            id: breakId,
            candleTime: candle.openTime,
            candleTimeUnix: candle.openTimeUnix,
            candleIndex: i,
            price: candle.close,
            brokenLevel: activeHH,
            breakType: 'BULLISH_CONTINUATION',
            label: `BULLISH CONTINUATION (${activeRange.top.label})`,
            regimeId: activeRange.rangeId,
          });

          activeRange.status = 'BROKEN_CONTINUATION';
          activeRange.endedAt = candle.openTime;
          activeRange.endedAtUnix = candle.openTimeUnix;
          activeRange.breakEventId = breakId;
          activeRange.breakCandleTime = candle.openTime;
          activeRange.breakCandleClose = candle.close;

          currentPhase = 'EXPANSION_CANDIDATE';
          candidateExtremeType = StructurePointType.HH;
          candidateExtremePrice = candle.high;
          candidateExtremeCandle = candle;
          candidateExtremeIndex = i;

          fibAnchorPrice = activeRange.bottom.price;
          fibAnchorCandle = activeRange.bottom;
          fibAnchorLabel = activeRange.bottom.label;

          retracementExtremePrice = Infinity;
          retracementExtremeCandle = null;
          retracementExtremeIndex = -1;
        }
        // Reversal Break (close < activeHL)
        else if (candle.close < activeHL) {
          const breakId = `break_bull_rev_${activeRange.rangeId}_${candle.openTimeUnix}`;
          breakIdThisCandle = breakId;
          decisionTrace.push(
            `BEARISH REVERSAL BREAK: Candle closed at ${candle.close.toFixed(2)} < active HL (${activeHL.toFixed(2)}).`
          );

          breakEvents.push({
            id: breakId,
            candleTime: candle.openTime,
            candleTimeUnix: candle.openTimeUnix,
            candleIndex: i,
            price: candle.close,
            brokenLevel: activeHL,
            breakType: 'BULLISH_STRUCTURE_BROKEN',
            label: `BULLISH BROKEN (${activeRange.bottom.label})`,
            regimeId: activeRange.rangeId,
          });

          activeRange.status = 'BROKEN_REVERSAL';
          activeRange.endedAt = candle.openTime;
          activeRange.endedAtUnix = candle.openTimeUnix;
          activeRange.breakEventId = breakId;
          activeRange.breakCandleTime = candle.openTime;
          activeRange.breakCandleClose = candle.close;

          // Reversal to Bearish Expansion Candidate
          currentPhase = 'EXPANSION_CANDIDATE';
          candidateExtremeType = StructurePointType.LL;
          candidateExtremePrice = candle.low;
          candidateExtremeCandle = candle;
          candidateExtremeIndex = i;

          // Anchor for Bearish Reversal = previous confirmed HH
          fibAnchorPrice = activeRange.top.price;
          fibAnchorCandle = activeRange.top;
          fibAnchorLabel = activeRange.top.label;

          retracementExtremePrice = -Infinity;
          retracementExtremeCandle = null;
          retracementExtremeIndex = -1;
        }
        // Wick breach checks
        else {
          if (candle.high > activeHH) {
            recordWickRejection(
              rejectedEvents,
              candle,
              i,
              activeHH,
              candle.high,
              activeRange.rangeId,
              'REJECTED_HIGH',
              `Wick touched ${candle.high.toFixed(2)} > HH ${activeHH.toFixed(2)}, but close ${candle.close.toFixed(2)} remained inside.`
            );
          }
          if (candle.low < activeHL) {
            recordWickRejection(
              rejectedEvents,
              candle,
              i,
              activeHL,
              candle.low,
              activeRange.rangeId,
              'REJECTED_LOW',
              `Wick touched ${candle.low.toFixed(2)} < HL ${activeHL.toFixed(2)}, but close ${candle.close.toFixed(2)} remained inside.`
            );
          }
          decisionTrace.push('Internal price action: candle inside locked bullish range boundaries.');
        }
      }
    }
    // ----------------------------------------------------
    // PHASE 2: EXPANSION_CANDIDATE
    // ----------------------------------------------------
    else if (currentPhase === 'EXPANSION_CANDIDATE') {
      if (candidateExtremeType === StructurePointType.LL) {
        // Check opposing reversal break above fibAnchorPrice
        if (candle.close > fibAnchorPrice) {
          decisionTrace.push(
            `OPPOSING REVERSAL: Close ${candle.close.toFixed(2)} > anchor ${fibAnchorPrice.toFixed(2)}. Aborting bearish leg.`
          );
          candidateExtremeType = StructurePointType.HH;
          fibAnchorPrice = candidateExtremePrice;
          candidateExtremePrice = candle.high;
          candidateExtremeCandle = candle;
          candidateExtremeIndex = i;
          retracementExtremePrice = Infinity;
          retracementExtremeCandle = null;
          retracementExtremeIndex = -1;
        }
        // Same-leg extension downward
        else if (candle.low < candidateExtremePrice) {
          candidateExtremePrice = candle.low;
          candidateExtremeCandle = candle;
          candidateExtremeIndex = i;
          retracementExtremePrice = -Infinity;
          retracementExtremeCandle = null;
          retracementExtremeIndex = -1;
          decisionTrace.push(
            `SAME-LEG EXTENSION: Candidate LL extended to ${candle.low.toFixed(2)}. Reset retracement tracking.`
          );
        }
        // Retracement tracking
        else {
          if (candle.high > retracementExtremePrice) {
            retracementExtremePrice = candle.high;
            retracementExtremeCandle = candle;
            retracementExtremeIndex = i;
          }
          const retracementCandles = i - candidateExtremeIndex;
          const fibRange = Math.max(1e-6, fibAnchorPrice - candidateExtremePrice);
          const fibRequiredPrice = candidateExtremePrice + minRetracementFib * fibRange;
          const actualFibDepth = (retracementExtremePrice - candidateExtremePrice) / fibRange;
          const isFibQualified = retracementExtremePrice >= fibRequiredPrice;
          const isCandleCountQualified = retracementCandles >= minRetracementCandles;

          decisionTrace.push(
            `RETRACEMENT: Peak=${retracementExtremePrice.toFixed(2)}, Candles=${retracementCandles}/${minRetracementCandles}, Fib=${(actualFibDepth * 100).toFixed(1)}%/${(minRetracementFib * 100).toFixed(1)}%.`
          );

          if (isFibQualified && isCandleCountQualified) {
            // CONFIRM BEARISH STRUCTURAL CYCLE
            rangeSequenceIndex++;
            const newRangeId = `BEARISH_RANGE_${rangeSequenceIndex}`;
            decisionTrace.push(
              `CONFIRMED BEARISH CYCLE: Both candle count (${retracementCandles}) and Fib (${(actualFibDepth * 100).toFixed(1)}%) qualified!`
            );

            // Invariant: Never allow LL -> LL without an LH.
            // When a new LL confirms, set LH = HIGHEST candle HIGH between previous LL and new LL.
            const prevLLIdx = activeRange.bottom.candleIndex ?? 0;
            let highestBetween = -Infinity;
            let highestCandleBetween: NormalizedMarketCandle | null = null;
            let highestIdxBetween = -1;

            for (let k = prevLLIdx; k <= candidateExtremeIndex; k++) {
              const kc = evaluationCandles[k];
              if (kc && kc.high > highestBetween) {
                highestBetween = kc.high;
                highestCandleBetween = kc;
                highestIdxBetween = k;
              }
            }

            if (
              highestCandleBetween &&
              highestIdxBetween > prevLLIdx &&
              highestIdxBetween < candidateExtremeIndex
            ) {
              const interveningLH: StructurePoint = {
                id: `v6_LH_${rangeSequenceIndex}_${highestCandleBetween.openTimeUnix}`,
                eventId: `v6_LH_${rangeSequenceIndex}_${highestCandleBetween.openTimeUnix}`,
                symbol: candle.symbol,
                timeframe: candle.timeframe,
                candleOpenTime: highestCandleBetween.openTime,
                candleOpenTimeUnix: highestCandleBetween.openTimeUnix,
                candleIndex: highestIdxBetween,
                type: StructurePointType.LH,
                price: highestBetween,
                strength: StructureStrength.MAJOR,
                algorithmVersion: effectiveAlgorithmVersion,
                rangeId: newRangeId,
                sequenceLabel: `LH${rangeSequenceIndex}`,
                sequenceIndex: rangeSequenceIndex,
                isRangeTop: true,
                isRangeBottom: false,
                confirmed: true,
                structureScope: 'EXTERNAL',
                confirmationReason: `Highest candle HIGH (${highestBetween.toFixed(2)}) between previous LL and new LL enforcing global swing alternation.`,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };
              points.push(interveningLH);
              lastConfirmedLHPoint = interveningLH;
            }

            // Confirmed LL
            const confirmedLL: StructurePoint = {
              id: `v6_LL_${rangeSequenceIndex}_${candidateExtremeCandle!.openTimeUnix}`,
              eventId: `v6_LL_${rangeSequenceIndex}_${candidateExtremeCandle!.openTimeUnix}`,
              symbol: candle.symbol,
              timeframe: candle.timeframe,
              candleOpenTime: candidateExtremeCandle!.openTime,
              candleOpenTimeUnix: candidateExtremeCandle!.openTimeUnix,
              candleIndex: candidateExtremeIndex,
              type: StructurePointType.LL,
              price: candidateExtremePrice,
              strength: StructureStrength.MAJOR,
              algorithmVersion: effectiveAlgorithmVersion,
              rangeId: newRangeId,
              sequenceLabel: `LL${rangeSequenceIndex}`,
              sequenceIndex: rangeSequenceIndex,
              isRangeBottom: true,
              isRangeTop: false,
              confirmed: true,
              structureScope: 'EXTERNAL',
              confirmationReason: `Expansion low (${candidateExtremePrice.toFixed(2)}) qualified by subsequent retracement (${retracementCandles} candles, ${(actualFibDepth * 100).toFixed(1)}% Fib).`,
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };
            points.push(confirmedLL);
            lastConfirmedLLPoint = confirmedLL;
            pointCreatedThisCandle = confirmedLL.id;

            // Lock new Bearish Range
            const lockTopPrice = highestBetween > -Infinity ? highestBetween : retracementExtremePrice;
            const lockTopCandle = highestCandleBetween ?? retracementExtremeCandle!;
            const lockTopIdx = highestIdxBetween >= 0 ? highestIdxBetween : retracementExtremeIndex;

            const lhAnchor: TypedStructuralAnchor<StructurePointType.LH> = {
              type: StructurePointType.LH,
              price: lockTopPrice,
              candleTime: lockTopCandle.openTime,
              candleTimeUnix: lockTopCandle.openTimeUnix,
              candleIndex: lockTopIdx,
              label: `LH${rangeSequenceIndex}`,
              rangeId: newRangeId,
            };
            const llAnchor: TypedStructuralAnchor<StructurePointType.LL> = {
              type: StructurePointType.LL,
              price: candidateExtremePrice,
              candleTime: candidateExtremeCandle!.openTime,
              candleTimeUnix: candidateExtremeCandle!.openTimeUnix,
              candleIndex: candidateExtremeIndex,
              label: `LL${rangeSequenceIndex}`,
              rangeId: newRangeId,
            };

            activeRange = createBearishRange(lhAnchor, llAnchor, newRangeId, rangeSequenceIndex);
            ranges.push(activeRange);
            currentState = StructureState.BEARISH;
            currentPhase = 'RANGE_LOCKED';

            // Decision Audit
            audits.push({
              eventId: confirmedLL.id,
              regimeId: newRangeId,
              cycleId: newRangeId,
              sequenceId: confirmedLL.sequenceLabel ?? 'LL',
              eventType: 'LL',
              status: 'CONFIRMED',
              trendStateBefore: StructureState.BEARISH,
              trendStateAfter: StructureState.BEARISH,
              candleIndex: candidateExtremeIndex,
              timestamp: candidateExtremeCandle!.openTime,
              timestampUnix: candidateExtremeCandle!.openTimeUnix,
              price: candidateExtremePrice,
              previousLockedAnchorType: StructurePointType.LH,
              previousLockedAnchorPrice: fibAnchorPrice,
              previousLockedAnchorTime: null,
              previousStructuralExtremeType: StructurePointType.LL,
              previousStructuralExtremePrice: activeRange.bottom.price,
              previousStructuralExtremeTime: null,
              breakRequired: true,
              breakLevel: activeRange.bottom.price,
              breakWasBodyClose: true,
              breakWasWickOnly: false,
              candidateExtremeType: StructurePointType.LL,
              candidateExtremePrice,
              candidateExtremeTime: candidateExtremeCandle!.openTime,
              candidateExtremeTimeUnix: candidateExtremeCandle!.openTimeUnix,
              candidateExtremeIndex,
              retracementStartTime: candidateExtremeCandle!.openTime,
              retracementExtremePrice,
              retracementExtremeTime: retracementExtremeCandle?.openTime ?? null,
              retracementExtremeTimeUnix: retracementExtremeCandle?.openTimeUnix ?? null,
              retracementExtremeIndex,
              retracementCandleCount: retracementCandles,
              requiredRetracementCandles: minRetracementCandles,
              candleCountQualified: true,
              fibAnchorPrice,
              fibExtremePrice: candidateExtremePrice,
              fibRequiredRatio: minRetracementFib,
              fibRequiredPrice,
              actualRetracementRatio: actualFibDepth,
              actualRetracementDepthPrice: retracementExtremePrice,
              fibQualified: true,
              decision: 'LL CONFIRMED',
              decisionReason: confirmedLL.confirmationReason ?? '',
              algorithmVersion: effectiveAlgorithmVersion,
            });
          }
        }
      } else if (candidateExtremeType === StructurePointType.HH) {
        // Check opposing reversal break below fibAnchorPrice
        if (candle.close < fibAnchorPrice) {
          decisionTrace.push(
            `OPPOSING REVERSAL: Close ${candle.close.toFixed(2)} < anchor ${fibAnchorPrice.toFixed(2)}. Aborting bullish leg.`
          );
          candidateExtremeType = StructurePointType.LL;
          fibAnchorPrice = candidateExtremePrice;
          candidateExtremePrice = candle.low;
          candidateExtremeCandle = candle;
          candidateExtremeIndex = i;
          retracementExtremePrice = -Infinity;
          retracementExtremeCandle = null;
          retracementExtremeIndex = -1;
        }
        // Same-leg extension upward
        else if (candle.high > candidateExtremePrice) {
          candidateExtremePrice = candle.high;
          candidateExtremeCandle = candle;
          candidateExtremeIndex = i;
          retracementExtremePrice = Infinity;
          retracementExtremeCandle = null;
          retracementExtremeIndex = -1;
          decisionTrace.push(
            `SAME-LEG EXTENSION: Candidate HH extended to ${candle.high.toFixed(2)}. Reset retracement tracking.`
          );
        }
        // Retracement tracking
        else {
          if (candle.low < retracementExtremePrice) {
            retracementExtremePrice = candle.low;
            retracementExtremeCandle = candle;
            retracementExtremeIndex = i;
          }
          const retracementCandles = i - candidateExtremeIndex;
          const fibRange = Math.max(1e-6, candidateExtremePrice - fibAnchorPrice);
          const fibRequiredPrice = candidateExtremePrice - minRetracementFib * fibRange;
          const actualFibDepth = (candidateExtremePrice - retracementExtremePrice) / fibRange;
          const isFibQualified = retracementExtremePrice <= fibRequiredPrice;
          const isCandleCountQualified = retracementCandles >= minRetracementCandles;

          decisionTrace.push(
            `RETRACEMENT: Trough=${retracementExtremePrice.toFixed(2)}, Candles=${retracementCandles}/${minRetracementCandles}, Fib=${(actualFibDepth * 100).toFixed(1)}%/${(minRetracementFib * 100).toFixed(1)}%.`
          );

          if (isFibQualified && isCandleCountQualified) {
            // CONFIRM BULLISH STRUCTURAL CYCLE
            rangeSequenceIndex++;
            const newRangeId = `BULLISH_RANGE_${rangeSequenceIndex}`;
            decisionTrace.push(
              `CONFIRMED BULLISH CYCLE: Both candle count (${retracementCandles}) and Fib (${(actualFibDepth * 100).toFixed(1)}%) qualified!`
            );

            // Invariant: Never allow HH -> HH without an HL.
            // When a new HH confirms, set HL = LOWEST candle LOW between previous HH and new HH.
            if (activeRange.direction === 'BULLISH') {
              const prevHHIdx = activeRange.top.candleIndex ?? 0;
              let lowestBetween = Infinity;
              let lowestCandleBetween: NormalizedMarketCandle | null = null;
              let lowestIdxBetween = -1;

              for (let k = prevHHIdx; k <= candidateExtremeIndex; k++) {
                const kc = evaluationCandles[k];
                if (kc && kc.low < lowestBetween) {
                  lowestBetween = kc.low;
                  lowestCandleBetween = kc;
                  lowestIdxBetween = k;
                }
              }

              if (
                lowestCandleBetween &&
                lowestIdxBetween > prevHHIdx &&
                lowestIdxBetween < candidateExtremeIndex
              ) {
                const interveningHL: StructurePoint = {
                  id: `v6_HL_${rangeSequenceIndex}_${lowestCandleBetween.openTimeUnix}`,
                  eventId: `v6_HL_${rangeSequenceIndex}_${lowestCandleBetween.openTimeUnix}`,
                  symbol: candle.symbol,
                  timeframe: candle.timeframe,
                  candleOpenTime: lowestCandleBetween.openTime,
                  candleOpenTimeUnix: lowestCandleBetween.openTimeUnix,
                  candleIndex: lowestIdxBetween,
                  type: StructurePointType.HL,
                  price: lowestBetween,
                  strength: StructureStrength.MAJOR,
                  algorithmVersion: effectiveAlgorithmVersion,
                  rangeId: newRangeId,
                  sequenceLabel: `HL${rangeSequenceIndex}`,
                  sequenceIndex: rangeSequenceIndex,
                  isRangeBottom: true,
                  isRangeTop: false,
                  confirmed: true,
                  structureScope: 'EXTERNAL',
                  confirmationReason: `Lowest candle LOW (${lowestBetween.toFixed(2)}) between previous HH and new HH enforcing global swing alternation.`,
                  detectedAt: new Date().toISOString(),
                  createdAt: new Date().toISOString(),
                };
                points.push(interveningHL);
                lastConfirmedHLPoint = interveningHL;
              }
            }

            // Confirmed HH
            const confirmedHH: StructurePoint = {
              id: `v6_HH_${rangeSequenceIndex}_${candidateExtremeCandle!.openTimeUnix}`,
              eventId: `v6_HH_${rangeSequenceIndex}_${candidateExtremeCandle!.openTimeUnix}`,
              symbol: candle.symbol,
              timeframe: candle.timeframe,
              candleOpenTime: candidateExtremeCandle!.openTime,
              candleOpenTimeUnix: candidateExtremeCandle!.openTimeUnix,
              candleIndex: candidateExtremeIndex,
              type: StructurePointType.HH,
              price: candidateExtremePrice,
              strength: StructureStrength.MAJOR,
              algorithmVersion: effectiveAlgorithmVersion,
              rangeId: newRangeId,
              sequenceLabel: `HH${rangeSequenceIndex}`,
              sequenceIndex: rangeSequenceIndex,
              isRangeTop: true,
              isRangeBottom: false,
              confirmed: true,
              structureScope: 'EXTERNAL',
              confirmationReason: `Expansion high (${candidateExtremePrice.toFixed(2)}) qualified by subsequent retracement (${retracementCandles} candles, ${(actualFibDepth * 100).toFixed(1)}% Fib).`,
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };
            points.push(confirmedHH);
            lastConfirmedHHPoint = confirmedHH;
            pointCreatedThisCandle = confirmedHH.id;

            // Confirmed HL of the qualifying retracement
            const confirmedHL: StructurePoint = {
              id: `v6_HL_${rangeSequenceIndex}_${retracementExtremeCandle!.openTimeUnix}`,
              eventId: `v6_HL_${rangeSequenceIndex}_${retracementExtremeCandle!.openTimeUnix}`,
              symbol: candle.symbol,
              timeframe: candle.timeframe,
              candleOpenTime: retracementExtremeCandle!.openTime,
              candleOpenTimeUnix: retracementExtremeCandle!.openTimeUnix,
              candleIndex: retracementExtremeIndex,
              type: StructurePointType.HL,
              price: retracementExtremePrice,
              strength: StructureStrength.MAJOR,
              algorithmVersion: effectiveAlgorithmVersion,
              rangeId: newRangeId,
              sequenceLabel: `HL${rangeSequenceIndex}`,
              sequenceIndex: rangeSequenceIndex,
              isRangeBottom: true,
              isRangeTop: false,
              confirmed: true,
              structureScope: 'EXTERNAL',
              confirmationReason: `Qualifying retracement low (${retracementExtremePrice.toFixed(2)}) satisfying >= ${minRetracementCandles} candles and >= ${(minRetracementFib * 100).toFixed(1)}% Fib.`,
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };
            points.push(confirmedHL);
            lastConfirmedHLPoint = confirmedHL;

            // Lock new Bullish Range
            const hhAnchor: TypedStructuralAnchor<StructurePointType.HH> = {
              type: StructurePointType.HH,
              price: candidateExtremePrice,
              candleTime: candidateExtremeCandle!.openTime,
              candleTimeUnix: candidateExtremeCandle!.openTimeUnix,
              candleIndex: candidateExtremeIndex,
              label: `HH${rangeSequenceIndex}`,
              rangeId: newRangeId,
            };
            const hlAnchor: TypedStructuralAnchor<StructurePointType.HL> = {
              type: StructurePointType.HL,
              price: retracementExtremePrice,
              candleTime: retracementExtremeCandle!.openTime,
              candleTimeUnix: retracementExtremeCandle!.openTimeUnix,
              candleIndex: retracementExtremeIndex,
              label: `HL${rangeSequenceIndex}`,
              rangeId: newRangeId,
            };

            activeRange = createBullishRange(hhAnchor, hlAnchor, newRangeId, rangeSequenceIndex);
            ranges.push(activeRange);
            currentState = StructureState.BULLISH;
            currentPhase = 'RANGE_LOCKED';

            // Decision Audit
            audits.push({
              eventId: confirmedHH.id,
              regimeId: newRangeId,
              cycleId: newRangeId,
              sequenceId: confirmedHH.sequenceLabel ?? 'HH',
              eventType: 'HH',
              status: 'CONFIRMED',
              trendStateBefore: StructureState.BULLISH,
              trendStateAfter: StructureState.BULLISH,
              candleIndex: candidateExtremeIndex,
              timestamp: candidateExtremeCandle!.openTime,
              timestampUnix: candidateExtremeCandle!.openTimeUnix,
              price: candidateExtremePrice,
              previousLockedAnchorType: StructurePointType.HL,
              previousLockedAnchorPrice: fibAnchorPrice,
              previousLockedAnchorTime: null,
              previousStructuralExtremeType: StructurePointType.HH,
              previousStructuralExtremePrice: activeRange.top.price,
              previousStructuralExtremeTime: null,
              breakRequired: true,
              breakLevel: activeRange.top.price,
              breakWasBodyClose: true,
              breakWasWickOnly: false,
              candidateExtremeType: StructurePointType.HH,
              candidateExtremePrice,
              candidateExtremeTime: candidateExtremeCandle!.openTime,
              candidateExtremeTimeUnix: candidateExtremeCandle!.openTimeUnix,
              candidateExtremeIndex,
              retracementStartTime: candidateExtremeCandle!.openTime,
              retracementExtremePrice,
              retracementExtremeTime: retracementExtremeCandle?.openTime ?? null,
              retracementExtremeTimeUnix: retracementExtremeCandle?.openTimeUnix ?? null,
              retracementExtremeIndex,
              retracementCandleCount: retracementCandles,
              requiredRetracementCandles: minRetracementCandles,
              candleCountQualified: true,
              fibAnchorPrice,
              fibExtremePrice: candidateExtremePrice,
              fibRequiredRatio: minRetracementFib,
              fibRequiredPrice,
              actualRetracementRatio: actualFibDepth,
              actualRetracementDepthPrice: retracementExtremePrice,
              fibQualified: true,
              decision: 'HH CONFIRMED',
              decisionReason: confirmedHH.confirmationReason ?? '',
              algorithmVersion: effectiveAlgorithmVersion,
            });
          }
        }
      }
    }

    recordStep(
      candleReplaySteps,
      i,
      candle,
      currentState,
      currentPhase,
      activeRange,
      decisionTrace,
      breakIdThisCandle,
      pointCreatedThisCandle
    );
  }

  // ==========================================
  // POST-PROCESSING: Deduplication & Clean Invariant
  // ==========================================
  const cleanConfirmedPoints = deduplicatePoints(points);

  // Build active retracement info for live cards
  let activeRetracement: ActiveRetracementInfo | null = null;
  if (currentPhase === 'EXPANSION_CANDIDATE' && candidateExtremeCandle) {
    const isBearishLeg = candidateExtremeType === StructurePointType.LL;
    const fibRange = Math.abs(fibAnchorPrice - candidateExtremePrice);
    const fib382Price = isBearishLeg
      ? candidateExtremePrice + minRetracementFib * fibRange
      : candidateExtremePrice - minRetracementFib * fibRange;

    const actualRetrace = retracementExtremePrice !== (isBearishLeg ? -Infinity : Infinity)
      ? retracementExtremePrice
      : candidateExtremePrice;
    const retracementCandleCount = retracementExtremeIndex >= 0
      ? evaluationCandles.length - 1 - candidateExtremeIndex
      : 0;

    const actualFibRatio = fibRange > 0
      ? isBearishLeg
        ? (actualRetrace - candidateExtremePrice) / fibRange
        : (candidateExtremePrice - actualRetrace) / fibRange
      : 0;

    const isFibQualified = isBearishLeg
      ? actualRetrace >= fib382Price
      : actualRetrace <= fib382Price;
    const isCandleCountQualified = retracementCandleCount >= minRetracementCandles;

    activeRetracement = {
      state: currentState,
      candidateType: candidateExtremeType,
      candidatePrice: candidateExtremePrice,
      candidateTime: candidateExtremeCandle.openTime,
      candidateTimeUnix: candidateExtremeCandle.openTimeUnix,
      candidateCandleIndex: candidateExtremeIndex,
      referencePrice: fibAnchorPrice,
      referenceTime: (fibAnchorCandle as any)?.openTime ?? (fibAnchorCandle as any)?.candleTime ?? '',
      fibLevelPrice: fib382Price,
      fibRatio: minRetracementFib,
      currentRetracementCandles: retracementCandleCount,
      requiredRetracementCandles: minRetracementCandles,
      currentRetracementPrice: actualRetrace,
      currentFibDepth: Math.max(0, actualFibRatio),
      currentRetracementExtremePrice: actualRetrace,
      currentRetracementExtremeTime: retracementExtremeCandle?.openTime ?? null,
      currentRetracementExtremeIndex: retracementExtremeIndex,
      isCandleCountQualified,
      isFibDepthQualified: isFibQualified,
      isFullyQualified: isCandleCountQualified && isFibQualified,
      retracementQualified: isCandleCountQualified && isFibQualified,
      requiredCandles: minRetracementCandles,
      requiredFib: minRetracementFib,
    };
  }

  // Aggregate stats
  const hhPoints = cleanConfirmedPoints.filter((p) => p.type === StructurePointType.HH);
  const hlPoints = cleanConfirmedPoints.filter((p) => p.type === StructurePointType.HL);
  const llPoints = cleanConfirmedPoints.filter((p) => p.type === StructurePointType.LL);
  const lhPoints = cleanConfirmedPoints.filter((p) => p.type === StructurePointType.LH);

  return {
    symbol: evaluationCandles[0]?.symbol ?? 'BTC_USDT',
    timeframe: evaluationCandles[0]?.timeframe ?? '5M',
    algorithmVersion: effectiveAlgorithmVersion,
    parameters: {
      analysisCandles,
      initializationSearchCandles: warmUpCandles,
      breakConfirmation: 'CLOSE',
      minimumRetracementCandles: minRetracementCandles,
      minimumRetracementFib: minRetracementFib,
      lookbackCandles: lookback,
      fibTouchMode: 'WICK',
      algorithmVersion: effectiveAlgorithmVersion,
    },
    structureState: currentState,
    stateLabel: currentState,
    totalCandlesAvailable: totalAvailable,
    closedCandlesEvaluated: evaluationCandles.length,
    unclosedCandleExcluded: false,
    workingWindowStart: evaluationCandles[0]?.openTime ?? null,
    workingWindowEnd: evaluationCandles[evaluationCandles.length - 1]?.openTime ?? null,
    hhCount: hhPoints.length,
    hlCount: hlPoints.length,
    llCount: llPoints.length,
    lhCount: lhPoints.length,
    provisionalCount: 0,
    totalPointsCount: cleanConfirmedPoints.length,
    lastHH: hhPoints[hhPoints.length - 1] ?? null,
    lastHL: hlPoints[hlPoints.length - 1] ?? null,
    lastLL: llPoints[llPoints.length - 1] ?? null,
    lastLH: lhPoints[lhPoints.length - 1] ?? null,
    activeProvisionalPoint: null,
    activeRetracement,
    points: cleanConfirmedPoints,
    ranges,
    activeRange,
    internalStructureIgnored: true,
    structureBreakEvents: breakEvents,
    eventLogs,
    audits,
    rejectedEvents,
    candleReplaySteps,
    executionTimeMs: Date.now() - startTime,
    detectedAt: new Date().toISOString(),
    initialization: initResult,
  };
}

function discoverInitialExternalRange(
  candles: NormalizedMarketCandle[]
): InitialRangeDiscovery | null {
  if (candles.length < 5) return null;

  let highestHigh = -Infinity;
  let highestCandle = candles[0];
  let highestIndex = 0;

  let lowestLow = Infinity;
  let lowestCandle = candles[0];
  let lowestIndex = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.high > highestHigh) {
      highestHigh = c.high;
      highestCandle = c;
      highestIndex = i;
    }
    if (c.low < lowestLow) {
      lowestLow = c.low;
      lowestCandle = c;
      lowestIndex = i;
    }
  }

  if (highestHigh <= lowestLow) return null;

  if (highestIndex < lowestIndex) {
    return {
      direction: 'BEARISH',
      topPrice: highestHigh,
      topCandle: highestCandle,
      topIndex: highestIndex,
      bottomPrice: lowestLow,
      bottomCandle: lowestCandle,
      bottomIndex: lowestIndex,
    };
  }

  return {
    direction: 'BULLISH',
    topPrice: highestHigh,
    topCandle: highestCandle,
    topIndex: highestIndex,
    bottomPrice: lowestLow,
    bottomCandle: lowestCandle,
    bottomIndex: lowestIndex,
  };
}

function createPointFromBoundary(
  b: StructuralRangeBoundary | TypedStructuralAnchor<any>,
  rangeId: string,
  direction: 'BULLISH' | 'BEARISH',
  isTop: boolean,
  isBottom: boolean,
  algorithmVersion: string
): StructurePoint {
  const id = `v6_${b.type}_${b.candleTimeUnix}`;
  return {
    id,
    eventId: id,
    symbol: 'BTC_USDT',
    timeframe: '5M',
    candleOpenTime: b.candleTime,
    candleOpenTimeUnix: b.candleTimeUnix,
    candleIndex: b.candleIndex,
    type: b.type,
    price: b.price,
    strength: StructureStrength.MAJOR,
    algorithmVersion,
    rangeId,
    sequenceLabel: b.label,
    sequenceIndex: parseInt(b.label.replace(/\D/g, '') || '1', 10),
    isRangeTop: isTop,
    isRangeBottom: isBottom,
    confirmed: true,
    structureScope: 'EXTERNAL',
    confirmationReason: `Structural range ${isTop ? 'TOP' : 'BOTTOM'} locked for ${rangeId}.`,
    detectedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

function recordWickRejection(
  rejectedList: RejectedStructureEvent[],
  candle: NormalizedMarketCandle,
  index: number,
  attemptedLevel: number,
  actualValue: number,
  rangeId: string,
  rejectionType: 'REJECTED_LOW' | 'REJECTED_HIGH' | 'REJECTED_INVALIDATION' | 'REJECTED_RETRACEMENT',
  reason: string
) {
  rejectedList.push({
    id: `rej_${rangeId}_${candle.openTimeUnix}`,
    rangeId,
    cycleId: rangeId,
    candleIndex: index,
    candleTime: candle.openTime,
    candleTimeUnix: candle.openTimeUnix,
    timestamp: candle.openTime,
    timestampUnix: candle.openTimeUnix,
    price: actualValue,
    attemptedLevel,
    actualValue,
    requiredValue: attemptedLevel,
    rejectionType,
    label: 'WICK BREACH (NO BODY CLOSE)',
    reason,
  });
}

function recordStep(
  steps: CandleReplayStep[],
  index: number,
  candle: NormalizedMarketCandle,
  state: StructureState,
  phase: string,
  activeRange: StructuralRange | null,
  decisionTrace: string[],
  breakId: string | null,
  pointCreated: string | null
) {
  const engineState: EngineStateSnapshot = {
    state,
    phase: phase as any,
    activeTopAnchor:
      activeRange && activeRange.status === 'ACTIVE'
        ? {
            type: activeRange.top.type,
            price: activeRange.top.price,
            label: activeRange.top.label,
            eventId: activeRange.top.eventId,
            candleTime: activeRange.top.candleTime,
            candleIndex: activeRange.top.candleIndex,
          }
        : null,
    activeBottomAnchor:
      activeRange && activeRange.status === 'ACTIVE'
        ? {
            type: activeRange.bottom.type,
            price: activeRange.bottom.price,
            label: activeRange.bottom.label,
            eventId: activeRange.bottom.eventId,
            candleTime: activeRange.bottom.candleTime,
            candleIndex: activeRange.bottom.candleIndex,
          }
        : null,
    lastBreakEvent: breakId,
    candleIndex: index,
    rangeId: activeRange?.rangeId,
    direction: activeRange?.direction,
  };

  steps.push({
    candleIndex: index,
    time: candle.openTime,
    timeUnix: candle.openTimeUnix,
    openTime: candle.openTime,
    openTimeUnix: candle.openTimeUnix,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    state,
    trendState: state,
    rangeId: activeRange?.rangeId,
    activeRange: activeRange
      ? {
          rangeId: activeRange.rangeId,
          direction: activeRange.direction,
          topPrice: activeRange.top.price,
          bottomPrice: activeRange.bottom.price,
          topLabel: activeRange.top.label,
          bottomLabel: activeRange.bottom.label,
        }
      : null,
    lockedAnchor: activeRange
      ? {
          type:
            activeRange.direction === 'BEARISH'
              ? activeRange.top.type
              : activeRange.bottom.type,
          price:
            activeRange.direction === 'BEARISH'
              ? activeRange.top.price
              : activeRange.bottom.price,
          time:
            activeRange.direction === 'BEARISH'
              ? activeRange.top.candleTime
              : activeRange.bottom.candleTime,
          label:
            activeRange.direction === 'BEARISH'
              ? activeRange.top.label
              : activeRange.bottom.label,
        }
      : null,
    decisionTrace,
    structureBreakThisCandle: breakId,
    confirmedPointCreatedThisCandle: pointCreated,
    engineState,
  });
}

function deduplicatePoints(points: StructurePoint[]): StructurePoint[] {
  const seenEvent = new Set<string>();
  const seenCandle = new Map<number, StructurePoint>();
  const result: StructurePoint[] = [];

  for (const p of points) {
    if (!assertSingleStructureType(p)) {
      console.error(`[Invariant Error] Multiple or invalid types in structure point:`, p);
      continue;
    }
    const eventKey = `${p.algorithmVersion}_${p.eventId || p.id}`;
    if (seenEvent.has(eventKey)) {
      continue;
    }
    seenEvent.add(eventKey);

    // Enforce ONE confirmed marker per candle/timestamp
    const existingAtCandle = seenCandle.get(p.candleOpenTimeUnix);
    if (existingAtCandle) {
      if (existingAtCandle.type !== p.type) {
        console.error(
          `[Invariant Violation] Conflicting opposing structure types on same candle (${p.candleOpenTime}): ${existingAtCandle.type} vs ${p.type}. Rejecting second point.`
        );
        continue;
      }
      continue;
    }

    seenCandle.set(p.candleOpenTimeUnix, p);
    result.push(p);
  }

  return result.sort((a, b) => a.candleOpenTimeUnix - b.candleOpenTimeUnix);
}

function createEmptyV6Result(
  startTime: number,
  algorithmVersion: string,
  minCandles: number,
  minFib: number
): StructureDetectionResult {
  return {
    symbol: 'BTC_USDT',
    timeframe: '5M',
    algorithmVersion,
    parameters: {
      analysisCandles: 280,
      initializationSearchCandles: 70,
      breakConfirmation: 'CLOSE',
      minimumRetracementCandles: minCandles,
      minimumRetracementFib: minFib,
      lookbackCandles: 350,
      fibTouchMode: 'WICK',
      algorithmVersion,
    },
    structureState: StructureState.UNDEFINED,
    stateLabel: 'UNDEFINED',
    totalCandlesAvailable: 0,
    closedCandlesEvaluated: 0,
    unclosedCandleExcluded: false,
    workingWindowStart: null,
    workingWindowEnd: null,
    hhCount: 0,
    hlCount: 0,
    llCount: 0,
    lhCount: 0,
    provisionalCount: 0,
    totalPointsCount: 0,
    lastHH: null,
    lastHL: null,
    lastLL: null,
    lastLH: null,
    activeProvisionalPoint: null,
    activeRetracement: null,
    points: [],
    ranges: [],
    activeRange: null,
    internalStructureIgnored: true,
    structureBreakEvents: [],
    eventLogs: [],
    audits: [],
    rejectedEvents: [],
    candleReplaySteps: [],
    executionTimeMs: Date.now() - startTime,
    detectedAt: new Date().toISOString(),
  };
}
