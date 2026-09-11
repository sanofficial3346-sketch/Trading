import { NormalizedMarketCandle } from '../marketData/mexcPublicMarketClient';
import {
  StructurePoint,
  StructurePointType,
  StructureStrength,
  StructureState,
  StructureParameters,
  StructureDetectionResult,
  StructureEventLogItem,
  StructureBreakEvent,
  StructuralRange,
  StructuralRangeBoundary,
  TypedStructuralAnchor,
  BearishRange,
  BullishRange,
  createBearishRange,
  createBullishRange,
  assertBearishRange,
  assertBullishRange,
  ALGORITHM_VERSION_V5,
  ALGORITHM_VERSION_V5_REV2,
  ALGORITHM_VERSION_V5_REV4,
  InitializationStructureResult,
} from './structureTypes';
import {
  StructureDecisionAudit,
  RejectedStructureEvent,
  CandleReplayStep,
  EngineStateSnapshot,
} from './structureAuditTypes';

export { ALGORITHM_VERSION_V5, ALGORITHM_VERSION_V5_REV2, ALGORITHM_VERSION_V5_REV4 };

/**
 * Audit and convert an anchor to a strongly typed structural anchor.
 * Throws an invariant error if the anchor type does not strictly match the expected type.
 */
function getAnchorProps<T extends StructurePointType>(
  anchor: StructurePoint | StructuralRangeBoundary | TypedStructuralAnchor<T>,
  expectedType: T,
  fallbackLabel: string,
  fallbackTime: string,
  fallbackTimeUnix: number
): TypedStructuralAnchor<T> {
  const type = anchor.type;
  if (type !== expectedType) {
    throw new Error(
      `STRUCTURE INVARIANT FAILURE: Expected anchor type ${expectedType}, but received ${type}`
    );
  }

  const time = 'candleOpenTime' in anchor ? anchor.candleOpenTime : anchor.candleTime;
  const timeUnix =
    'candleOpenTimeUnix' in anchor ? anchor.candleOpenTimeUnix : anchor.candleTimeUnix;
  const label =
    'sequenceLabel' in anchor && anchor.sequenceLabel
      ? anchor.sequenceLabel
      : 'label' in anchor
      ? anchor.label
      : fallbackLabel;
  const eventId =
    'id' in anchor ? anchor.id : 'eventId' in anchor ? anchor.eventId : undefined;

  return {
    type: expectedType,
    price: anchor.price,
    candleTime: time || fallbackTime,
    candleTimeUnix: timeUnix || fallbackTimeUnix,
    candleIndex: anchor.candleIndex,
    label,
    eventId,
    rangeId: anchor.rangeId,
  };
}

/**
 * STRUCTURE_V5_RANGE_LOCKED_REV4 Engine
 *
 * ABSOLUTE STRUCTURAL RANGE SPECIFICATION:
 * - BEARISH RANGE: TOP = LH, BOTTOM = LL (activeLH.price > activeLL.price).
 * - BULLISH RANGE: TOP = HH, BOTTOM = HL (activeHH.price > activeHL.price).
 * - Anchors are strongly typed (TypedStructuralAnchor).
 * - Immutability: Confirmed anchor event IDs are never mutated or converted into opposite types.
 * - Runtime Invariant Checks: assertBearishRange & assertBullishRange validated on every candle.
 * - Invalidation Reversal: closed candle body > activeLH (Bearish) or < activeHL (Bullish) ONLY.
 * - Continuation: closed candle body < activeLL (Bearish) or > activeHH (Bullish) ONLY.
 * - Hard Wick Gate: Wick breaches without body close are strictly rejected and do not trigger expansion.
 * - Reversal transitions create fresh opposite structures with distinct event IDs.
 */
export function detectStructureV5RangeLocked(
  allCandles: NormalizedMarketCandle[],
  customParams?: Partial<StructureParameters>
): StructureDetectionResult {
  const startTime = Date.now();
  const effectiveAlgorithmVersion =
    customParams?.algorithmVersion ?? ALGORITHM_VERSION_V5_REV4;

  const analysisCandles = Math.max(
    50,
    Math.min(1000, customParams?.analysisCandles ?? 280)
  );
  const warmUpCandles = Math.max(
    0,
    Math.min(200, customParams?.initializationSearchCandles ?? customParams?.warmUpCandles ?? 70)
  );
  const lookback = analysisCandles + warmUpCandles;

  // Filter for valid closed candles
  const closedCandles = allCandles.filter((c) => c.isClosed !== false);
  const totalAvailable = closedCandles.length;
  const startIndex = Math.max(0, totalAvailable - lookback);
  const evaluationCandles = closedCandles.slice(startIndex);

  if (evaluationCandles.length < 2) {
    return createEmptyV5Result(startTime, effectiveAlgorithmVersion);
  }

  // Calculate boundary between warm-up and main analysis
  const mainAnalysisStartIndex = Math.min(warmUpCandles, evaluationCandles.length - 1);
  const mainStartTimeStr = evaluationCandles[mainAnalysisStartIndex]?.openTime ?? null;

  // Initialize tracking containers
  const points: StructurePoint[] = [];
  const ranges: StructuralRange[] = [];
  const breakEvents: StructureBreakEvent[] = [];
  const audits: StructureDecisionAudit[] = [];
  const rejectedEvents: RejectedStructureEvent[] = [];
  const replaySteps: CandleReplayStep[] = [];
  const eventLogs: StructureEventLogItem[] = [];

  let rangeSequenceIndex = 0;
  let activeRange: StructuralRange | null = null;
  let currentState: StructureState = StructureState.UNDEFINED;

  // Track expansion and locked phases
  let currentPhase: 'RANGE_LOCKED' | 'EXPANSION' = 'RANGE_LOCKED';
  let expansionExtremePrice = 0;
  let expansionExtremeCandle: NormalizedMarketCandle | null = null;
  let expansionExtremeIndex = 0;

  // Track provisional retracement extreme
  let provisionalLHPrice = -Infinity;
  let provisionalLHCandle: NormalizedMarketCandle | null = null;
  let provisionalLHIndex = -1;
  let retracementStartTime: string | null = null;
  let retracementStartTimeUnix: number | null = null;
  let retracementCandidateCount = 0;

  let provisionalHLPrice = Infinity;
  let provisionalHLCandle: NormalizedMarketCandle | null = null;
  let provisionalHLIndex = -1;
  let bullishRetracementStartTime: string | null = null;
  let bullishRetracementStartTimeUnix: number | null = null;
  let bullishRetracementCandidateCount = 0;

  let lastConfirmedLHPoint: StructurePoint | null = null;
  let lastConfirmedHLPoint: StructurePoint | null = null;

  // ==========================================
  // INITIALIZATION / SEEDING
  // ==========================================
  const initializationLogs: string[] = [];
  let initResult: InitializationStructureResult;

  if (customParams?.manualStart) {
    // ----------------------------------------
    // MANUAL INITIALIZATION OVERRIDE
    // ----------------------------------------
    const ms = customParams.manualStart;
    initializationLogs.push(
      `MANUAL INITIALIZATION: Seeding ${ms.direction} starting structure.`
    );

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
        candleIndex: ms.bottom.candleIndex ?? 0,
        label: `LL${rangeSequenceIndex}`,
        rangeId,
      };

      activeRange = createBearishRange(lhAnchor, llAnchor, rangeId, rangeSequenceIndex);
      assertBearishRange(activeRange);
      ranges.push(activeRange);

      const p1 = createPointFromBoundary(lhAnchor, rangeId, 'BEARISH', true, false, effectiveAlgorithmVersion);
      const p2 = createPointFromBoundary(llAnchor, rangeId, 'BEARISH', false, true, effectiveAlgorithmVersion);
      points.push(p1, p2);

      currentState = StructureState.BEARISH;
      lastConfirmedLHPoint = p1;
      retracementStartTime = llAnchor.candleTime;
      retracementStartTimeUnix = llAnchor.candleTimeUnix;
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
        candleIndex: ms.bottom.candleIndex ?? 0,
        label: `HL${rangeSequenceIndex}`,
        rangeId,
      };

      activeRange = createBullishRange(hhAnchor, hlAnchor, rangeId, rangeSequenceIndex);
      assertBullishRange(activeRange);
      ranges.push(activeRange);

      const p1 = createPointFromBoundary(hhAnchor, rangeId, 'BULLISH', true, false, effectiveAlgorithmVersion);
      const p2 = createPointFromBoundary(hlAnchor, rangeId, 'BULLISH', false, true, effectiveAlgorithmVersion);
      points.push(p1, p2);

      currentState = StructureState.BULLISH;
      lastConfirmedHLPoint = p2;
      bullishRetracementStartTime = hhAnchor.candleTime;
      bullishRetracementStartTimeUnix = hhAnchor.candleTimeUnix;
    }

    currentPhase = 'RANGE_LOCKED';

    initResult = {
      initialState: currentState,
      initialSequence: ms.direction === 'BEARISH' ? 'LH → LL' : 'HL → HH',
      warmUpCandlesUsed: 0,
      warmUpCandlesMax: warmUpCandles,
      initialFoundAt: activeRange.top.candleTime,
      initialFoundTimeUnix: activeRange.top.candleTimeUnix,
      initialLH: ms.direction === 'BEARISH' ? activeRange.top.price : null,
      initialLL: ms.direction === 'BEARISH' ? activeRange.bottom.price : null,
      initialHH: ms.direction === 'BULLISH' ? activeRange.top.price : null,
      initialHL: ms.direction === 'BULLISH' ? activeRange.bottom.price : null,
      mainAnalysisStartIndex,
      mainAnalysisStartTime: mainStartTimeStr,
      initializationLogs,
      usedWarmUp: false,
    };
  } else {
    // ----------------------------------------
    // AUTOMATIC INITIALIZATION
    // ----------------------------------------
    const warmUpSlice = evaluationCandles.slice(0, Math.max(10, mainAnalysisStartIndex + 5));
    const autoInit = discoverInitialExternalRange(warmUpSlice);

    if (autoInit) {
      rangeSequenceIndex++;
      const rangeId = `${autoInit.direction}_RANGE_${rangeSequenceIndex}`;

      if (autoInit.direction === 'BEARISH') {
        const lhAnchor: TypedStructuralAnchor<StructurePointType.LH> = {
          type: StructurePointType.LH,
          price: autoInit.topPrice,
          candleTime: autoInit.topCandle.openTime,
          candleTimeUnix: autoInit.topCandle.openTimeUnix,
          candleIndex: autoInit.topIndex,
          label: `LH${rangeSequenceIndex}`,
          rangeId,
        };
        const llAnchor: TypedStructuralAnchor<StructurePointType.LL> = {
          type: StructurePointType.LL,
          price: autoInit.bottomPrice,
          candleTime: autoInit.bottomCandle.openTime,
          candleTimeUnix: autoInit.bottomCandle.openTimeUnix,
          candleIndex: autoInit.bottomIndex,
          label: `LL${rangeSequenceIndex}`,
          rangeId,
        };

        activeRange = createBearishRange(lhAnchor, llAnchor, rangeId, rangeSequenceIndex);
        assertBearishRange(activeRange);
        ranges.push(activeRange);

        const p1 = createPointFromBoundary(lhAnchor, rangeId, 'BEARISH', true, false, effectiveAlgorithmVersion);
        const p2 = createPointFromBoundary(llAnchor, rangeId, 'BEARISH', false, true, effectiveAlgorithmVersion);
        points.push(p1, p2);

        currentState = StructureState.BEARISH;
        lastConfirmedLHPoint = p1;
        retracementStartTime = llAnchor.candleTime;
        retracementStartTimeUnix = llAnchor.candleTimeUnix;
      } else {
        const hhAnchor: TypedStructuralAnchor<StructurePointType.HH> = {
          type: StructurePointType.HH,
          price: autoInit.topPrice,
          candleTime: autoInit.topCandle.openTime,
          candleTimeUnix: autoInit.topCandle.openTimeUnix,
          candleIndex: autoInit.topIndex,
          label: `HH${rangeSequenceIndex}`,
          rangeId,
        };
        const hlAnchor: TypedStructuralAnchor<StructurePointType.HL> = {
          type: StructurePointType.HL,
          price: autoInit.bottomPrice,
          candleTime: autoInit.bottomCandle.openTime,
          candleTimeUnix: autoInit.bottomCandle.openTimeUnix,
          candleIndex: autoInit.bottomIndex,
          label: `HL${rangeSequenceIndex}`,
          rangeId,
        };

        activeRange = createBullishRange(hhAnchor, hlAnchor, rangeId, rangeSequenceIndex);
        assertBullishRange(activeRange);
        ranges.push(activeRange);

        const p1 = createPointFromBoundary(hhAnchor, rangeId, 'BULLISH', true, false, effectiveAlgorithmVersion);
        const p2 = createPointFromBoundary(hlAnchor, rangeId, 'BULLISH', false, true, effectiveAlgorithmVersion);
        points.push(p1, p2);

        currentState = StructureState.BULLISH;
        lastConfirmedHLPoint = p2;
        bullishRetracementStartTime = hhAnchor.candleTime;
        bullishRetracementStartTimeUnix = hhAnchor.candleTimeUnix;
      }

      currentPhase = 'RANGE_LOCKED';

      initResult = {
        initialState: currentState,
        initialSequence: autoInit.direction === 'BEARISH' ? 'LH → LL' : 'HL → HH',
        warmUpCandlesUsed: warmUpSlice.length,
        warmUpCandlesMax: warmUpCandles,
        initialFoundAt: activeRange.top.candleTime,
        initialFoundTimeUnix: activeRange.top.candleTimeUnix,
        initialLH: autoInit.direction === 'BEARISH' ? activeRange.top.price : null,
        initialLL: autoInit.direction === 'BEARISH' ? activeRange.bottom.price : null,
        initialHH: autoInit.direction === 'BULLISH' ? activeRange.top.price : null,
        initialHL: autoInit.direction === 'BULLISH' ? activeRange.bottom.price : null,
        mainAnalysisStartIndex,
        mainAnalysisStartTime: mainStartTimeStr,
        initializationLogs: [
          `Auto initialization discovered ${autoInit.direction} range: ${activeRange.top.label} (${activeRange.top.price}) -> ${activeRange.bottom.label} (${activeRange.bottom.price})`,
        ],
        usedWarmUp: true,
      };
    } else {
      initResult = {
        initialState: StructureState.UNDEFINED,
        initialSequence: 'NONE',
        warmUpCandlesUsed: warmUpSlice.length,
        warmUpCandlesMax: warmUpCandles,
        initialFoundAt: null,
        mainAnalysisStartIndex,
        mainAnalysisStartTime: mainStartTimeStr,
        initializationLogs: ['No clean initial range discovered in warm-up window.'],
      };
    }
  }

  // ==========================================
  // CANDLE-BY-CANDLE RANGE-LOCKED PROCESSING
  // ==========================================
  const initialAnchorIndex = activeRange
    ? Math.max(activeRange.top.candleIndex ?? 0, activeRange.bottom.candleIndex ?? 0)
    : 0;
  const loopStartIndex = Math.max(1, initialAnchorIndex + 1);

  for (let i = loopStartIndex; i < evaluationCandles.length; i++) {
    const candle = evaluationCandles[i];
    const decisionTrace: string[] = [];
    let breakIdThisCandle: string | null = null;
    let pointCreatedThisCandle: string | null = null;

    // HARD INVARIANT CHECK BEFORE CANDLE EVALUATION
    if (activeRange && activeRange.status === 'ACTIVE') {
      try {
        if (activeRange.direction === 'BEARISH') {
          assertBearishRange(activeRange);
        } else {
          assertBullishRange(activeRange);
        }
      } catch (invErr: any) {
        decisionTrace.push(
          `STRUCTURE INVARIANT FAILURE on candle ${i} (${candle.openTime}): ${invErr.message}`
        );
        audits.push({
          eventId: `audit_err_${i}_${candle.openTimeUnix}`,
          regimeId: activeRange?.rangeId ?? 'ERROR',
          cycleId: activeRange?.rangeId ?? 'ERROR',
          sequenceId: 'ERROR',
          eventType: 'REJECTED_BREAK',
          status: 'REJECTED',
          trendStateBefore: currentState,
          trendStateAfter: StructureState.UNDEFINED,
          candleIndex: i,
          timestamp: candle.openTime,
          timestampUnix: candle.openTimeUnix,
          price: candle.close,
          previousLockedAnchorType: null,
          previousLockedAnchorPrice: null,
          previousLockedAnchorTime: null,
          previousStructuralExtremeType: null,
          previousStructuralExtremePrice: null,
          previousStructuralExtremeTime: null,
          breakRequired: false,
          breakLevel: null,
          breakWasBodyClose: false,
          breakWasWickOnly: false,
          candidateExtremeType: null,
          candidateExtremePrice: null,
          candidateExtremeTime: null,
          retracementStartTime: null,
          retracementExtremePrice: null,
          retracementExtremeTime: null,
          retracementCandleCount: 0,
          requiredRetracementCandles: 0,
          candleCountQualified: false,
          fibAnchorPrice: null,
          fibExtremePrice: null,
          fibRequiredRatio: 0,
          fibRequiredPrice: null,
          actualRetracementRatio: 0,
          fibQualified: false,
          decision: 'STRUCTURE_ENGINE_ERROR',
          decisionReason: `STRUCTURE INVARIANT FAILURE: ${invErr.message}`,
          algorithmVersion: effectiveAlgorithmVersion,
        });
        currentState = StructureState.UNDEFINED;
        break; // Stop calculation immediately on corruption
      }
    }

    if (!activeRange) {
      // Dynamic range establishment if no range active
      const sub = evaluationCandles.slice(0, i + 1);
      const discovered = discoverInitialExternalRange(sub);
      if (discovered) {
        rangeSequenceIndex++;
        const rangeId = `${discovered.direction}_RANGE_${rangeSequenceIndex}`;

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
          assertBearishRange(activeRange);
          ranges.push(activeRange);

          const p1 = createPointFromBoundary(lhAnchor, rangeId, 'BEARISH', true, false, effectiveAlgorithmVersion);
          const p2 = createPointFromBoundary(llAnchor, rangeId, 'BEARISH', false, true, effectiveAlgorithmVersion);
          points.push(p1, p2);

          currentState = StructureState.BEARISH;
          lastConfirmedLHPoint = p1;
          retracementStartTime = llAnchor.candleTime;
          retracementStartTimeUnix = llAnchor.candleTimeUnix;
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
          assertBullishRange(activeRange);
          ranges.push(activeRange);

          const p1 = createPointFromBoundary(hhAnchor, rangeId, 'BULLISH', true, false, effectiveAlgorithmVersion);
          const p2 = createPointFromBoundary(hlAnchor, rangeId, 'BULLISH', false, true, effectiveAlgorithmVersion);
          points.push(p1, p2);

          currentState = StructureState.BULLISH;
          lastConfirmedHLPoint = p2;
          bullishRetracementStartTime = hhAnchor.candleTime;
          bullishRetracementStartTimeUnix = hhAnchor.candleTimeUnix;
        }
        currentPhase = 'RANGE_LOCKED';
      }

      recordStep(
        replaySteps,
        i,
        candle,
        currentState,
        currentPhase,
        activeRange,
        ['Waiting for initial structural range to form'],
        null,
        null
      );
      continue;
    }

    // ----------------------------------------------------
    // ACTIVE BEARISH STRUCTURE STATE MACHINE
    // ----------------------------------------------------
    if (activeRange.direction === 'BEARISH') {
      const activeLH = activeRange.top.price;
      const activeLL = activeRange.bottom.price;

      if (currentPhase === 'RANGE_LOCKED') {
        // Track candidate provisional LH during retracement
        if (provisionalLHPrice > -Infinity && candle.high > provisionalLHPrice) {
          provisionalLHPrice = candle.high;
          provisionalLHCandle = candle;
          provisionalLHIndex = i;
          retracementCandidateCount++;
          decisionTrace.push(
            `Retracement advancing higher: provisional LH @ ${candle.high.toFixed(2)}.`
          );
        }

        // Case 1: Invalidation Reversal Break (close > activeLH)
        if (candle.close > activeLH) {
          decisionTrace.push(
            `Candle body closed at ${candle.close.toFixed(2)} > active LH (${activeLH.toFixed(2)}). BEARISH STRUCTURE BROKEN; REVERSAL TO BULLISH.`
          );
          const breakId = `break_bear_rev_${activeRange.rangeId}_${candle.openTimeUnix}`;
          breakIdThisCandle = breakId;

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

          // Discover the swing low that formed the base of this reversal impulse
          // Search backwards from break candle to find lowest low
          let lowestImpulseLow = candle.low;
          let lowestImpulseCandle = candle;
          let lowestImpulseIndex = i;

          const searchStart = Math.max(0, (activeRange.bottom.candleIndex ?? i) - 2);
          for (let s = searchStart; s <= i; s++) {
            const sc = evaluationCandles[s];
            if (sc && sc.low < lowestImpulseLow) {
              lowestImpulseLow = sc.low;
              lowestImpulseCandle = sc;
              lowestImpulseIndex = s;
            }
          }

          rangeSequenceIndex++;
          const newRangeId = `BULLISH_RANGE_${rangeSequenceIndex}`;

          // Create brand new HL anchor with immutable, distinct eventId
          const newHLLabel = `HL${rangeSequenceIndex}`;
          const newHLPoint: StructurePoint = {
            id: `v5_HL_${rangeSequenceIndex}_${lowestImpulseCandle.openTimeUnix}`,
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            candleOpenTime: lowestImpulseCandle.openTime,
            candleOpenTimeUnix: lowestImpulseCandle.openTimeUnix,
            candleIndex: lowestImpulseIndex,
            type: StructurePointType.HL,
            price: lowestImpulseLow,
            strength: StructureStrength.MAJOR,
            algorithmVersion: effectiveAlgorithmVersion,
            rangeId: newRangeId,
            sequenceLabel: newHLLabel,
            sequenceIndex: rangeSequenceIndex,
            isRangeBottom: true,
            isRangeTop: false,
            confirmationReason: `Swing low preceding bullish reversal break of ${activeRange.top.label}.`,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };
          points.push(newHLPoint);
          lastConfirmedHLPoint = newHLPoint;

          // Create brand new HH anchor for the reversal impulse top
          const newHHLabel = `HH${rangeSequenceIndex}`;
          const newHHPoint: StructurePoint = {
            id: `v5_HH_${rangeSequenceIndex}_${candle.openTimeUnix}`,
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            candleOpenTime: candle.openTime,
            candleOpenTimeUnix: candle.openTimeUnix,
            candleIndex: i,
            type: StructurePointType.HH,
            price: candle.high,
            strength: StructureStrength.MAJOR,
            algorithmVersion: effectiveAlgorithmVersion,
            rangeId: newRangeId,
            sequenceLabel: newHHLabel,
            sequenceIndex: rangeSequenceIndex,
            isRangeTop: true,
            isRangeBottom: false,
            confirmationReason: `Reversal impulse high breaking bearish structure above ${activeLH.toFixed(2)}.`,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };
          points.push(newHHPoint);

          const hhAnchor: TypedStructuralAnchor<StructurePointType.HH> = {
            type: StructurePointType.HH,
            price: candle.high,
            candleTime: candle.openTime,
            candleTimeUnix: candle.openTimeUnix,
            candleIndex: i,
            label: newHHLabel,
            eventId: newHHPoint.id,
            rangeId: newRangeId,
          };
          const hlAnchor: TypedStructuralAnchor<StructurePointType.HL> = {
            type: StructurePointType.HL,
            price: lowestImpulseLow,
            candleTime: lowestImpulseCandle.openTime,
            candleTimeUnix: lowestImpulseCandle.openTimeUnix,
            candleIndex: lowestImpulseIndex,
            label: newHLLabel,
            eventId: newHLPoint.id,
            rangeId: newRangeId,
          };

          activeRange = createBullishRange(hhAnchor, hlAnchor, newRangeId, rangeSequenceIndex);
          assertBullishRange(activeRange);
          ranges.push(activeRange);

          currentState = StructureState.BULLISH;
          currentPhase = 'RANGE_LOCKED';
          provisionalHLPrice = candle.low;
          provisionalHLCandle = candle;
          provisionalHLIndex = i;
          bullishRetracementStartTime = candle.openTime;
          bullishRetracementStartTimeUnix = candle.openTimeUnix;
          bullishRetracementCandidateCount = 1;
        }
        // Case 2: Continuation Break (close < activeLL) -> ELIGIBILITY GATE PASSED!
        else if (candle.close < activeLL) {
          decisionTrace.push(
            `Candle body closed at ${candle.close.toFixed(2)} < active LL (${activeLL.toFixed(2)}). VALID BEARISH CONTINUATION BREAK.`
          );
          const breakId = `break_bear_cont_${activeRange.rangeId}_${candle.openTimeUnix}`;
          breakIdThisCandle = breakId;

          breakEvents.push({
            id: breakId,
            candleTime: candle.openTime,
            candleTimeUnix: candle.openTimeUnix,
            candleIndex: i,
            price: candle.close,
            brokenLevel: activeLL,
            breakType: 'BEARISH_CONTINUATION',
            label: `LL BREAK (${activeRange.bottom.label})`,
            regimeId: activeRange.rangeId,
          });

          activeRange.status = 'BROKEN_CONTINUATION';
          activeRange.endedAt = candle.openTime;
          activeRange.endedAtUnix = candle.openTimeUnix;
          activeRange.breakEventId = breakId;
          activeRange.breakCandleTime = candle.openTime;
          activeRange.breakCandleClose = candle.close;

          // Audit continuation decision
          audits.push({
            eventId: breakId,
            regimeId: activeRange.rangeId,
            cycleId: activeRange.rangeId,
            sequenceId: activeRange.bottom.label,
            eventType: 'BEARISH_STRUCTURE_BROKEN',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.BEARISH,
            trendStateAfter: StructureState.BEARISH,
            candleIndex: i,
            timestamp: candle.openTime,
            timestampUnix: candle.openTimeUnix,
            price: candle.close,
            previousLockedAnchorType: StructurePointType.LL,
            previousLockedAnchorPrice: activeLL,
            previousLockedAnchorTime: activeRange.bottom.candleTime,
            previousStructuralExtremeType: StructurePointType.LH,
            previousStructuralExtremePrice: activeLH,
            previousStructuralExtremeTime: activeRange.top.candleTime,
            breakRequired: true,
            breakLevel: activeLL,
            breakCandle: {
              index: i,
              time: candle.openTime,
              timeUnix: candle.openTimeUnix,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              wickExceededLevel: true,
              bodyCloseExceededLevel: true,
            },
            breakCandleOpen: candle.open,
            breakCandleHigh: candle.high,
            breakCandleLow: candle.low,
            breakCandleClose: candle.close,
            breakWasBodyClose: true,
            breakWasWickOnly: false,
            candidateExtremeType: StructurePointType.LH,
            candidateExtremePrice: provisionalLHPrice > -Infinity ? provisionalLHPrice : null,
            candidateExtremeTime: provisionalLHCandle?.openTime ?? null,
            candidateExtremeIndex: provisionalLHIndex >= 0 ? provisionalLHIndex : undefined,
            retracementStartTime: retracementStartTime ?? activeRange.bottom.candleTime,
            retracementExtremePrice: provisionalLHPrice > -Infinity ? provisionalLHPrice : null,
            retracementExtremeTime: provisionalLHCandle?.openTime ?? null,
            retracementExtremeIndex: provisionalLHIndex >= 0 ? provisionalLHIndex : undefined,
            retracementCandleCount: retracementCandidateCount,
            requiredRetracementCandles: 1,
            candleCountQualified: true,
            fibAnchorPrice: activeLL,
            fibExtremePrice: activeLH,
            fibRequiredRatio: 0.382,
            fibRequiredPrice: null,
            actualRetracementRatio:
              provisionalLHPrice > -Infinity
                ? (provisionalLHPrice - activeLL) / Math.max(1e-6, activeLH - activeLL)
                : 0,
            fibQualified: true,
            decision: 'VALID BEARISH CONTINUATION',
            decisionReason: `ACTIVE LL: ${activeLL.toFixed(2)} | CLOSE: ${candle.close.toFixed(2)} | CLOSE BELOW LEVEL? YES | DECISION: VALID BEARISH CONTINUATION`,
            algorithmVersion: effectiveAlgorithmVersion,
          });

          // Confirm complete retracement extreme as structural LH if one occurred
          if (provisionalLHPrice > -Infinity && provisionalLHCandle && provisionalLHPrice > activeLL) {
            rangeSequenceIndex++;
            const newLHLabel = `LH${rangeSequenceIndex}`;
            const newLHPoint: StructurePoint = {
              id: `v5_LH_${rangeSequenceIndex}_${provisionalLHCandle.openTimeUnix}`,
              symbol: candle.symbol,
              timeframe: candle.timeframe,
              candleOpenTime: provisionalLHCandle.openTime,
              candleOpenTimeUnix: provisionalLHCandle.openTimeUnix,
              candleIndex: provisionalLHIndex,
              type: StructurePointType.LH,
              price: provisionalLHPrice,
              strength: StructureStrength.MAJOR,
              algorithmVersion: effectiveAlgorithmVersion,
              rangeId: `BEARISH_RANGE_${rangeSequenceIndex}`,
              sequenceLabel: newLHLabel,
              sequenceIndex: rangeSequenceIndex,
              isRangeTop: true,
              isRangeBottom: false,
              confirmationReason: `Highest point of complete retracement (${provisionalLHPrice.toFixed(2)}) before body-confirmed continuation break.`,
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };
            points.push(newLHPoint);
            lastConfirmedLHPoint = newLHPoint;
            pointCreatedThisCandle = newLHLabel;

            audits.push({
              eventId: `audit_LH_${rangeSequenceIndex}_${provisionalLHCandle.openTimeUnix}`,
              regimeId: `BEARISH_RANGE_${rangeSequenceIndex}`,
              cycleId: `BEARISH_RANGE_${rangeSequenceIndex}`,
              sequenceId: newLHLabel,
              eventType: 'LH',
              status: 'CONFIRMED',
              trendStateBefore: StructureState.BEARISH,
              trendStateAfter: StructureState.BEARISH,
              candleIndex: provisionalLHIndex,
              timestamp: provisionalLHCandle.openTime,
              timestampUnix: provisionalLHCandle.openTimeUnix,
              price: provisionalLHPrice,
              previousLockedAnchorType: StructurePointType.LL,
              previousLockedAnchorPrice: activeLL,
              previousLockedAnchorTime: activeRange.bottom.candleTime,
              previousStructuralExtremeType: StructurePointType.LH,
              previousStructuralExtremePrice: activeLH,
              previousStructuralExtremeTime: activeRange.top.candleTime,
              breakRequired: true,
              breakLevel: activeLL,
              breakCandle: {
                index: i,
                time: candle.openTime,
                timeUnix: candle.openTimeUnix,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                wickExceededLevel: true,
                bodyCloseExceededLevel: true,
              },
              breakCandleOpen: candle.open,
              breakCandleHigh: candle.high,
              breakCandleLow: candle.low,
              breakCandleClose: candle.close,
              breakWasBodyClose: true,
              breakWasWickOnly: false,
              candidateExtremeType: StructurePointType.LH,
              candidateExtremePrice: provisionalLHPrice,
              candidateExtremeTime: provisionalLHCandle.openTime,
              candidateExtremeIndex: provisionalLHIndex,
              retracementStartTime: retracementStartTime ?? activeRange.bottom.candleTime,
              retracementExtremePrice: provisionalLHPrice,
              retracementExtremeTime: provisionalLHCandle.openTime,
              retracementExtremeIndex: provisionalLHIndex,
              retracementCandleCount: retracementCandidateCount,
              requiredRetracementCandles: 1,
              candleCountQualified: true,
              fibAnchorPrice: activeLL,
              fibExtremePrice: activeLH,
              fibRequiredRatio: 0.382,
              fibRequiredPrice: null,
              actualRetracementRatio:
                (provisionalLHPrice - activeLL) / Math.max(1e-6, activeLH - activeLL),
              fibQualified: true,
              decision: 'LH CONFIRMED',
              decisionReason: `Retracement Started: ${retracementStartTime ?? activeRange.bottom.candleTime} | Retracement Ended: ${candle.openTime} | Highest High: ${provisionalLHPrice.toFixed(2)} | Confirmed LH before continuation break.`,
              algorithmVersion: effectiveAlgorithmVersion,
            });
          }

          // Transition to EXPANSION
          currentPhase = 'EXPANSION';
          expansionExtremePrice = candle.low;
          expansionExtremeCandle = candle;
          expansionExtremeIndex = i;
        }
        // Case 3: Inside Range / Wick Breach (HARD GATE)
        else {
          if (candle.low < activeLL) {
            const reason = `ACTIVE LL: ${activeLL.toFixed(2)} | BREAK CANDLE LOW: ${candle.low.toFixed(2)} | BREAK CANDLE CLOSE: ${candle.close.toFixed(2)} | LOW BELOW LEVEL? YES | CLOSE BELOW LEVEL? NO | DECISION: REJECTED — WICK ONLY`;
            decisionTrace.push(
              `Wick reached ${candle.low.toFixed(2)} < LL (${activeLL.toFixed(2)}), but Close was ${candle.close.toFixed(2)} >= ${activeLL.toFixed(2)}. WICK IGNORED; NO BREAK.`
            );
            recordWickRejection(
              rejectedEvents,
              candle,
              i,
              activeLL,
              candle.low,
              activeRange.rangeId,
              'REJECTED_INVALIDATION',
              reason
            );
            audits.push({
              eventId: `audit_rej_wick_ll_${i}_${candle.openTimeUnix}`,
              regimeId: activeRange.rangeId,
              cycleId: activeRange.rangeId,
              sequenceId: activeRange.bottom.label,
              eventType: 'REJECTED_BREAK',
              status: 'REJECTED',
              trendStateBefore: StructureState.BEARISH,
              trendStateAfter: StructureState.BEARISH,
              candleIndex: i,
              timestamp: candle.openTime,
              timestampUnix: candle.openTimeUnix,
              price: candle.close,
              previousLockedAnchorType: StructurePointType.LL,
              previousLockedAnchorPrice: activeLL,
              previousLockedAnchorTime: activeRange.bottom.candleTime,
              previousStructuralExtremeType: StructurePointType.LH,
              previousStructuralExtremePrice: activeLH,
              previousStructuralExtremeTime: activeRange.top.candleTime,
              breakRequired: true,
              breakLevel: activeLL,
              breakCandle: {
                index: i,
                time: candle.openTime,
                timeUnix: candle.openTimeUnix,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                wickExceededLevel: true,
                bodyCloseExceededLevel: false,
              },
              breakCandleOpen: candle.open,
              breakCandleHigh: candle.high,
              breakCandleLow: candle.low,
              breakCandleClose: candle.close,
              breakWasBodyClose: false,
              breakWasWickOnly: true,
              candidateExtremeType: null,
              candidateExtremePrice: null,
              candidateExtremeTime: null,
              retracementStartTime: retracementStartTime ?? null,
              retracementExtremePrice: provisionalLHPrice > -Infinity ? provisionalLHPrice : null,
              retracementExtremeTime: provisionalLHCandle?.openTime ?? null,
              retracementCandleCount: retracementCandidateCount,
              requiredRetracementCandles: 1,
              candleCountQualified: true,
              fibAnchorPrice: activeLL,
              fibExtremePrice: activeLH,
              fibRequiredRatio: 0.382,
              fibRequiredPrice: null,
              actualRetracementRatio: 0,
              fibQualified: false,
              decision: 'REJECTED — WICK ONLY',
              decisionReason: reason,
              algorithmVersion: effectiveAlgorithmVersion,
            });
          } else if (candle.high > activeLH) {
            const reason = `ACTIVE LH: ${activeLH.toFixed(2)} | CANDLE HIGH: ${candle.high.toFixed(2)} | CANDLE CLOSE: ${candle.close.toFixed(2)} | HIGH ABOVE LEVEL? YES | CLOSE ABOVE LEVEL? NO | DECISION: REJECTED — WICK ONLY`;
            decisionTrace.push(
              `Wick reached ${candle.high.toFixed(2)} > LH (${activeLH.toFixed(2)}), but Close was ${candle.close.toFixed(2)} <= ${activeLH.toFixed(2)}. WICK IGNORED; NO BREAK.`
            );
            recordWickRejection(
              rejectedEvents,
              candle,
              i,
              activeLH,
              candle.high,
              activeRange.rangeId,
              'REJECTED_INVALIDATION',
              reason
            );
          } else {
            decisionTrace.push(
              `INSIDE ACTIVE RANGE: No structural action. Active bearish range [${activeLL.toFixed(2)}, ${activeLH.toFixed(2)}]. Provisional LH: ${provisionalLHPrice > -Infinity ? provisionalLHPrice.toFixed(2) : 'none'}. Internal price action IGNORED.`
            );
          }
        }
      } else if (currentPhase === 'EXPANSION') {
        // In expansion: track lowest low
        if (candle.low < expansionExtremePrice) {
          expansionExtremePrice = candle.low;
          expansionExtremeCandle = candle;
          expansionExtremeIndex = i;
          decisionTrace.push(
            `Bearish expansion pushing lower: new lowest low at ${candle.low.toFixed(2)}.`
          );
        } else if (candle.close > activeLH) {
          decisionTrace.push(`Reversal during expansion: close > LH (${activeLH.toFixed(2)}).`);
          currentState = StructureState.BULLISH;
          currentPhase = 'RANGE_LOCKED';
        } else if (
          candle.low > expansionExtremePrice &&
          (candle.close > candle.open || candle.close > (expansionExtremeCandle?.close ?? 0))
        ) {
          // Expansion complete! Confirm new LL
          const newLLIndex =
            rangeSequenceIndex === 1 &&
            !points.some((p) => p.type === StructurePointType.LL && p.sequenceIndex === 2)
              ? 2
              : rangeSequenceIndex;
          if (rangeSequenceIndex === 1 && newLLIndex === 2) {
            rangeSequenceIndex = 2;
          }
          const newLLLabel = `LL${newLLIndex}`;
          const newLLPoint: StructurePoint = {
            id: `v5_LL_${newLLIndex}_${expansionExtremeCandle?.openTimeUnix ?? candle.openTimeUnix}`,
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            candleOpenTime: expansionExtremeCandle?.openTime ?? candle.openTime,
            candleOpenTimeUnix: expansionExtremeCandle?.openTimeUnix ?? candle.openTimeUnix,
            candleIndex: expansionExtremeIndex,
            type: StructurePointType.LL,
            price: expansionExtremePrice,
            strength: StructureStrength.MAJOR,
            algorithmVersion: effectiveAlgorithmVersion,
            rangeId: `BEARISH_RANGE_${newLLIndex}`,
            sequenceLabel: newLLLabel,
            sequenceIndex: newLLIndex,
            isRangeBottom: true,
            isRangeTop: false,
            confirmationReason: `Lowest price reached during bearish expansion (${expansionExtremePrice.toFixed(2)}) before retracement began.`,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };
          points.push(newLLPoint);
          pointCreatedThisCandle = newLLLabel;

          // Establish new locked range [expansionExtremePrice, topAnchor]
          // Top anchor MUST strictly be LH and strictly above expansionExtremePrice
          const topPointCandidate =
            lastConfirmedLHPoint &&
            lastConfirmedLHPoint.type === StructurePointType.LH &&
            lastConfirmedLHPoint.price > expansionExtremePrice
              ? lastConfirmedLHPoint
              : activeRange.top.type === StructurePointType.LH &&
                activeRange.top.price > expansionExtremePrice
              ? activeRange.top
              : points
                  .filter(
                    (p) =>
                      p.type === StructurePointType.LH &&
                      p.price > expansionExtremePrice
                  )
                  .slice(-1)[0];

          if (!topPointCandidate) {
            throw new Error(
              `STRUCTURE INVARIANT FAILURE: No valid LH point found above new LL price (${expansionExtremePrice})`
            );
          }

          const topAnchor: TypedStructuralAnchor<StructurePointType.LH> = getAnchorProps(
            topPointCandidate,
            StructurePointType.LH,
            `LH${newLLIndex}`,
            candle.openTime,
            candle.openTimeUnix
          );

          const bottomAnchor: TypedStructuralAnchor<StructurePointType.LL> = {
            type: StructurePointType.LL,
            price: expansionExtremePrice,
            candleTime: expansionExtremeCandle?.openTime ?? candle.openTime,
            candleTimeUnix: expansionExtremeCandle?.openTimeUnix ?? candle.openTimeUnix,
            candleIndex: expansionExtremeIndex,
            label: newLLLabel,
            eventId: newLLPoint.id,
            rangeId: `BEARISH_RANGE_${newLLIndex}`,
          };

          const newRangeId = `BEARISH_RANGE_${newLLIndex}`;
          activeRange = createBearishRange(topAnchor, bottomAnchor, newRangeId, newLLIndex);
          assertBearishRange(activeRange);
          ranges.push(activeRange);

          // Transition back to RANGE_LOCKED
          currentPhase = 'RANGE_LOCKED';
          provisionalLHPrice = candle.high;
          provisionalLHCandle = candle;
          provisionalLHIndex = i;
          retracementStartTime = candle.openTime;
          retracementStartTimeUnix = candle.openTimeUnix;
          retracementCandidateCount = 1;

          decisionTrace.push(
            `Bearish expansion ended. Confirmed ${newLLLabel} @ ${expansionExtremePrice.toFixed(2)}. Range locked: [${expansionExtremePrice.toFixed(2)}, ${activeRange.top.price.toFixed(2)}]. Tracking provisional retracement.`
          );
        } else {
          decisionTrace.push(
            `Bearish expansion continuing at close ${candle.close.toFixed(2)}. Current lowest low: ${expansionExtremePrice.toFixed(2)}.`
          );
        }
      }
    }
    // ----------------------------------------------------
    // ACTIVE BULLISH STRUCTURE STATE MACHINE (EXACT MIRROR)
    // ----------------------------------------------------
    else if (activeRange.direction === 'BULLISH') {
      const activeHH = activeRange.top.price;
      const activeHL = activeRange.bottom.price;

      if (currentPhase === 'RANGE_LOCKED') {
        // Track candidate provisional HL during retracement
        if (provisionalHLPrice < Infinity && candle.low < provisionalHLPrice) {
          provisionalHLPrice = candle.low;
          provisionalHLCandle = candle;
          provisionalHLIndex = i;
          bullishRetracementCandidateCount++;
          decisionTrace.push(
            `Retracement advancing lower: provisional HL @ ${candle.low.toFixed(2)}.`
          );
        }

        // Case 1: Invalidation Reversal Break (close < activeHL)
        if (candle.close < activeHL) {
          decisionTrace.push(
            `Candle body closed at ${candle.close.toFixed(2)} < active HL (${activeHL.toFixed(2)}). BULLISH STRUCTURE BROKEN; REVERSAL TO BEARISH.`
          );
          const breakId = `break_bull_rev_${activeRange.rangeId}_${candle.openTimeUnix}`;
          breakIdThisCandle = breakId;

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

          // Discover the swing high that formed the base of this reversal drop
          let highestImpulseHigh = candle.high;
          let highestImpulseCandle = candle;
          let highestImpulseIndex = i;

          const searchStart = Math.max(0, (activeRange.top.candleIndex ?? i) - 2);
          for (let s = searchStart; s <= i; s++) {
            const sc = evaluationCandles[s];
            if (sc && sc.high > highestImpulseHigh) {
              highestImpulseHigh = sc.high;
              highestImpulseCandle = sc;
              highestImpulseIndex = s;
            }
          }

          rangeSequenceIndex++;
          const newRangeId = `BEARISH_RANGE_${rangeSequenceIndex}`;

          // Create brand new LH anchor with immutable, distinct eventId
          const newLHLabel = `LH${rangeSequenceIndex}`;
          const newLHPoint: StructurePoint = {
            id: `v5_LH_${rangeSequenceIndex}_${highestImpulseCandle.openTimeUnix}`,
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            candleOpenTime: highestImpulseCandle.openTime,
            candleOpenTimeUnix: highestImpulseCandle.openTimeUnix,
            candleIndex: highestImpulseIndex,
            type: StructurePointType.LH,
            price: highestImpulseHigh,
            strength: StructureStrength.MAJOR,
            algorithmVersion: effectiveAlgorithmVersion,
            rangeId: newRangeId,
            sequenceLabel: newLHLabel,
            sequenceIndex: rangeSequenceIndex,
            isRangeTop: true,
            isRangeBottom: false,
            confirmationReason: `Swing high preceding bearish reversal break of ${activeRange.bottom.label}.`,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };
          points.push(newLHPoint);
          lastConfirmedLHPoint = newLHPoint;

          // Create brand new LL anchor for the reversal impulse low
          const newLLLabel = `LL${rangeSequenceIndex}`;
          const newLLPoint: StructurePoint = {
            id: `v5_LL_${rangeSequenceIndex}_${candle.openTimeUnix}`,
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            candleOpenTime: candle.openTime,
            candleOpenTimeUnix: candle.openTimeUnix,
            candleIndex: i,
            type: StructurePointType.LL,
            price: candle.low,
            strength: StructureStrength.MAJOR,
            algorithmVersion: effectiveAlgorithmVersion,
            rangeId: newRangeId,
            sequenceLabel: newLLLabel,
            sequenceIndex: rangeSequenceIndex,
            isRangeBottom: true,
            isRangeTop: false,
            confirmationReason: `Reversal impulse low breaking bullish structure below ${activeHL.toFixed(2)}.`,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };
          points.push(newLLPoint);

          const lhAnchor: TypedStructuralAnchor<StructurePointType.LH> = {
            type: StructurePointType.LH,
            price: highestImpulseHigh,
            candleTime: highestImpulseCandle.openTime,
            candleTimeUnix: highestImpulseCandle.openTimeUnix,
            candleIndex: highestImpulseIndex,
            label: newLHLabel,
            eventId: newLHPoint.id,
            rangeId: newRangeId,
          };
          const llAnchor: TypedStructuralAnchor<StructurePointType.LL> = {
            type: StructurePointType.LL,
            price: candle.low,
            candleTime: candle.openTime,
            candleTimeUnix: candle.openTimeUnix,
            candleIndex: i,
            label: newLLLabel,
            eventId: newLLPoint.id,
            rangeId: newRangeId,
          };

          activeRange = createBearishRange(lhAnchor, llAnchor, newRangeId, rangeSequenceIndex);
          assertBearishRange(activeRange);
          ranges.push(activeRange);

          currentState = StructureState.BEARISH;
          currentPhase = 'RANGE_LOCKED';
          provisionalLHPrice = candle.high;
          provisionalLHCandle = candle;
          provisionalLHIndex = i;
          retracementStartTime = candle.openTime;
          retracementStartTimeUnix = candle.openTimeUnix;
          retracementCandidateCount = 1;
        }
        // Case 2: Continuation Break (close > activeHH) -> ELIGIBILITY GATE PASSED!
        else if (candle.close > activeHH) {
          decisionTrace.push(
            `Candle body closed at ${candle.close.toFixed(2)} > active HH (${activeHH.toFixed(2)}). VALID BULLISH CONTINUATION BREAK.`
          );
          const breakId = `break_bull_cont_${activeRange.rangeId}_${candle.openTimeUnix}`;
          breakIdThisCandle = breakId;

          breakEvents.push({
            id: breakId,
            candleTime: candle.openTime,
            candleTimeUnix: candle.openTimeUnix,
            candleIndex: i,
            price: candle.close,
            brokenLevel: activeHH,
            breakType: 'BULLISH_CONTINUATION',
            label: `HH BREAK (${activeRange.top.label})`,
            regimeId: activeRange.rangeId,
          });

          activeRange.status = 'BROKEN_CONTINUATION';
          activeRange.endedAt = candle.openTime;
          activeRange.endedAtUnix = candle.openTimeUnix;
          activeRange.breakEventId = breakId;
          activeRange.breakCandleTime = candle.openTime;
          activeRange.breakCandleClose = candle.close;

          // Audit continuation decision
          audits.push({
            eventId: breakId,
            regimeId: activeRange.rangeId,
            cycleId: activeRange.rangeId,
            sequenceId: activeRange.top.label,
            eventType: 'BULLISH_STRUCTURE_BROKEN',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.BULLISH,
            trendStateAfter: StructureState.BULLISH,
            candleIndex: i,
            timestamp: candle.openTime,
            timestampUnix: candle.openTimeUnix,
            price: candle.close,
            previousLockedAnchorType: StructurePointType.HH,
            previousLockedAnchorPrice: activeHH,
            previousLockedAnchorTime: activeRange.top.candleTime,
            previousStructuralExtremeType: StructurePointType.HL,
            previousStructuralExtremePrice: activeHL,
            previousStructuralExtremeTime: activeRange.bottom.candleTime,
            breakRequired: true,
            breakLevel: activeHH,
            breakCandle: {
              index: i,
              time: candle.openTime,
              timeUnix: candle.openTimeUnix,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              wickExceededLevel: true,
              bodyCloseExceededLevel: true,
            },
            breakCandleOpen: candle.open,
            breakCandleHigh: candle.high,
            breakCandleLow: candle.low,
            breakCandleClose: candle.close,
            breakWasBodyClose: true,
            breakWasWickOnly: false,
            candidateExtremeType: StructurePointType.HL,
            candidateExtremePrice: provisionalHLPrice < Infinity ? provisionalHLPrice : null,
            candidateExtremeTime: provisionalHLCandle?.openTime ?? null,
            candidateExtremeIndex: provisionalHLIndex >= 0 ? provisionalHLIndex : undefined,
            retracementStartTime: bullishRetracementStartTime ?? activeRange.top.candleTime,
            retracementExtremePrice: provisionalHLPrice < Infinity ? provisionalHLPrice : null,
            retracementExtremeTime: provisionalHLCandle?.openTime ?? null,
            retracementExtremeIndex: provisionalHLIndex >= 0 ? provisionalHLIndex : undefined,
            retracementCandleCount: bullishRetracementCandidateCount,
            requiredRetracementCandles: 1,
            candleCountQualified: true,
            fibAnchorPrice: activeHH,
            fibExtremePrice: activeHL,
            fibRequiredRatio: 0.382,
            fibRequiredPrice: null,
            actualRetracementRatio:
              provisionalHLPrice < Infinity
                ? (activeHH - provisionalHLPrice) / Math.max(1e-6, activeHH - activeHL)
                : 0,
            fibQualified: true,
            decision: 'VALID BULLISH CONTINUATION',
            decisionReason: `ACTIVE HH: ${activeHH.toFixed(2)} | CLOSE: ${candle.close.toFixed(2)} | CLOSE ABOVE LEVEL? YES | DECISION: VALID BULLISH CONTINUATION`,
            algorithmVersion: effectiveAlgorithmVersion,
          });

          // Confirm complete retracement extreme as structural HL if one occurred
          if (provisionalHLPrice < Infinity && provisionalHLCandle && provisionalHLPrice < activeHH) {
            rangeSequenceIndex++;
            const newHLLabel = `HL${rangeSequenceIndex}`;
            const newHLPoint: StructurePoint = {
              id: `v5_HL_${rangeSequenceIndex}_${provisionalHLCandle.openTimeUnix}`,
              symbol: candle.symbol,
              timeframe: candle.timeframe,
              candleOpenTime: provisionalHLCandle.openTime,
              candleOpenTimeUnix: provisionalHLCandle.openTimeUnix,
              candleIndex: provisionalHLIndex,
              type: StructurePointType.HL,
              price: provisionalHLPrice,
              strength: StructureStrength.MAJOR,
              algorithmVersion: effectiveAlgorithmVersion,
              rangeId: `BULLISH_RANGE_${rangeSequenceIndex}`,
              sequenceLabel: newHLLabel,
              sequenceIndex: rangeSequenceIndex,
              isRangeBottom: true,
              isRangeTop: false,
              confirmationReason: `Lowest point of complete retracement (${provisionalHLPrice.toFixed(2)}) before body-confirmed continuation break.`,
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };
            points.push(newHLPoint);
            lastConfirmedHLPoint = newHLPoint;
            pointCreatedThisCandle = newHLLabel;

            audits.push({
              eventId: `audit_HL_${rangeSequenceIndex}_${provisionalHLCandle.openTimeUnix}`,
              regimeId: `BULLISH_RANGE_${rangeSequenceIndex}`,
              cycleId: `BULLISH_RANGE_${rangeSequenceIndex}`,
              sequenceId: newHLLabel,
              eventType: 'HL',
              status: 'CONFIRMED',
              trendStateBefore: StructureState.BULLISH,
              trendStateAfter: StructureState.BULLISH,
              candleIndex: provisionalHLIndex,
              timestamp: provisionalHLCandle.openTime,
              timestampUnix: provisionalHLCandle.openTimeUnix,
              price: provisionalHLPrice,
              previousLockedAnchorType: StructurePointType.HH,
              previousLockedAnchorPrice: activeHH,
              previousLockedAnchorTime: activeRange.top.candleTime,
              previousStructuralExtremeType: StructurePointType.HL,
              previousStructuralExtremePrice: activeHL,
              previousStructuralExtremeTime: activeRange.bottom.candleTime,
              breakRequired: true,
              breakLevel: activeHH,
              breakCandle: {
                index: i,
                time: candle.openTime,
                timeUnix: candle.openTimeUnix,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                wickExceededLevel: true,
                bodyCloseExceededLevel: true,
              },
              breakCandleOpen: candle.open,
              breakCandleHigh: candle.high,
              breakCandleLow: candle.low,
              breakCandleClose: candle.close,
              breakWasBodyClose: true,
              breakWasWickOnly: false,
              candidateExtremeType: StructurePointType.HL,
              candidateExtremePrice: provisionalHLPrice,
              candidateExtremeTime: provisionalHLCandle.openTime,
              candidateExtremeIndex: provisionalHLIndex,
              retracementStartTime: bullishRetracementStartTime ?? activeRange.top.candleTime,
              retracementExtremePrice: provisionalHLPrice,
              retracementExtremeTime: provisionalHLCandle.openTime,
              retracementExtremeIndex: provisionalHLIndex,
              retracementCandleCount: bullishRetracementCandidateCount,
              requiredRetracementCandles: 1,
              candleCountQualified: true,
              fibAnchorPrice: activeHH,
              fibExtremePrice: activeHL,
              fibRequiredRatio: 0.382,
              fibRequiredPrice: null,
              actualRetracementRatio:
                (activeHH - provisionalHLPrice) / Math.max(1e-6, activeHH - activeHL),
              fibQualified: true,
              decision: 'HL CONFIRMED',
              decisionReason: `Retracement Started: ${bullishRetracementStartTime ?? activeRange.top.candleTime} | Retracement Ended: ${candle.openTime} | Lowest Low: ${provisionalHLPrice.toFixed(2)} | Confirmed HL before continuation break.`,
              algorithmVersion: effectiveAlgorithmVersion,
            });
          }

          // Transition to EXPANSION
          currentPhase = 'EXPANSION';
          expansionExtremePrice = candle.high;
          expansionExtremeCandle = candle;
          expansionExtremeIndex = i;
        }
        // Case 3: Inside Range / Wick Breach (HARD GATE)
        else {
          if (candle.high > activeHH) {
            const reason = `ACTIVE HH: ${activeHH.toFixed(2)} | BREAK CANDLE HIGH: ${candle.high.toFixed(2)} | BREAK CANDLE CLOSE: ${candle.close.toFixed(2)} | HIGH ABOVE LEVEL? YES | CLOSE ABOVE LEVEL? NO | DECISION: REJECTED — WICK ONLY`;
            decisionTrace.push(
              `Wick reached ${candle.high.toFixed(2)} > HH (${activeHH.toFixed(2)}), but Close was ${candle.close.toFixed(2)} <= ${activeHH.toFixed(2)}. WICK IGNORED; NO BREAK.`
            );
            recordWickRejection(
              rejectedEvents,
              candle,
              i,
              activeHH,
              candle.high,
              activeRange.rangeId,
              'REJECTED_INVALIDATION',
              reason
            );
            audits.push({
              eventId: `audit_rej_wick_hh_${i}_${candle.openTimeUnix}`,
              regimeId: activeRange.rangeId,
              cycleId: activeRange.rangeId,
              sequenceId: activeRange.top.label,
              eventType: 'REJECTED_BREAK',
              status: 'REJECTED',
              trendStateBefore: StructureState.BULLISH,
              trendStateAfter: StructureState.BULLISH,
              candleIndex: i,
              timestamp: candle.openTime,
              timestampUnix: candle.openTimeUnix,
              price: candle.close,
              previousLockedAnchorType: StructurePointType.HH,
              previousLockedAnchorPrice: activeHH,
              previousLockedAnchorTime: activeRange.top.candleTime,
              previousStructuralExtremeType: StructurePointType.HL,
              previousStructuralExtremePrice: activeHL,
              previousStructuralExtremeTime: activeRange.bottom.candleTime,
              breakRequired: true,
              breakLevel: activeHH,
              breakCandle: {
                index: i,
                time: candle.openTime,
                timeUnix: candle.openTimeUnix,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                wickExceededLevel: true,
                bodyCloseExceededLevel: false,
              },
              breakCandleOpen: candle.open,
              breakCandleHigh: candle.high,
              breakCandleLow: candle.low,
              breakCandleClose: candle.close,
              breakWasBodyClose: false,
              breakWasWickOnly: true,
              candidateExtremeType: null,
              candidateExtremePrice: null,
              candidateExtremeTime: null,
              retracementStartTime: bullishRetracementStartTime ?? null,
              retracementExtremePrice: provisionalHLPrice < Infinity ? provisionalHLPrice : null,
              retracementExtremeTime: provisionalHLCandle?.openTime ?? null,
              retracementCandleCount: bullishRetracementCandidateCount,
              requiredRetracementCandles: 1,
              candleCountQualified: true,
              fibAnchorPrice: activeHH,
              fibExtremePrice: activeHL,
              fibRequiredRatio: 0.382,
              fibRequiredPrice: null,
              actualRetracementRatio: 0,
              fibQualified: false,
              decision: 'REJECTED — WICK ONLY',
              decisionReason: reason,
              algorithmVersion: effectiveAlgorithmVersion,
            });
          } else if (candle.low < activeHL) {
            const reason = `ACTIVE HL: ${activeHL.toFixed(2)} | CANDLE LOW: ${candle.low.toFixed(2)} | CANDLE CLOSE: ${candle.close.toFixed(2)} | LOW BELOW LEVEL? YES | CLOSE BELOW LEVEL? NO | DECISION: REJECTED — WICK ONLY`;
            decisionTrace.push(
              `Wick reached ${candle.low.toFixed(2)} < HL (${activeHL.toFixed(2)}), but Close was ${candle.close.toFixed(2)} >= ${activeHL.toFixed(2)}. WICK IGNORED; NO BREAK.`
            );
            recordWickRejection(
              rejectedEvents,
              candle,
              i,
              activeHL,
              candle.low,
              activeRange.rangeId,
              'REJECTED_INVALIDATION',
              reason
            );
          } else {
            decisionTrace.push(
              `INSIDE ACTIVE RANGE: No structural action. Active bullish range [${activeHL.toFixed(2)}, ${activeHH.toFixed(2)}]. Provisional HL: ${provisionalHLPrice < Infinity ? provisionalHLPrice.toFixed(2) : 'none'}. Internal price action IGNORED.`
            );
          }
        }
      } else if (currentPhase === 'EXPANSION') {
        // In expansion: track highest high
        if (candle.high > expansionExtremePrice) {
          expansionExtremePrice = candle.high;
          expansionExtremeCandle = candle;
          expansionExtremeIndex = i;
          decisionTrace.push(
            `Bullish expansion pushing higher: new highest high at ${candle.high.toFixed(2)}.`
          );
        } else if (candle.close < activeHL) {
          decisionTrace.push(`Reversal during expansion: close < HL (${activeHL.toFixed(2)}).`);
          currentState = StructureState.BEARISH;
          currentPhase = 'RANGE_LOCKED';
        } else if (
          candle.high < expansionExtremePrice &&
          (candle.close < candle.open ||
            candle.close < (expansionExtremeCandle?.close ?? Infinity))
        ) {
          // Expansion complete! Confirm new HH
          const newHHIndex =
            rangeSequenceIndex === 1 &&
            !points.some((p) => p.type === StructurePointType.HH && p.sequenceIndex === 2)
              ? 2
              : rangeSequenceIndex;
          if (rangeSequenceIndex === 1 && newHHIndex === 2) {
            rangeSequenceIndex = 2;
          }
          const newHHLabel = `HH${newHHIndex}`;
          const newHHPoint: StructurePoint = {
            id: `v5_HH_${newHHIndex}_${expansionExtremeCandle?.openTimeUnix ?? candle.openTimeUnix}`,
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            candleOpenTime: expansionExtremeCandle?.openTime ?? candle.openTime,
            candleOpenTimeUnix: expansionExtremeCandle?.openTimeUnix ?? candle.openTimeUnix,
            candleIndex: expansionExtremeIndex,
            type: StructurePointType.HH,
            price: expansionExtremePrice,
            strength: StructureStrength.MAJOR,
            algorithmVersion: effectiveAlgorithmVersion,
            rangeId: `BULLISH_RANGE_${newHHIndex}`,
            sequenceLabel: newHHLabel,
            sequenceIndex: newHHIndex,
            isRangeTop: true,
            isRangeBottom: false,
            confirmationReason: `Highest price reached during bullish expansion (${expansionExtremePrice.toFixed(2)}) before retracement began.`,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };
          points.push(newHHPoint);
          pointCreatedThisCandle = newHHLabel;

          // Establish new locked range [bottomAnchor, expansionExtremePrice]
          // Bottom anchor MUST strictly be HL and strictly below expansionExtremePrice
          const bottomPointCandidate =
            lastConfirmedHLPoint &&
            lastConfirmedHLPoint.type === StructurePointType.HL &&
            lastConfirmedHLPoint.price < expansionExtremePrice
              ? lastConfirmedHLPoint
              : activeRange.bottom.type === StructurePointType.HL &&
                activeRange.bottom.price < expansionExtremePrice
              ? activeRange.bottom
              : points
                  .filter(
                    (p) =>
                      p.type === StructurePointType.HL &&
                      p.price < expansionExtremePrice
                  )
                  .slice(-1)[0];

          if (!bottomPointCandidate) {
            throw new Error(
              `STRUCTURE INVARIANT FAILURE: No valid HL point found below new HH price (${expansionExtremePrice})`
            );
          }

          const bottomAnchor: TypedStructuralAnchor<StructurePointType.HL> = getAnchorProps(
            bottomPointCandidate,
            StructurePointType.HL,
            `HL${newHHIndex}`,
            candle.openTime,
            candle.openTimeUnix
          );

          const topAnchor: TypedStructuralAnchor<StructurePointType.HH> = {
            type: StructurePointType.HH,
            price: expansionExtremePrice,
            candleTime: expansionExtremeCandle?.openTime ?? candle.openTime,
            candleTimeUnix: expansionExtremeCandle?.openTimeUnix ?? candle.openTimeUnix,
            candleIndex: expansionExtremeIndex,
            label: newHHLabel,
            eventId: newHHPoint.id,
            rangeId: `BULLISH_RANGE_${newHHIndex}`,
          };

          const newRangeId = `BULLISH_RANGE_${newHHIndex}`;
          activeRange = createBullishRange(topAnchor, bottomAnchor, newRangeId, newHHIndex);
          assertBullishRange(activeRange);
          ranges.push(activeRange);

          // Transition back to RANGE_LOCKED
          currentPhase = 'RANGE_LOCKED';
          provisionalHLPrice = candle.low;
          provisionalHLCandle = candle;
          provisionalHLIndex = i;
          bullishRetracementStartTime = candle.openTime;
          bullishRetracementStartTimeUnix = candle.openTimeUnix;
          bullishRetracementCandidateCount = 1;

          decisionTrace.push(
            `Bullish expansion ended. Confirmed ${newHHLabel} @ ${expansionExtremePrice.toFixed(2)}. Range locked: [${activeRange.bottom.price.toFixed(2)}, ${expansionExtremePrice.toFixed(2)}]. Tracking provisional retracement.`
          );
        } else {
          decisionTrace.push(
            `Bullish expansion continuing at close ${candle.close.toFixed(2)}. Current highest high: ${expansionExtremePrice.toFixed(2)}.`
          );
        }
      }
    }

    // Record Candle Replay Step for this candle with engineState
    recordStep(
      replaySteps,
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

  // Deduplicate and sort points chronologically
  const sortedPoints = deduplicatePoints(points);

  const hhPoints = sortedPoints.filter((p) => p.type === StructurePointType.HH);
  const hlPoints = sortedPoints.filter((p) => p.type === StructurePointType.HL);
  const lhPoints = sortedPoints.filter((p) => p.type === StructurePointType.LH);
  const llPoints = sortedPoints.filter((p) => p.type === StructurePointType.LL);

  const executionTimeMs = Date.now() - startTime;

  // Build Engine State Snapshot for the final evaluated state
  const finalEngineState: EngineStateSnapshot = {
    state: currentState,
    phase: currentPhase,
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
    lastBreakEvent: breakEvents[breakEvents.length - 1]?.id ?? null,
    candleIndex: evaluationCandles.length - 1,
    rangeId: activeRange?.rangeId,
    direction: activeRange?.direction,
  };

  return {
    symbol: evaluationCandles[0]?.symbol ?? 'BTC_USDT',
    timeframe: evaluationCandles[0]?.timeframe ?? '5M',
    algorithmVersion: effectiveAlgorithmVersion,
    parameters: {
      analysisCandles,
      initializationSearchCandles: warmUpCandles,
      breakConfirmation: 'CLOSE',
      minimumRetracementCandles: customParams?.minimumRetracementCandles ?? 4,
      minimumRetracementFib: customParams?.minimumRetracementFib ?? 0.382,
      lookbackCandles: lookback,
      fibTouchMode: 'WICK',
      algorithmVersion: effectiveAlgorithmVersion,
      showInternalPriceActionDebug: customParams?.showInternalPriceActionDebug ?? false,
      manualStart: customParams?.manualStart,
    },
    structureState: currentState,
    stateLabel: currentState,
    totalCandlesAvailable: allCandles.length,
    closedCandlesEvaluated: evaluationCandles.length,
    unclosedCandleExcluded: allCandles.some((c) => c.isClosed === false),
    workingWindowStart: evaluationCandles[0]?.openTime ?? null,
    workingWindowEnd: evaluationCandles[evaluationCandles.length - 1]?.openTime ?? null,

    hhCount: hhPoints.length,
    hlCount: hlPoints.length,
    lhCount: lhPoints.length,
    llCount: llPoints.length,
    provisionalCount: 0,
    totalPointsCount: sortedPoints.length,

    lastHH: hhPoints[hhPoints.length - 1] ?? null,
    lastHL: hlPoints[hlPoints.length - 1] ?? null,
    lastLH: lhPoints[lhPoints.length - 1] ?? null,
    lastLL: llPoints[llPoints.length - 1] ?? null,
    activeProvisionalPoint: null,
    activeRetracement: null,

    initialization: initResult,
    analysisCandles,
    initializationSearchCandles: warmUpCandles,
    ranges,
    activeRange,
    internalStructureIgnored: true,
    structureBreakEvents: breakEvents,
    points: sortedPoints,
    eventLogs,
    audits,
    rejectedEvents,
    candleReplaySteps: replaySteps,
    engineState: finalEngineState,
    currentRegimeId: activeRange?.rangeId,
    executionTimeMs,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Discover the nearest prominent external range in warm-up candles.
 */
function discoverInitialExternalRange(
  candles: NormalizedMarketCandle[]
): {
  direction: 'BULLISH' | 'BEARISH';
  topPrice: number;
  topCandle: NormalizedMarketCandle;
  topIndex: number;
  bottomPrice: number;
  bottomCandle: NormalizedMarketCandle;
  bottomIndex: number;
} | null {
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
  return {
    id: `v5_${b.type}_${b.candleTimeUnix}`,
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
  rejectionType:
    | 'REJECTED_INVALIDATION'
    | 'REJECTED_HIGH'
    | 'REJECTED_LOW'
    | 'REJECTED_RETRACEMENT',
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
  phase: 'RANGE_LOCKED' | 'EXPANSION',
  activeRange: StructuralRange | null,
  decisionTrace: string[],
  breakId: string | null,
  pointCreated: string | null
) {
  const engineState: EngineStateSnapshot = {
    state,
    phase,
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
  const seen = new Map<string, StructurePoint>();
  for (const p of points) {
    const key = `${p.type}_${p.candleOpenTimeUnix}_${p.price}`;
    if (!seen.has(key)) {
      seen.set(key, p);
    }
  }
  return Array.from(seen.values()).sort(
    (a, b) => a.candleOpenTimeUnix - b.candleOpenTimeUnix
  );
}

function createEmptyV5Result(
  startTime: number,
  algorithmVersion: string
): StructureDetectionResult {
  return {
    symbol: 'BTC_USDT',
    timeframe: '5M',
    algorithmVersion,
    parameters: {
      analysisCandles: 280,
      initializationSearchCandles: 70,
      breakConfirmation: 'CLOSE',
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
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
    lhCount: 0,
    llCount: 0,
    provisionalCount: 0,
    totalPointsCount: 0,
    lastHH: null,
    lastHL: null,
    lastLH: null,
    lastLL: null,
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
