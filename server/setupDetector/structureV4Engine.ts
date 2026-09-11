import { NormalizedMarketCandle } from '../marketData/mexcPublicMarketClient';
import {
  StructurePoint,
  StructurePointType,
  StructureStrength,
  StructureState,
  StructureParameters,
  StructureDetectionResult,
  ActiveRetracementInfo,
  StructureEventLogItem,
  StructureCycle,
  InitializationStructureResult,
  StructureBreakEvent,
  CURRENT_ALGORITHM_VERSION,
  ALGORITHM_VERSION_V4,
} from './structureTypes';
import {
  StructureDecisionAudit,
  RejectedStructureEvent,
  CandleReplayStep,
  BreakCandleDetail,
  RetracementBarDetail,
} from './structureAuditTypes';
import { structureAuditService } from './structureAuditService';

export interface WarmUpCandidateEvaluation {
  initialState: StructureState;
  initialSequence: 'LH → LL' | 'HL → HH';
  foundAt: string;
  foundTimeUnix: number;
  initialLH?: StructurePoint;
  initialLL?: StructurePoint;
  initialHH?: StructurePoint;
  initialHL?: StructurePoint;
  cycle: StructureCycle;
  retraceCandles: number;
  retraceFib: number;
}

/**
 * Evaluates whether a slice of candles contains a valid completed incoming structure sequence.
 * 
 * Rules:
 * Bearish requires defensible: LH -> LL
 * Bullish requires defensible: HL -> HH
 * Qualification:
 * - Body-close structural break / confirmed directional leg
 * - Minimum retracement candles (e.g. >= 4)
 * - Minimum Fibonacci retracement depth (e.g. >= 0.382)
 * - No wick-only breaks
 */
function evaluateSliceForStructure(
  slice: NormalizedMarketCandle[],
  minCandles: number,
  minFib: number,
  symbol: string,
  timeframe: string,
  sliceBaseIndex: number
): WarmUpCandidateEvaluation | null {
  if (slice.length < minCandles + 2) {
    return null;
  }

  // 1. Check for Bearish initialization: Peak (LH) -> Trough (LL) -> Qualified Retracement Bounce
  // Find highest high in the slice that has enough candles after it to form a trough and retracement
  let highestHighIdx = -1;
  let highestHighPrice = -Infinity;

  for (let i = 0; i < slice.length - minCandles; i++) {
    if (slice[i].high > highestHighPrice) {
      highestHighPrice = slice[i].high;
      highestHighIdx = i;
    }
  }

  if (highestHighIdx >= 0 && highestHighIdx < slice.length - minCandles) {
    // Find lowest low after highest high
    let lowestLowIdx = -1;
    let lowestLowPrice = Infinity;

    for (let i = highestHighIdx + 1; i < slice.length; i++) {
      if (slice[i].low < lowestLowPrice) {
        lowestLowPrice = slice[i].low;
        lowestLowIdx = i;
      }
    }

    if (lowestLowIdx > highestHighIdx && lowestLowIdx < slice.length) {
      // Check bounce from lowest low
      let bounceHigh = -Infinity;
      let bounceIdx = lowestLowIdx;

      for (let i = lowestLowIdx; i < slice.length; i++) {
        if (slice[i].high > bounceHigh) {
          bounceHigh = slice[i].high;
          bounceIdx = i;
        }
      }

      const retraceBars = bounceIdx - lowestLowIdx;
      const legRange = highestHighPrice - lowestLowPrice;
      const retraceDepth = legRange > 0 ? (bounceHigh - lowestLowPrice) / legRange : 0;

      // Also ensure price hasn't violated LH with a candle CLOSE
      const hasCloseAboveLH = slice.slice(lowestLowIdx).some((c) => c.close > highestHighPrice);

      if (retraceBars >= minCandles && retraceDepth >= minFib && !hasCloseAboveLH) {
        const lhCandle = slice[highestHighIdx];
        const llCandle = slice[lowestLowIdx];
        const cycleId = 'cycle_warmup_bear_1';

        const initialLH: StructurePoint = {
          id: `sp_lh_${symbol}_${lhCandle.openTimeUnix}_V4_init`,
          symbol,
          timeframe,
          candleOpenTime: lhCandle.openTime,
          candleOpenTimeUnix: lhCandle.openTimeUnix,
          type: StructurePointType.LH,
          price: highestHighPrice,
          strength: StructureStrength.MAJOR,
          algorithmVersion: ALGORITHM_VERSION_V4,
          candleIndex: sliceBaseIndex + highestHighIdx,
          cycleId,
          trendState: StructureState.BEARISH,
          sequenceIndex: 1,
          sequenceLabel: 'LH1',
          cycleNumber: 1,
          isWarmUpAnchor: true,
          confirmationReason: 'Initial structural LH discovered in warm-up (Locked Invalidation)',
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };

        const initialLL: StructurePoint = {
          id: `sp_ll_${symbol}_${llCandle.openTimeUnix}_V4_init`,
          symbol,
          timeframe,
          candleOpenTime: llCandle.openTime,
          candleOpenTimeUnix: llCandle.openTimeUnix,
          type: StructurePointType.LL,
          price: lowestLowPrice,
          strength: StructureStrength.MAJOR,
          algorithmVersion: ALGORITHM_VERSION_V4,
          candleIndex: sliceBaseIndex + lowestLowIdx,
          cycleId,
          trendState: StructureState.BEARISH,
          sequenceIndex: 1,
          sequenceLabel: 'LL1',
          cycleNumber: 1,
          isWarmUpAnchor: true,
          confirmationReason: `Initial structural LL confirmed via ${retraceBars}-candle (${(retraceDepth * 100).toFixed(1)}% Fib) retracement`,
          retracementCandles: retraceBars,
          retracementFibDepth: retraceDepth,
          fibPriceLevel: lowestLowPrice + minFib * legRange,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };

        const cycle: StructureCycle = {
          cycleId,
          direction: 'BEARISH',
          status: 'CONFIRMED',
          anchorPoint: {
            id: initialLH.id,
            type: initialLH.type,
            price: initialLH.price,
            candleTime: initialLH.candleOpenTime,
            candleTimeUnix: initialLH.candleOpenTimeUnix,
            candleIndex: initialLH.candleIndex,
          },
          expansionExtreme: {
            type: initialLL.type,
            price: initialLL.price,
            candleIndex: initialLL.candleIndex!,
            candleTime: initialLL.candleOpenTime,
            candleTimeUnix: initialLL.candleOpenTimeUnix,
          },
          startedAt: lhCandle.openTime,
          confirmedAt: llCandle.openTime,
        };

        return {
          initialState: StructureState.BEARISH,
          initialSequence: 'LH → LL',
          foundAt: slice[bounceIdx].openTime,
          foundTimeUnix: slice[bounceIdx].openTimeUnix,
          initialLH,
          initialLL,
          cycle,
          retraceCandles: retraceBars,
          retraceFib: retraceDepth,
        };
      }
    }
  }

  // 2. Check for Bullish initialization: Trough (HL) -> Peak (HH) -> Qualified Retracement Pullback
  let lowestLowIdx = -1;
  let lowestLowPrice = Infinity;

  for (let i = 0; i < slice.length - minCandles; i++) {
    if (slice[i].low < lowestLowPrice) {
      lowestLowPrice = slice[i].low;
      lowestLowIdx = i;
    }
  }

  if (lowestLowIdx >= 0 && lowestLowIdx < slice.length - minCandles) {
    let highestHighIdx = -1;
    let highestHighPrice = -Infinity;

    for (let i = lowestLowIdx + 1; i < slice.length; i++) {
      if (slice[i].high > highestHighPrice) {
        highestHighPrice = slice[i].high;
        highestHighIdx = i;
      }
    }

    if (highestHighIdx > lowestLowIdx && highestHighIdx < slice.length) {
      let pullbackLow = Infinity;
      let pullbackIdx = highestHighIdx;

      for (let i = highestHighIdx; i < slice.length; i++) {
        if (slice[i].low < pullbackLow) {
          pullbackLow = slice[i].low;
          pullbackIdx = i;
        }
      }

      const retraceBars = pullbackIdx - highestHighIdx;
      const legRange = highestHighPrice - lowestLowPrice;
      const retraceDepth = legRange > 0 ? (highestHighPrice - pullbackLow) / legRange : 0;

      const hasCloseBelowHL = slice.slice(highestHighIdx).some((c) => c.close < lowestLowPrice);

      if (retraceBars >= minCandles && retraceDepth >= minFib && !hasCloseBelowHL) {
        const hlCandle = slice[lowestLowIdx];
        const hhCandle = slice[highestHighIdx];
        const cycleId = 'cycle_warmup_bull_1';

        const initialHL: StructurePoint = {
          id: `sp_hl_${symbol}_${hlCandle.openTimeUnix}_V4_init`,
          symbol,
          timeframe,
          candleOpenTime: hlCandle.openTime,
          candleOpenTimeUnix: hlCandle.openTimeUnix,
          type: StructurePointType.HL,
          price: lowestLowPrice,
          strength: StructureStrength.MAJOR,
          algorithmVersion: ALGORITHM_VERSION_V4,
          candleIndex: sliceBaseIndex + lowestLowIdx,
          cycleId,
          trendState: StructureState.BULLISH,
          sequenceIndex: 1,
          sequenceLabel: 'HL1',
          cycleNumber: 1,
          isWarmUpAnchor: true,
          confirmationReason: 'Initial structural HL discovered in warm-up (Locked Invalidation)',
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };

        const initialHH: StructurePoint = {
          id: `sp_hh_${symbol}_${hhCandle.openTimeUnix}_V4_init`,
          symbol,
          timeframe,
          candleOpenTime: hhCandle.openTime,
          candleOpenTimeUnix: hhCandle.openTimeUnix,
          type: StructurePointType.HH,
          price: highestHighPrice,
          strength: StructureStrength.MAJOR,
          algorithmVersion: ALGORITHM_VERSION_V4,
          candleIndex: sliceBaseIndex + highestHighIdx,
          cycleId,
          trendState: StructureState.BULLISH,
          sequenceIndex: 1,
          sequenceLabel: 'HH1',
          cycleNumber: 1,
          isWarmUpAnchor: true,
          confirmationReason: `Initial structural HH confirmed via ${retraceBars}-candle (${(retraceDepth * 100).toFixed(1)}% Fib) retracement`,
          retracementCandles: retraceBars,
          retracementFibDepth: retraceDepth,
          fibPriceLevel: highestHighPrice - minFib * legRange,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };

        const cycle: StructureCycle = {
          cycleId,
          direction: 'BULLISH',
          status: 'CONFIRMED',
          anchorPoint: {
            id: initialHL.id,
            type: initialHL.type,
            price: initialHL.price,
            candleTime: initialHL.candleOpenTime,
            candleTimeUnix: initialHL.candleOpenTimeUnix,
            candleIndex: initialHL.candleIndex,
          },
          expansionExtreme: {
            type: initialHH.type,
            price: initialHH.price,
            candleIndex: initialHH.candleIndex!,
            candleTime: initialHH.candleOpenTime,
            candleTimeUnix: initialHH.candleOpenTimeUnix,
          },
          startedAt: hlCandle.openTime,
          confirmedAt: hhCandle.openTime,
        };

        return {
          initialState: StructureState.BULLISH,
          initialSequence: 'HL → HH',
          foundAt: slice[pullbackIdx].openTime,
          foundTimeUnix: slice[pullbackIdx].openTimeUnix,
          initialHH,
          initialHL,
          cycle,
          retraceCandles: retraceBars,
          retraceFib: retraceDepth,
        };
      }
    }
  }

  return null;
}

/**
 * Searches backward from the main analysis boundary into the warm-up window
 * to find the nearest valid earlier completed structure sequence.
 */
function searchWarmUpWindow(
  workingSet: NormalizedMarketCandle[],
  mainStartIndex: number,
  maxWarmUp: number,
  minCandles: number,
  minFib: number,
  symbol: string,
  timeframe: string
): {
  initResult: InitializationStructureResult;
  candidateEval: WarmUpCandidateEvaluation | null;
} {
  const mainStartTime = workingSet[mainStartIndex]?.openTime || null;
  const logs: string[] = [];

  logs.push(`Main analysis begins at candle #${mainStartIndex} (${mainStartTime ?? 'N/A'}).`);

  if (maxWarmUp <= 0 || mainStartIndex <= 0) {
    logs.push('Warm-up search allowance is 0 candles. Initializing directly from main analysis boundary.');
    logs.push('Initial State: UNDEFINED. Ready for chronological discovery in main analysis.');
    return {
      initResult: {
        initialState: StructureState.UNDEFINED,
        initialSequence: 'NONE',
        warmUpCandlesUsed: 0,
        warmUpCandlesMax: maxWarmUp,
        initialFoundAt: null,
        initialFoundTimeUnix: null,
        initialLH: null,
        initialLL: null,
        initialHH: null,
        initialHL: null,
        warmUpStartIndex: null,
        mainAnalysisStartIndex: mainStartIndex,
        mainAnalysisStartTime: mainStartTime,
        initializationLogs: logs,
      },
      candidateEval: null,
    };
  }

  logs.push(`Searching backward from left boundary (max ${maxWarmUp} warm-up candles)...`);

  // Search backward starting from nearest distance (k = minCandles + 2 up to maxWarmUp)
  // This guarantees finding the NEAREST valid earlier completed structure.
  const minSearchDistance = Math.max(4, minCandles + 2);
  let bestEval: WarmUpCandidateEvaluation | null = null;
  let candlesUsed = 0;

  for (let k = minSearchDistance; k <= maxWarmUp; k++) {
    const sliceStart = mainStartIndex - k;
    const slice = workingSet.slice(sliceStart, mainStartIndex);
    const evaluation = evaluateSliceForStructure(
      slice,
      minCandles,
      minFib,
      symbol,
      timeframe,
      sliceStart
    );

    if (evaluation) {
      bestEval = evaluation;
      candlesUsed = k;
      break; // Stop immediately: nearest valid structure discovered!
    }
  }

  if (bestEval) {
    logs.push(`Nearest valid ${bestEval.initialSequence} sequence confirmed within ${candlesUsed} warm-up candles.`);
    logs.push(
      `Retracement qualified: ${bestEval.retraceCandles} candles (min ${minCandles}), ${(bestEval.retraceFib * 100).toFixed(1)}% Fib (min ${(minFib * 100).toFixed(1)}%).`
    );
    if (bestEval.initialState === StructureState.BEARISH) {
      logs.push(`Initial LH (Locked Invalidation): ${bestEval.initialLH?.price.toFixed(2)}, Initial LL: ${bestEval.initialLL?.price.toFixed(2)}.`);
    } else {
      logs.push(`Initial HL (Locked Invalidation): ${bestEval.initialHL?.price.toFixed(2)}, Initial HH: ${bestEval.initialHH?.price.toFixed(2)}.`);
    }
    logs.push(`Initialization complete. Initial State: ${bestEval.initialState}. Warm-Up Used: ${candlesUsed} / ${maxWarmUp} candles.`);

    return {
      initResult: {
        initialState: bestEval.initialState,
        initialSequence: bestEval.initialSequence,
        warmUpCandlesUsed: candlesUsed,
        warmUpCandlesMax: maxWarmUp,
        initialFoundAt: bestEval.foundAt,
        initialFoundTimeUnix: bestEval.foundTimeUnix,
        initialLH: bestEval.initialLH?.price ?? null,
        initialLL: bestEval.initialLL?.price ?? null,
        initialHH: bestEval.initialHH?.price ?? null,
        initialHL: bestEval.initialHL?.price ?? null,
        warmUpStartIndex: mainStartIndex - candlesUsed,
        mainAnalysisStartIndex: mainStartIndex,
        mainAnalysisStartTime: mainStartTime,
        initializationLogs: logs,
        usedWarmUp: candlesUsed > 0,
        initialTrend: bestEval.initialState,
        candlesEvaluated: candlesUsed,
        warmUpCandlesCount: maxWarmUp,
      },
      candidateEval: bestEval,
    };
  }

  logs.push(`No valid completed LH→LL or HL→HH sequence discovered within ${maxWarmUp} warm-up candles.`);
  logs.push('Initial State: UNDEFINED. Do NOT manufacture structure. Awaiting chronological confirmation in main analysis.');

  return {
    initResult: {
      initialState: StructureState.UNDEFINED,
      initialSequence: 'NONE',
      warmUpCandlesUsed: 0,
      warmUpCandlesMax: maxWarmUp,
      initialFoundAt: null,
      initialFoundTimeUnix: null,
      initialLH: null,
      initialLL: null,
      initialHH: null,
      initialHL: null,
      warmUpStartIndex: mainStartIndex - maxWarmUp,
      mainAnalysisStartIndex: mainStartIndex,
      mainAnalysisStartTime: mainStartTime,
      initializationLogs: logs,
      usedWarmUp: false,
      initialTrend: StructureState.UNDEFINED,
      candlesEvaluated: 0,
      warmUpCandlesCount: maxWarmUp,
    },
    candidateEval: null,
  };
}

/**
 * STRUCTURE_V4_WARMUP_LOCKED Engine
 * 
 * Strict, stateful, locked structure cycle engine with dedicated warm-up / initialization window.
 */
export function detectStructureV4WarmUpLocked(
  candles: NormalizedMarketCandle[],
  customParams?: Partial<StructureParameters>
): StructureDetectionResult {
  const startTime = Date.now();

  const analysisCandles = Math.max(10, Math.min(1000, customParams?.analysisCandles ?? 280));
  const initializationSearchCandles = Math.max(
    0,
    Math.min(
      200,
      customParams?.initializationSearchCandles ?? (customParams as any)?.warmUpCandles ?? 70
    )
  );
  const minCandles = Math.max(1, Math.min(20, customParams?.minimumRetracementCandles ?? 4));
  const minFib = Math.max(0.1, Math.min(1.0, customParams?.minimumRetracementFib ?? 0.382));
  const totalWindow = analysisCandles + initializationSearchCandles;

  const params: StructureParameters = {
    analysisCandles,
    initializationSearchCandles,
    minimumRetracementCandles: minCandles,
    minimumRetracementFib: minFib,
    breakConfirmation: 'CLOSE',
    fibTouchMode: 'WICK',
    lookbackCandles: totalWindow,
    algorithmVersion: ALGORITHM_VERSION_V4,
    cycleLocking: true,
    initializationMode: 'NEAREST_VALID_PRIOR_STRUCTURE',
    showProvisionalStructure: customParams?.showProvisionalStructure ?? false,
    showSequenceNumbers: customParams?.showSequenceNumbers ?? true,
    legacyPivotOverlay: customParams?.legacyPivotOverlay ?? false,
    pivotLeftBars: customParams?.pivotLeftBars ?? 2,
    pivotRightBars: customParams?.pivotRightBars ?? 2,
    equalityMode: 'STRICT',
    initialSeed: customParams?.initialSeed,
  };

  const symbol = candles[0]?.symbol || 'UNKNOWN';
  const timeframe = candles[0]?.timeframe || '5M';

  // 1. Filter strictly closed candles (unclosed forming candle excluded)
  const totalCandlesAvailable = candles.length;
  const closedCandles = candles.filter((c) => c.isClosed);
  const unclosedCandleExcluded = candles.some((c) => !c.isClosed);

  // 2. Truncate to combined window (warm-up + analysis)
  const workingSet =
    closedCandles.length > totalWindow
      ? closedCandles.slice(closedCandles.length - totalWindow)
      : closedCandles;

  const totalWorking = workingSet.length;
  const mainStartIndex = Math.max(0, totalWorking - analysisCandles);
  const maxWarmUp = Math.min(initializationSearchCandles, mainStartIndex);

  // 3. Search warm-up window for incoming structure
  const { initResult, candidateEval } = searchWarmUpWindow(
    workingSet,
    mainStartIndex,
    maxWarmUp,
    minCandles,
    minFib,
    symbol,
    timeframe
  );

  const points: StructurePoint[] = [];
  const cycles: StructureCycle[] = [];
  const eventLogs: StructureEventLogItem[] = [];
  const structureBreakEvents: StructureBreakEvent[] = [];
  const audits: StructureDecisionAudit[] = [];
  const rejectedEvents: RejectedStructureEvent[] = [];
  const candleReplaySteps: CandleReplayStep[] = [];
  const regimes: Array<{
    regimeId: string;
    direction: 'BULLISH' | 'BEARISH';
    startedAt: string;
    startedAtUnix?: number;
    endedAt?: string;
    endedAtUnix?: number;
    startReason?: string;
  }> = [];

  let regimeCounter = 0;
  let currentRegimeId = 'REGIME_INITIAL';
  let breakCandleDetail: BreakCandleDetail | null = null;

  const recordAudit = (audit: StructureDecisionAudit) => {
    audits.push(audit);
  };

  const addPoint = (pt: StructurePoint) => {
    const existingIndex = points.findIndex(
      (existing) => existing.id === pt.id || (existing.type === pt.type && existing.candleOpenTimeUnix === pt.candleOpenTimeUnix)
    );
    if (existingIndex >= 0) {
      points[existingIndex] = pt;
    } else {
      if (points.some((p) => p.id === pt.id)) {
        pt.id = `${pt.id}_${points.length}`;
      }
      points.push(pt);
    }
  };

  const addEvent = (
    candle: NormalizedMarketCandle,
    eventType: StructureEventLogItem['eventType'],
    title: string,
    message: string,
    details?: StructureEventLogItem['details']
  ) => {
    eventLogs.push({
      id: `evt_${candle.openTimeUnix}_${eventLogs.length}`,
      candleTime: candle.openTime,
      candleTimeUnix: candle.openTimeUnix,
      eventType,
      title,
      message,
      details,
    });
  };

  // State Machine Trackers
  let structureState: StructureState = initResult.initialState;
  let activeLockedHL: StructurePoint | null = null;
  let lastConfirmedHH: StructurePoint | null = null;
  let activeLockedLH: StructurePoint | null = null;
  let lastConfirmedLL: StructurePoint | null = null;

  // Cycle counters for sequence numbering
  let bullishCycleNumber = 1;
  let bearishCycleNumber = 1;

  // Trackers for in-progress provisional leg and retracement
  let candidateType: StructurePointType.PROVISIONAL_HH | StructurePointType.PROVISIONAL_LL | null = null;
  let candidatePrice: number = 0;
  let candidateCandleIndex: number = -1;
  let candidateCandleTime: string = '';
  let candidateCandleTimeUnix: number = 0;
  let referencePrice: number = 0;
  let referenceTime: string = '';

  let lowestLowSinceCandidate = Infinity;
  let lowestLowIndex = -1;
  let lowestLowTime = '';
  let lowestLowTimeUnix = 0;

  let highestHighSinceCandidate = -Infinity;
  let highestHighIndex = -1;
  let highestHighTime = '';
  let highestHighTimeUnix = 0;

  // Initialize with discovered anchors from warm-up
  if (candidateEval) {
    if (candidateEval.initialState === StructureState.BEARISH && candidateEval.initialLH && candidateEval.initialLL) {
      regimeCounter = 1;
      currentRegimeId = 'REGIME_BEAR_1';
      regimes.push({
        regimeId: currentRegimeId,
        direction: 'BEARISH',
        startedAt: candidateEval.foundAt,
        startedAtUnix: candidateEval.foundTimeUnix,
      });

      activeLockedLH = candidateEval.initialLH;
      lastConfirmedLL = candidateEval.initialLL;
      activeLockedLH.regimeId = currentRegimeId;
      lastConfirmedLL.regimeId = currentRegimeId;
      activeLockedLH.id = `sp_lh_${symbol}_${activeLockedLH.candleOpenTimeUnix}_${currentRegimeId}_cycle1_V4`;
      lastConfirmedLL.id = `sp_ll_${symbol}_${lastConfirmedLL.candleOpenTimeUnix}_${currentRegimeId}_cycle1_V4`;
      activeLockedLH.auditId = `audit_lh_${symbol}_${activeLockedLH.candleOpenTimeUnix}_${currentRegimeId}`;
      lastConfirmedLL.auditId = `audit_ll_${symbol}_${lastConfirmedLL.candleOpenTimeUnix}_${currentRegimeId}`;

      recordAudit({
        eventId: activeLockedLH.auditId,
        regimeId: currentRegimeId,
        cycleId: candidateEval.cycle.cycleId,
        sequenceId: 'LH1',
        eventType: 'LH',
        status: 'CONFIRMED',
        trendStateBefore: StructureState.BEARISH,
        trendStateAfter: StructureState.BEARISH,
        candleIndex: activeLockedLH.candleIndex!,
        timestamp: activeLockedLH.candleOpenTime,
        timestampUnix: activeLockedLH.candleOpenTimeUnix,
        price: activeLockedLH.price,
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
        candidateExtremeType: StructurePointType.LH,
        candidateExtremePrice: activeLockedLH.price,
        candidateExtremeTime: activeLockedLH.candleOpenTime,
        candidateExtremeIndex: activeLockedLH.candleIndex,
        retracementStartTime: null,
        retracementExtremePrice: null,
        retracementExtremeTime: null,
        retracementCandleCount: candidateEval.retraceCandles,
        requiredRetracementCandles: minCandles,
        candleCountQualified: true,
        fibAnchorPrice: null,
        fibExtremePrice: null,
        fibRequiredRatio: minFib,
        fibRequiredPrice: null,
        actualRetracementRatio: candidateEval.retraceFib,
        fibQualified: true,
        decision: 'WARMUP_LH_INITIALIZED',
        decisionReason: 'Incoming trend LH invalidation anchor discovered in warm-up search window. Invalidation requires candle body close above this level.',
        algorithmVersion: ALGORITHM_VERSION_V4,
      });

      recordAudit({
        eventId: lastConfirmedLL.auditId,
        regimeId: currentRegimeId,
        cycleId: candidateEval.cycle.cycleId,
        sequenceId: 'LL1',
        eventType: 'LL',
        status: 'CONFIRMED',
        trendStateBefore: StructureState.BEARISH,
        trendStateAfter: StructureState.BEARISH,
        candleIndex: lastConfirmedLL.candleIndex!,
        timestamp: lastConfirmedLL.candleOpenTime,
        timestampUnix: lastConfirmedLL.candleOpenTimeUnix,
        price: lastConfirmedLL.price,
        previousLockedAnchorType: StructurePointType.LH,
        previousLockedAnchorPrice: activeLockedLH.price,
        previousLockedAnchorTime: activeLockedLH.candleOpenTime,
        previousStructuralExtremeType: null,
        previousStructuralExtremePrice: null,
        previousStructuralExtremeTime: null,
        breakRequired: false,
        breakLevel: null,
        breakWasBodyClose: false,
        breakWasWickOnly: false,
        candidateExtremeType: StructurePointType.LL,
        candidateExtremePrice: lastConfirmedLL.price,
        candidateExtremeTime: lastConfirmedLL.candleOpenTime,
        candidateExtremeIndex: lastConfirmedLL.candleIndex,
        retracementStartTime: lastConfirmedLL.candleOpenTime,
        retracementExtremePrice: null,
        retracementExtremeTime: null,
        retracementCandleCount: candidateEval.retraceCandles,
        requiredRetracementCandles: minCandles,
        candleCountQualified: true,
        fibAnchorPrice: activeLockedLH.price,
        fibExtremePrice: lastConfirmedLL.price,
        fibRequiredRatio: minFib,
        fibRequiredPrice: null,
        actualRetracementRatio: candidateEval.retraceFib,
        fibQualified: true,
        decision: 'WARMUP_LL_CONFIRMED',
        decisionReason: `Incoming trend expansion low confirmed via ${candidateEval.retraceCandles}-candle (${(candidateEval.retraceFib * 100).toFixed(1)}% Fib) bounce in warm-up.`,
        algorithmVersion: ALGORITHM_VERSION_V4,
      });

      addPoint(activeLockedLH);
      addPoint(lastConfirmedLL);
      cycles.push(candidateEval.cycle);
      bearishCycleNumber = 1;

      addEvent(
        workingSet[mainStartIndex],
        'TREND_CONFIRMED',
        'Bearish Structure Initialized from Warm-Up',
        `Incoming trend BEARISH established via warm-up (${initResult.warmUpCandlesUsed} candles). Locked LH: ${activeLockedLH.price.toFixed(2)}, LL: ${lastConfirmedLL.price.toFixed(2)}.`,
        { price: activeLockedLH.price }
      );
    } else if (candidateEval.initialState === StructureState.BULLISH && candidateEval.initialHL && candidateEval.initialHH) {
      regimeCounter = 1;
      currentRegimeId = 'REGIME_BULL_1';
      regimes.push({
        regimeId: currentRegimeId,
        direction: 'BULLISH',
        startedAt: candidateEval.foundAt,
        startedAtUnix: candidateEval.foundTimeUnix,
      });

      activeLockedHL = candidateEval.initialHL;
      lastConfirmedHH = candidateEval.initialHH;
      activeLockedHL.regimeId = currentRegimeId;
      lastConfirmedHH.regimeId = currentRegimeId;
      activeLockedHL.id = `sp_hl_${symbol}_${activeLockedHL.candleOpenTimeUnix}_${currentRegimeId}_cycle1_V4`;
      lastConfirmedHH.id = `sp_hh_${symbol}_${lastConfirmedHH.candleOpenTimeUnix}_${currentRegimeId}_cycle1_V4`;
      activeLockedHL.auditId = `audit_hl_${symbol}_${activeLockedHL.candleOpenTimeUnix}_${currentRegimeId}`;
      lastConfirmedHH.auditId = `audit_hh_${symbol}_${lastConfirmedHH.candleOpenTimeUnix}_${currentRegimeId}`;

      recordAudit({
        eventId: activeLockedHL.auditId,
        regimeId: currentRegimeId,
        cycleId: candidateEval.cycle.cycleId,
        sequenceId: 'HL1',
        eventType: 'HL',
        status: 'CONFIRMED',
        trendStateBefore: StructureState.BULLISH,
        trendStateAfter: StructureState.BULLISH,
        candleIndex: activeLockedHL.candleIndex!,
        timestamp: activeLockedHL.candleOpenTime,
        timestampUnix: activeLockedHL.candleOpenTimeUnix,
        price: activeLockedHL.price,
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
        candidateExtremeType: StructurePointType.HL,
        candidateExtremePrice: activeLockedHL.price,
        candidateExtremeTime: activeLockedHL.candleOpenTime,
        candidateExtremeIndex: activeLockedHL.candleIndex,
        retracementStartTime: null,
        retracementExtremePrice: null,
        retracementExtremeTime: null,
        retracementCandleCount: candidateEval.retraceCandles,
        requiredRetracementCandles: minCandles,
        candleCountQualified: true,
        fibAnchorPrice: null,
        fibExtremePrice: null,
        fibRequiredRatio: minFib,
        fibRequiredPrice: null,
        actualRetracementRatio: candidateEval.retraceFib,
        fibQualified: true,
        decision: 'WARMUP_HL_INITIALIZED',
        decisionReason: 'Incoming trend HL invalidation anchor discovered in warm-up search window. Invalidation requires candle body close below this level.',
        algorithmVersion: ALGORITHM_VERSION_V4,
      });

      recordAudit({
        eventId: lastConfirmedHH.auditId,
        regimeId: currentRegimeId,
        cycleId: candidateEval.cycle.cycleId,
        sequenceId: 'HH1',
        eventType: 'HH',
        status: 'CONFIRMED',
        trendStateBefore: StructureState.BULLISH,
        trendStateAfter: StructureState.BULLISH,
        candleIndex: lastConfirmedHH.candleIndex!,
        timestamp: lastConfirmedHH.candleOpenTime,
        timestampUnix: lastConfirmedHH.candleOpenTimeUnix,
        price: lastConfirmedHH.price,
        previousLockedAnchorType: StructurePointType.HL,
        previousLockedAnchorPrice: activeLockedHL.price,
        previousLockedAnchorTime: activeLockedHL.candleOpenTime,
        previousStructuralExtremeType: null,
        previousStructuralExtremePrice: null,
        previousStructuralExtremeTime: null,
        breakRequired: false,
        breakLevel: null,
        breakWasBodyClose: false,
        breakWasWickOnly: false,
        candidateExtremeType: StructurePointType.HH,
        candidateExtremePrice: lastConfirmedHH.price,
        candidateExtremeTime: lastConfirmedHH.candleOpenTime,
        candidateExtremeIndex: lastConfirmedHH.candleIndex,
        retracementStartTime: lastConfirmedHH.candleOpenTime,
        retracementExtremePrice: null,
        retracementExtremeTime: null,
        retracementCandleCount: candidateEval.retraceCandles,
        requiredRetracementCandles: minCandles,
        candleCountQualified: true,
        fibAnchorPrice: activeLockedHL.price,
        fibExtremePrice: lastConfirmedHH.price,
        fibRequiredRatio: minFib,
        fibRequiredPrice: null,
        actualRetracementRatio: candidateEval.retraceFib,
        fibQualified: true,
        decision: 'WARMUP_HH_CONFIRMED',
        decisionReason: `Incoming trend expansion high confirmed via ${candidateEval.retraceCandles}-candle (${(candidateEval.retraceFib * 100).toFixed(1)}% Fib) pullback in warm-up.`,
        algorithmVersion: ALGORITHM_VERSION_V4,
      });

      addPoint(activeLockedHL);
      addPoint(lastConfirmedHH);
      cycles.push(candidateEval.cycle);
      bullishCycleNumber = 1;

      addEvent(
        workingSet[mainStartIndex],
        'TREND_CONFIRMED',
        'Bullish Structure Initialized from Warm-Up',
        `Incoming trend BULLISH established via warm-up (${initResult.warmUpCandlesUsed} candles). Locked HL: ${activeLockedHL.price.toFixed(2)}, HH: ${lastConfirmedHH.price.toFixed(2)}.`,
        { price: activeLockedHL.price }
      );
    }
  }

  // Tracking variables for chronological discovery if initial state is UNDEFINED
  let discoveryHighPrice = -Infinity;
  let discoveryHighIndex = -1;
  let discoveryHighTime = '';
  let discoveryHighTimeUnix = 0;

  let discoveryLowPrice = Infinity;
  let discoveryLowIndex = -1;
  let discoveryLowTime = '';
  let discoveryLowTimeUnix = 0;

  let discoveryLowestSinceHigh = Infinity;
  let discoveryLowestSinceHighIndex = -1;
  let discoveryLowestSinceHighTime = '';
  let discoveryLowestSinceHighTimeUnix = 0;

  let discoveryHighestSinceLow = -Infinity;
  let discoveryHighestSinceLowIndex = -1;
  let discoveryHighestSinceLowTime = '';
  let discoveryHighestSinceLowTimeUnix = 0;

  // 4. Process Main Analysis Candles chronologically
  for (let i = mainStartIndex; i < totalWorking; i++) {
    const candle = workingSet[i];

    // ==========================================
    // STATE: UNDEFINED (Chronological Discovery)
    // ==========================================
    if (structureState === StructureState.UNDEFINED) {
      if (discoveryHighIndex === -1) {
        discoveryHighPrice = candle.high;
        discoveryHighIndex = i;
        discoveryHighTime = candle.openTime;
        discoveryHighTimeUnix = candle.openTimeUnix;

        discoveryLowPrice = candle.low;
        discoveryLowIndex = i;
        discoveryLowTime = candle.openTime;
        discoveryLowTimeUnix = candle.openTimeUnix;

        discoveryLowestSinceHigh = candle.low;
        discoveryLowestSinceHighIndex = i;
        discoveryLowestSinceHighTime = candle.openTime;
        discoveryLowestSinceHighTimeUnix = candle.openTimeUnix;

        discoveryHighestSinceLow = candle.high;
        discoveryHighestSinceLowIndex = i;
        discoveryHighestSinceLowTime = candle.openTime;
        discoveryHighestSinceLowTimeUnix = candle.openTimeUnix;
        continue;
      }

      // Bearish tracking: High established, then low, then bounce
      if (candle.high > discoveryHighPrice && discoveryLowestSinceHighIndex === discoveryHighIndex) {
        discoveryHighPrice = candle.high;
        discoveryHighIndex = i;
        discoveryHighTime = candle.openTime;
        discoveryHighTimeUnix = candle.openTimeUnix;
        discoveryLowestSinceHigh = candle.low;
        discoveryLowestSinceHighIndex = i;
        discoveryLowestSinceHighTime = candle.openTime;
        discoveryLowestSinceHighTimeUnix = candle.openTimeUnix;
      } else if (candle.low < discoveryLowestSinceHigh) {
        discoveryLowestSinceHigh = candle.low;
        discoveryLowestSinceHighIndex = i;
        discoveryLowestSinceHighTime = candle.openTime;
        discoveryLowestSinceHighTimeUnix = candle.openTimeUnix;
      }

      // Bullish tracking: Low established, then high, then pullback
      if (candle.low < discoveryLowPrice && discoveryHighestSinceLowIndex === discoveryLowIndex) {
        discoveryLowPrice = candle.low;
        discoveryLowIndex = i;
        discoveryLowTime = candle.openTime;
        discoveryLowTimeUnix = candle.openTimeUnix;
        discoveryHighestSinceLow = candle.high;
        discoveryHighestSinceLowIndex = i;
        discoveryHighestSinceLowTime = candle.openTime;
        discoveryHighestSinceLowTimeUnix = candle.openTimeUnix;
      } else if (candle.high > discoveryHighestSinceLow) {
        discoveryHighestSinceLow = candle.high;
        discoveryHighestSinceLowIndex = i;
        discoveryHighestSinceLowTime = candle.openTime;
        discoveryHighestSinceLowTimeUnix = candle.openTimeUnix;
      }

      // Check Bearish Qualification
      if (discoveryLowestSinceHighIndex > discoveryHighIndex) {
        let bounceHigh = -Infinity;
        let bounceIndex = -1;
        for (let b = discoveryLowestSinceHighIndex; b <= i; b++) {
          if (workingSet[b].high > bounceHigh) {
            bounceHigh = workingSet[b].high;
            bounceIndex = b;
          }
        }

        const retraceBars = bounceIndex - discoveryLowestSinceHighIndex;
        const fibRange = discoveryHighPrice - discoveryLowestSinceHigh;
        const fibTarget = discoveryLowestSinceHigh + minFib * fibRange;

        if (retraceBars >= minCandles && bounceHigh >= fibTarget) {
          regimeCounter += 1;
          currentRegimeId = `REGIME_BEAR_${regimeCounter}`;
          regimes.push({
            regimeId: currentRegimeId,
            direction: 'BEARISH',
            startedAt: discoveryHighTime,
            startedAtUnix: discoveryHighTimeUnix,
          });

          const cycleId = `cycle_bear_${cycles.length + 1}`;
          activeLockedLH = {
            id: `sp_lh_${symbol}_${discoveryHighTimeUnix}_${currentRegimeId}_cycle1_V4`,
            symbol,
            timeframe,
            candleOpenTime: discoveryHighTime,
            candleOpenTimeUnix: discoveryHighTimeUnix,
            type: StructurePointType.LH,
            price: discoveryHighPrice,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: discoveryHighIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: `audit_lh_${symbol}_${discoveryHighTimeUnix}_${currentRegimeId}`,
            trendState: StructureState.BEARISH,
            sequenceIndex: 1,
            sequenceLabel: 'LH1',
            cycleNumber: 1,
            confirmationReason: 'Initial structural LH discovered in main window (Locked Invalidation)',
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          lastConfirmedLL = {
            id: `sp_ll_${symbol}_${discoveryLowestSinceHighTimeUnix}_${currentRegimeId}_cycle1_V4`,
            symbol,
            timeframe,
            candleOpenTime: discoveryLowestSinceHighTime,
            candleOpenTimeUnix: discoveryLowestSinceHighTimeUnix,
            type: StructurePointType.LL,
            price: discoveryLowestSinceHigh,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: discoveryLowestSinceHighIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: `audit_ll_${symbol}_${discoveryLowestSinceHighTimeUnix}_${currentRegimeId}`,
            previousStructurePointId: activeLockedLH.id,
            trendState: StructureState.BEARISH,
            sequenceIndex: 1,
            sequenceLabel: 'LL1',
            cycleNumber: 1,
            retracementCandles: retraceBars,
            retracementFibDepth: fibRange > 0 ? (bounceHigh - discoveryLowestSinceHigh) / fibRange : 0,
            fibPriceLevel: fibTarget,
            confirmationReason: `Initial structural LL confirmed via ${retraceBars}-candle bounce`,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          recordAudit({
            eventId: activeLockedLH.auditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: 'LH1',
            eventType: 'LH',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.UNDEFINED,
            trendStateAfter: StructureState.BEARISH,
            candleIndex: activeLockedLH.candleIndex!,
            timestamp: activeLockedLH.candleOpenTime,
            timestampUnix: activeLockedLH.candleOpenTimeUnix,
            price: activeLockedLH.price,
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
            candidateExtremeType: StructurePointType.LH,
            candidateExtremePrice: activeLockedLH.price,
            candidateExtremeTime: activeLockedLH.candleOpenTime,
            candidateExtremeIndex: activeLockedLH.candleIndex,
            retracementStartTime: null,
            retracementExtremePrice: null,
            retracementExtremeTime: null,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: null,
            fibExtremePrice: null,
            fibRequiredRatio: minFib,
            fibRequiredPrice: null,
            actualRetracementRatio: fibRange > 0 ? (bounceHigh - discoveryLowestSinceHigh) / fibRange : 0,
            fibQualified: true,
            decision: 'INITIAL_LH_LOCKED',
            decisionReason: 'First structural high discovered. Serves as the Bearish locked LH invalidation anchor.',
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          recordAudit({
            eventId: lastConfirmedLL.auditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: 'LL1',
            eventType: 'LL',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.UNDEFINED,
            trendStateAfter: StructureState.BEARISH,
            candleIndex: lastConfirmedLL.candleIndex!,
            timestamp: lastConfirmedLL.candleOpenTime,
            timestampUnix: lastConfirmedLL.candleOpenTimeUnix,
            price: lastConfirmedLL.price,
            previousLockedAnchorType: StructurePointType.LH,
            previousLockedAnchorPrice: activeLockedLH.price,
            previousLockedAnchorTime: activeLockedLH.candleOpenTime,
            previousStructuralExtremeType: null,
            previousStructuralExtremePrice: null,
            previousStructuralExtremeTime: null,
            breakRequired: false,
            breakLevel: null,
            breakWasBodyClose: false,
            breakWasWickOnly: false,
            candidateExtremeType: StructurePointType.LL,
            candidateExtremePrice: lastConfirmedLL.price,
            candidateExtremeTime: lastConfirmedLL.candleOpenTime,
            candidateExtremeIndex: lastConfirmedLL.candleIndex,
            retracementStartTime: lastConfirmedLL.candleOpenTime,
            retracementExtremePrice: bounceHigh,
            retracementExtremeTime: workingSet[bounceIndex]?.openTime || null,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: activeLockedLH.price,
            fibExtremePrice: lastConfirmedLL.price,
            fibRequiredRatio: minFib,
            fibRequiredPrice: fibTarget,
            actualRetracementRatio: fibRange > 0 ? (bounceHigh - discoveryLowestSinceHigh) / fibRange : 0,
            fibQualified: true,
            decision: 'INITIAL_LL_CONFIRMED',
            decisionReason: `Initial LL expansion low confirmed via ${retraceBars}-candle bounce reaching Fib target.`,
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          addPoint(activeLockedLH);
          addPoint(lastConfirmedLL);
          cycles.push({
            cycleId,
            direction: 'BEARISH',
            status: 'CONFIRMED',
            anchorPoint: {
              id: activeLockedLH.id,
              type: activeLockedLH.type,
              price: activeLockedLH.price,
              candleTime: activeLockedLH.candleOpenTime,
              candleTimeUnix: activeLockedLH.candleOpenTimeUnix,
              candleIndex: activeLockedLH.candleIndex,
            },
            expansionExtreme: {
              type: lastConfirmedLL.type,
              price: lastConfirmedLL.price,
              candleIndex: lastConfirmedLL.candleIndex!,
              candleTime: lastConfirmedLL.candleOpenTime,
              candleTimeUnix: lastConfirmedLL.candleOpenTimeUnix,
            },
            startedAt: discoveryHighTime,
            confirmedAt: candle.openTime,
          });

          structureState = StructureState.BEARISH;
          bearishCycleNumber = 1;
          addEvent(
            candle,
            'TREND_CONFIRMED',
            'Bearish Structure Discovered (LH1 → LL1)',
            `Locked LH: ${activeLockedLH.price.toFixed(2)}, LL: ${lastConfirmedLL.price.toFixed(2)}.`,
            { price: activeLockedLH.price }
          );
          continue;
        }
      }

      // Check Bullish Qualification
      if (discoveryHighestSinceLowIndex > discoveryLowIndex) {
        let pullLow = Infinity;
        let pullIndex = -1;
        for (let b = discoveryHighestSinceLowIndex; b <= i; b++) {
          if (workingSet[b].low < pullLow) {
            pullLow = workingSet[b].low;
            pullIndex = b;
          }
        }

        const retraceBars = pullIndex - discoveryHighestSinceLowIndex;
        const fibRange = discoveryHighestSinceLow - discoveryLowPrice;
        const fibTarget = discoveryHighestSinceLow - minFib * fibRange;

        if (retraceBars >= minCandles && pullLow <= fibTarget) {
          regimeCounter += 1;
          currentRegimeId = `REGIME_BULL_${regimeCounter}`;
          regimes.push({
            regimeId: currentRegimeId,
            direction: 'BULLISH',
            startedAt: discoveryLowTime,
            startedAtUnix: discoveryLowTimeUnix,
          });

          const cycleId = `cycle_bull_${cycles.length + 1}`;
          activeLockedHL = {
            id: `sp_hl_${symbol}_${discoveryLowTimeUnix}_${currentRegimeId}_cycle1_V4`,
            symbol,
            timeframe,
            candleOpenTime: discoveryLowTime,
            candleOpenTimeUnix: discoveryLowTimeUnix,
            type: StructurePointType.HL,
            price: discoveryLowPrice,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: discoveryLowIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: `audit_hl_${symbol}_${discoveryLowTimeUnix}_${currentRegimeId}`,
            trendState: StructureState.BULLISH,
            sequenceIndex: 1,
            sequenceLabel: 'HL1',
            cycleNumber: 1,
            confirmationReason: 'Initial structural HL discovered in main window (Locked Invalidation)',
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          lastConfirmedHH = {
            id: `sp_hh_${symbol}_${discoveryHighestSinceLowTimeUnix}_${currentRegimeId}_cycle1_V4`,
            symbol,
            timeframe,
            candleOpenTime: discoveryHighestSinceLowTime,
            candleOpenTimeUnix: discoveryHighestSinceLowTimeUnix,
            type: StructurePointType.HH,
            price: discoveryHighestSinceLow,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: discoveryHighestSinceLowIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: `audit_hh_${symbol}_${discoveryHighestSinceLowTimeUnix}_${currentRegimeId}`,
            previousStructurePointId: activeLockedHL.id,
            trendState: StructureState.BULLISH,
            sequenceIndex: 1,
            sequenceLabel: 'HH1',
            cycleNumber: 1,
            retracementCandles: retraceBars,
            retracementFibDepth: fibRange > 0 ? (discoveryHighestSinceLow - pullLow) / fibRange : 0,
            fibPriceLevel: fibTarget,
            confirmationReason: `Initial structural HH confirmed via ${retraceBars}-candle pullback`,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          recordAudit({
            eventId: activeLockedHL.auditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: 'HL1',
            eventType: 'HL',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.UNDEFINED,
            trendStateAfter: StructureState.BULLISH,
            candleIndex: activeLockedHL.candleIndex!,
            timestamp: activeLockedHL.candleOpenTime,
            timestampUnix: activeLockedHL.candleOpenTimeUnix,
            price: activeLockedHL.price,
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
            candidateExtremeType: StructurePointType.HL,
            candidateExtremePrice: activeLockedHL.price,
            candidateExtremeTime: activeLockedHL.candleOpenTime,
            candidateExtremeIndex: activeLockedHL.candleIndex,
            retracementStartTime: null,
            retracementExtremePrice: null,
            retracementExtremeTime: null,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: null,
            fibExtremePrice: null,
            fibRequiredRatio: minFib,
            fibRequiredPrice: null,
            actualRetracementRatio: fibRange > 0 ? (discoveryHighestSinceLow - pullLow) / fibRange : 0,
            fibQualified: true,
            decision: 'INITIAL_HL_LOCKED',
            decisionReason: 'First structural low discovered. Serves as the Bullish locked HL invalidation anchor.',
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          recordAudit({
            eventId: lastConfirmedHH.auditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: 'HH1',
            eventType: 'HH',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.UNDEFINED,
            trendStateAfter: StructureState.BULLISH,
            candleIndex: lastConfirmedHH.candleIndex!,
            timestamp: lastConfirmedHH.candleOpenTime,
            timestampUnix: lastConfirmedHH.candleOpenTimeUnix,
            price: lastConfirmedHH.price,
            previousLockedAnchorType: StructurePointType.HL,
            previousLockedAnchorPrice: activeLockedHL.price,
            previousLockedAnchorTime: activeLockedHL.candleOpenTime,
            previousStructuralExtremeType: null,
            previousStructuralExtremePrice: null,
            previousStructuralExtremeTime: null,
            breakRequired: false,
            breakLevel: null,
            breakWasBodyClose: false,
            breakWasWickOnly: false,
            candidateExtremeType: StructurePointType.HH,
            candidateExtremePrice: lastConfirmedHH.price,
            candidateExtremeTime: lastConfirmedHH.candleOpenTime,
            candidateExtremeIndex: lastConfirmedHH.candleIndex,
            retracementStartTime: lastConfirmedHH.candleOpenTime,
            retracementExtremePrice: pullLow,
            retracementExtremeTime: workingSet[pullIndex]?.openTime || null,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: activeLockedHL.price,
            fibExtremePrice: lastConfirmedHH.price,
            fibRequiredRatio: minFib,
            fibRequiredPrice: fibTarget,
            actualRetracementRatio: fibRange > 0 ? (discoveryHighestSinceLow - pullLow) / fibRange : 0,
            fibQualified: true,
            decision: 'INITIAL_HH_CONFIRMED',
            decisionReason: `Initial HH expansion high confirmed via ${retraceBars}-candle pullback reaching Fib target.`,
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          addPoint(activeLockedHL);
          addPoint(lastConfirmedHH);
          cycles.push({
            cycleId,
            direction: 'BULLISH',
            status: 'CONFIRMED',
            anchorPoint: {
              id: activeLockedHL.id,
              type: activeLockedHL.type,
              price: activeLockedHL.price,
              candleTime: activeLockedHL.candleOpenTime,
              candleTimeUnix: activeLockedHL.candleOpenTimeUnix,
              candleIndex: activeLockedHL.candleIndex,
            },
            expansionExtreme: {
              type: lastConfirmedHH.type,
              price: lastConfirmedHH.price,
              candleIndex: lastConfirmedHH.candleIndex!,
              candleTime: lastConfirmedHH.candleOpenTime,
              candleTimeUnix: lastConfirmedHH.candleOpenTimeUnix,
            },
            startedAt: discoveryLowTime,
            confirmedAt: candle.openTime,
          });

          structureState = StructureState.BULLISH;
          bullishCycleNumber = 1;
          addEvent(
            candle,
            'TREND_CONFIRMED',
            'Bullish Structure Discovered (HL1 → HH1)',
            `Locked HL: ${activeLockedHL.price.toFixed(2)}, HH: ${lastConfirmedHH.price.toFixed(2)}.`,
            { price: activeLockedHL.price }
          );
          continue;
        }
      }
      continue;
    }

    // ==========================================
    // STATE: BULLISH
    // ==========================================
    if (structureState === StructureState.BULLISH) {
      // 1. Strict Invalidation Check: Candle CLOSE below locked HL
      if (activeLockedHL && candle.close < activeLockedHL.price) {
        structureState = StructureState.BULLISH_STRUCTURE_BROKEN;
        const breakPrice = candle.close;
        const brokenLevel = activeLockedHL.price;
        const label = `BULLISH STRUCTURE BROKEN (Close < ${activeLockedHL.sequenceLabel ?? 'HL'} ${brokenLevel.toFixed(2)})`;
        const breakAuditId = `audit_break_bull_${symbol}_${candle.openTimeUnix}_${currentRegimeId}`;
        const breakEventId = `break_bull_${symbol}_${candle.openTimeUnix}`;

        structureBreakEvents.push({
          id: breakEventId,
          candleTime: candle.openTime,
          candleTimeUnix: candle.openTimeUnix,
          price: breakPrice,
          brokenLevel,
          breakType: 'BULLISH_STRUCTURE_BROKEN',
          label,
          candleIndex: i,
          regimeId: currentRegimeId,
          auditId: breakAuditId,
        });

        const currentReg = regimes.find((r) => r.regimeId === currentRegimeId);
        if (currentReg) {
          currentReg.endedAt = candle.openTime;
          currentReg.endedAtUnix = candle.openTimeUnix;
        }

        recordAudit({
          eventId: breakAuditId,
          regimeId: currentRegimeId,
          cycleId: `cycle_bull_${bullishCycleNumber}`,
          sequenceId: activeLockedHL.sequenceLabel || 'HL',
          eventType: 'BULLISH_STRUCTURE_BROKEN',
          status: 'CONFIRMED',
          trendStateBefore: StructureState.BULLISH,
          trendStateAfter: StructureState.BULLISH_STRUCTURE_BROKEN,
          candleIndex: i,
          timestamp: candle.openTime,
          timestampUnix: candle.openTimeUnix,
          price: breakPrice,
          previousLockedAnchorType: StructurePointType.HL,
          previousLockedAnchorPrice: activeLockedHL.price,
          previousLockedAnchorTime: activeLockedHL.candleOpenTime,
          previousStructuralExtremeType: lastConfirmedHH?.type || null,
          previousStructuralExtremePrice: lastConfirmedHH?.price || null,
          previousStructuralExtremeTime: lastConfirmedHH?.candleOpenTime || null,
          breakRequired: true,
          breakLevel: brokenLevel,
          breakCandle: {
            index: i,
            time: candle.openTime,
            timeUnix: candle.openTimeUnix,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            wickExceededLevel: candle.low < brokenLevel,
            bodyCloseExceededLevel: true,
          },
          breakWasBodyClose: true,
          breakWasWickOnly: false,
          candidateExtremeType: null,
          candidateExtremePrice: null,
          candidateExtremeTime: null,
          candidateExtremeIndex: null,
          retracementStartTime: null,
          retracementExtremePrice: null,
          retracementExtremeTime: null,
          retracementCandleCount: 0,
          requiredRetracementCandles: minCandles,
          candleCountQualified: true,
          fibAnchorPrice: null,
          fibExtremePrice: null,
          fibRequiredRatio: minFib,
          fibRequiredPrice: null,
          actualRetracementRatio: null,
          fibQualified: true,
          decision: 'BULLISH_INVALIDATION_CONFIRMED',
          decisionReason: `Candle close of ${breakPrice.toFixed(2)} closed below active locked ${activeLockedHL.sequenceLabel ?? 'HL'} (${brokenLevel.toFixed(2)}). Bullish structure is officially broken.`,
          algorithmVersion: ALGORITHM_VERSION_V4,
        });

        addEvent(
          candle,
          'STRUCTURE_BROKEN',
          'Bullish Structure Broken (Transition → Bearish)',
          `Closed at ${breakPrice.toFixed(2)} below locked ${activeLockedHL.sequenceLabel ?? 'HL'} (${brokenLevel.toFixed(2)}).`,
          { price: breakPrice, referencePrice: brokenLevel }
        );

        // Reset candidate trackers
        candidateType = null;
        candidatePrice = 0;
        lowestLowSinceCandidate = Infinity;

        // Reset discovery trackers for transitional BEARISH search
        discoveryHighPrice = -Infinity;
        discoveryHighIndex = -1;
        discoveryHighTime = '';
        discoveryHighTimeUnix = 0;
        discoveryLowestSinceHigh = Infinity;
        discoveryLowestSinceHighIndex = -1;
        discoveryLowestSinceHighTime = '';
        discoveryLowestSinceHighTimeUnix = 0;
      } else if (activeLockedHL && candle.low < activeLockedHL.price && candle.close >= activeLockedHL.price) {
        rejectedEvents.push({
          id: `rej_hl_${symbol}_${candle.openTimeUnix}`,
          regimeId: currentRegimeId,
          cycleId: `cycle_bull_${bullishCycleNumber}`,
          candleIndex: i,
          timestamp: candle.openTime,
          timestampUnix: candle.openTimeUnix,
          rejectionType: 'REJECTED_INVALIDATION',
          attemptedLevel: activeLockedHL.price,
          actualValue: candle.close,
          requiredValue: activeLockedHL.price,
          reason: `Wick breached locked ${activeLockedHL.sequenceLabel ?? 'HL'} (${activeLockedHL.price.toFixed(2)}), but candle closed at ${candle.close.toFixed(2)} above level. Invalidation rejected (structure held).`,
        });
      }

      // 2. Expansion Break: Candle CLOSE above last confirmed HH begins or continues HH cycle
      if (lastConfirmedHH && candle.close > lastConfirmedHH.price) {
        if (!candidateType) {
          candidateType = StructurePointType.PROVISIONAL_HH;
          candidatePrice = candle.high;
          candidateCandleIndex = i;
          candidateCandleTime = candle.openTime;
          candidateCandleTimeUnix = candle.openTimeUnix;
          referencePrice = activeLockedHL ? activeLockedHL.price : lastConfirmedHH.price;
          referenceTime = activeLockedHL ? activeLockedHL.candleOpenTime : lastConfirmedHH.candleOpenTime;

          lowestLowSinceCandidate = candle.low;
          lowestLowIndex = i;
          lowestLowTime = candle.openTime;
          lowestLowTimeUnix = candle.openTimeUnix;

          breakCandleDetail = {
            index: i,
            time: candle.openTime,
            timeUnix: candle.openTimeUnix,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            wickExceededLevel: true,
            bodyCloseExceededLevel: true,
          };

          addEvent(
            candle,
            'CANDIDATE_CREATED',
            'New Bullish Expansion Cycle Begun',
            `Close ${candle.close.toFixed(2)} > previous HH (${lastConfirmedHH.price.toFixed(2)}).`,
            { price: candle.high, referencePrice }
          );
        }
      } else if (lastConfirmedHH && candle.high > lastConfirmedHH.price && candle.close <= lastConfirmedHH.price && !candidateType) {
        rejectedEvents.push({
          id: `rej_hh_wick_${symbol}_${candle.openTimeUnix}`,
          regimeId: currentRegimeId,
          cycleId: `cycle_bull_${bullishCycleNumber}`,
          candleIndex: i,
          timestamp: candle.openTime,
          timestampUnix: candle.openTimeUnix,
          rejectionType: 'REJECTED_HIGH',
          attemptedLevel: lastConfirmedHH.price,
          actualValue: candle.close,
          requiredValue: lastConfirmedHH.price,
          reason: `Wick reached ${candle.high.toFixed(2)} above previous ${lastConfirmedHH.sequenceLabel ?? 'HH'} (${lastConfirmedHH.price.toFixed(2)}), but closed at ${candle.close.toFixed(2)} without a body close above. Expansion not initiated.`,
        });
      }

      // 3. Track Provisional HH and Retracement Pullback
      if (candidateType === StructurePointType.PROVISIONAL_HH) {
        if (candle.high > candidatePrice) {
          candidatePrice = candle.high;
          candidateCandleIndex = i;
          candidateCandleTime = candle.openTime;
          candidateCandleTimeUnix = candle.openTimeUnix;

          // Reset retracement low tracking on new high extreme
          lowestLowSinceCandidate = candle.low;
          lowestLowIndex = i;
          lowestLowTime = candle.openTime;
          lowestLowTimeUnix = candle.openTimeUnix;
        } else if (candle.low < lowestLowSinceCandidate) {
          lowestLowSinceCandidate = candle.low;
          lowestLowIndex = i;
          lowestLowTime = candle.openTime;
          lowestLowTimeUnix = candle.openTimeUnix;
        }

        // 4. Retracement Qualification Check
        const retraceBars = lowestLowIndex - candidateCandleIndex;
        const totalRange = candidatePrice - referencePrice;
        const fibTarget = candidatePrice - minFib * totalRange;
        const currentFibDepth = totalRange > 0 ? (candidatePrice - lowestLowSinceCandidate) / totalRange : 0;

        if (retraceBars >= minCandles && lowestLowSinceCandidate <= fibTarget && totalRange > 0) {
          bullishCycleNumber += 1;
          const cycleId = `cycle_bull_${bullishCycleNumber}`;
          const newHHAuditId = `audit_hh_${symbol}_${candidateCandleTimeUnix}_${currentRegimeId}_cycle${bullishCycleNumber}`;
          const newHLAuditId = `audit_hl_${symbol}_${lowestLowTimeUnix}_${currentRegimeId}_cycle${bullishCycleNumber}`;

          const retracementBarsDetail: RetracementBarDetail[] = [];
          let fibQualifyingCandleDetail: BreakCandleDetail | null = null;
          for (let b = candidateCandleIndex + 1; b <= i; b++) {
            const bar = workingSet[b];
            const isExtreme = b === lowestLowIndex;
            const reachedFib = bar.low <= fibTarget;
            if (reachedFib && !fibQualifyingCandleDetail) {
              fibQualifyingCandleDetail = {
                index: b,
                time: bar.openTime,
                timeUnix: bar.openTimeUnix,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                wickExceededLevel: true,
                bodyCloseExceededLevel: bar.close <= fibTarget,
              };
            }
            retracementBarsDetail.push({
              index: b,
              time: bar.openTime,
              timeUnix: bar.openTimeUnix,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              isRetracementExtreme: isExtreme,
              reachedRequiredFib: reachedFib,
            });
          }

          // Confirm the HH
          const newHH: StructurePoint = {
            id: `sp_hh_${symbol}_${candidateCandleTimeUnix}_${currentRegimeId}_cycle${bullishCycleNumber}_V4`,
            symbol,
            timeframe,
            candleOpenTime: candidateCandleTime,
            candleOpenTimeUnix: candidateCandleTimeUnix,
            type: StructurePointType.HH,
            price: candidatePrice,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: candidateCandleIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: newHHAuditId,
            previousStructurePointId: activeLockedHL ? activeLockedHL.id : null,
            trendState: StructureState.BULLISH,
            sequenceIndex: bullishCycleNumber,
            sequenceLabel: `HH${bullishCycleNumber}`,
            cycleNumber: bullishCycleNumber,
            confirmationReason: `Qualified retracement (${retraceBars} bars, ${(currentFibDepth * 100).toFixed(1)}% Fib)`,
            retracementCandles: retraceBars,
            retracementFibDepth: currentFibDepth,
            fibPriceLevel: fibTarget,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          // Confirm and LOCK the new HL
          const newHL: StructurePoint = {
            id: `sp_hl_${symbol}_${lowestLowTimeUnix}_${currentRegimeId}_cycle${bullishCycleNumber}_V4`,
            symbol,
            timeframe,
            candleOpenTime: lowestLowTime,
            candleOpenTimeUnix: lowestLowTimeUnix,
            type: StructurePointType.HL,
            price: lowestLowSinceCandidate,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: lowestLowIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: newHLAuditId,
            previousStructurePointId: newHH.id,
            trendState: StructureState.BULLISH,
            sequenceIndex: bullishCycleNumber,
            sequenceLabel: `HL${bullishCycleNumber}`,
            cycleNumber: bullishCycleNumber,
            confirmationReason: 'Retracement low confirmed as new Locked HL Invalidation anchor',
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          recordAudit({
            eventId: newHHAuditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: `HH${bullishCycleNumber}`,
            eventType: 'HH',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.BULLISH,
            trendStateAfter: StructureState.BULLISH,
            candleIndex: candidateCandleIndex,
            timestamp: candidateCandleTime,
            timestampUnix: candidateCandleTimeUnix,
            price: candidatePrice,
            previousLockedAnchorType: StructurePointType.HL,
            previousLockedAnchorPrice: activeLockedHL?.price || null,
            previousLockedAnchorTime: activeLockedHL?.candleOpenTime || null,
            previousStructuralExtremeType: StructurePointType.HH,
            previousStructuralExtremePrice: lastConfirmedHH?.price || null,
            previousStructuralExtremeTime: lastConfirmedHH?.candleOpenTime || null,
            breakRequired: true,
            breakLevel: lastConfirmedHH?.price || null,
            breakCandle: breakCandleDetail,
            breakWasBodyClose: true,
            breakWasWickOnly: false,
            candidateExtremeType: StructurePointType.HH,
            candidateExtremePrice: candidatePrice,
            candidateExtremeTime: candidateCandleTime,
            candidateExtremeIndex: candidateCandleIndex,
            retracementStartTime: candidateCandleTime,
            retracementExtremePrice: lowestLowSinceCandidate,
            retracementExtremeTime: lowestLowTime,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: referencePrice,
            fibExtremePrice: candidatePrice,
            fibRequiredRatio: minFib,
            fibRequiredPrice: fibTarget,
            actualRetracementRatio: currentFibDepth,
            fibQualified: true,
            retracementBars: retracementBarsDetail,
            fibQualifyingCandle: fibQualifyingCandleDetail,
            decision: 'HH_CONFIRMED',
            decisionReason: `Expansion high confirmed via ${retraceBars}-candle (${(currentFibDepth * 100).toFixed(1)}% Fib) pullback.`,
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          recordAudit({
            eventId: newHLAuditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: `HL${bullishCycleNumber}`,
            eventType: 'HL',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.BULLISH,
            trendStateAfter: StructureState.BULLISH,
            candleIndex: lowestLowIndex,
            timestamp: lowestLowTime,
            timestampUnix: lowestLowTimeUnix,
            price: lowestLowSinceCandidate,
            previousLockedAnchorType: StructurePointType.HL,
            previousLockedAnchorPrice: activeLockedHL?.price || null,
            previousLockedAnchorTime: activeLockedHL?.candleOpenTime || null,
            previousStructuralExtremeType: StructurePointType.HH,
            previousStructuralExtremePrice: candidatePrice,
            previousStructuralExtremeTime: candidateCandleTime,
            breakRequired: false,
            breakLevel: null,
            breakWasBodyClose: false,
            breakWasWickOnly: false,
            candidateExtremeType: StructurePointType.HL,
            candidateExtremePrice: lowestLowSinceCandidate,
            candidateExtremeTime: lowestLowTime,
            candidateExtremeIndex: lowestLowIndex,
            retracementStartTime: candidateCandleTime,
            retracementExtremePrice: lowestLowSinceCandidate,
            retracementExtremeTime: lowestLowTime,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: referencePrice,
            fibExtremePrice: candidatePrice,
            fibRequiredRatio: minFib,
            fibRequiredPrice: fibTarget,
            actualRetracementRatio: currentFibDepth,
            fibQualified: true,
            retracementBars: retracementBarsDetail,
            fibQualifyingCandle: fibQualifyingCandleDetail,
            decision: 'HL_LOCKED',
            decisionReason: `Retracement low confirmed and locked as active HL invalidation anchor for cycle ${bullishCycleNumber}. Invalidation requires candle body close below ${lowestLowSinceCandidate.toFixed(2)}.`,
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          addPoint(newHH);
          addPoint(newHL);
          lastConfirmedHH = newHH;
          activeLockedHL = newHL;

          cycles.push({
            cycleId,
            direction: 'BULLISH',
            status: 'CONFIRMED',
            anchorPoint: {
              id: newHL.id,
              type: newHL.type,
              price: newHL.price,
              candleTime: newHL.candleOpenTime,
              candleTimeUnix: newHL.candleOpenTimeUnix,
              candleIndex: newHL.candleIndex,
            },
            expansionExtreme: {
              type: newHH.type,
              price: newHH.price,
              candleIndex: newHH.candleIndex!,
              candleTime: newHH.candleOpenTime,
              candleTimeUnix: newHH.candleOpenTimeUnix,
            },
            startedAt: candidateCandleTime,
            confirmedAt: candle.openTime,
          });

          addEvent(
            candle,
            'STRUCTURE_CONFIRMED',
            `Cycle ${bullishCycleNumber} Confirmed (HH${bullishCycleNumber} & HL${bullishCycleNumber})`,
            `Confirmed HH: ${newHH.price.toFixed(2)}, Locked Invalidation HL: ${newHL.price.toFixed(2)}.`,
            { price: newHH.price, referencePrice: newHL.price }
          );

          // Reset candidate trackers
          candidateType = null;
          candidatePrice = 0;
          lowestLowSinceCandidate = Infinity;
        }
      }
    }

    // ==========================================
    // STATE: BEARISH
    // ==========================================
    if (structureState === StructureState.BEARISH) {
      // 1. Strict Invalidation Check: Candle CLOSE above locked LH
      if (activeLockedLH && candle.close > activeLockedLH.price) {
        structureState = StructureState.BEARISH_STRUCTURE_BROKEN;
        const breakPrice = candle.close;
        const brokenLevel = activeLockedLH.price;
        const label = `BEARISH STRUCTURE BROKEN (Close > ${activeLockedLH.sequenceLabel ?? 'LH'} ${brokenLevel.toFixed(2)})`;
        const breakAuditId = `audit_break_bear_${symbol}_${candle.openTimeUnix}_${currentRegimeId}`;
        const breakEventId = `break_bear_${symbol}_${candle.openTimeUnix}`;

        structureBreakEvents.push({
          id: breakEventId,
          candleTime: candle.openTime,
          candleTimeUnix: candle.openTimeUnix,
          price: breakPrice,
          brokenLevel,
          breakType: 'BEARISH_STRUCTURE_BROKEN',
          label,
          candleIndex: i,
          regimeId: currentRegimeId,
          auditId: breakAuditId,
        });

        const currentReg = regimes.find((r) => r.regimeId === currentRegimeId);
        if (currentReg) {
          currentReg.endedAt = candle.openTime;
          currentReg.endedAtUnix = candle.openTimeUnix;
        }

        recordAudit({
          eventId: breakAuditId,
          regimeId: currentRegimeId,
          cycleId: `cycle_bear_${bearishCycleNumber}`,
          sequenceId: activeLockedLH.sequenceLabel || 'LH',
          eventType: 'BEARISH_STRUCTURE_BROKEN',
          status: 'CONFIRMED',
          trendStateBefore: StructureState.BEARISH,
          trendStateAfter: StructureState.BEARISH_STRUCTURE_BROKEN,
          candleIndex: i,
          timestamp: candle.openTime,
          timestampUnix: candle.openTimeUnix,
          price: breakPrice,
          previousLockedAnchorType: StructurePointType.LH,
          previousLockedAnchorPrice: activeLockedLH.price,
          previousLockedAnchorTime: activeLockedLH.candleOpenTime,
          previousStructuralExtremeType: lastConfirmedLL?.type || null,
          previousStructuralExtremePrice: lastConfirmedLL?.price || null,
          previousStructuralExtremeTime: lastConfirmedLL?.candleOpenTime || null,
          breakRequired: true,
          breakLevel: brokenLevel,
          breakCandle: {
            index: i,
            time: candle.openTime,
            timeUnix: candle.openTimeUnix,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            wickExceededLevel: candle.high > brokenLevel,
            bodyCloseExceededLevel: true,
          },
          breakWasBodyClose: true,
          breakWasWickOnly: false,
          candidateExtremeType: null,
          candidateExtremePrice: null,
          candidateExtremeTime: null,
          candidateExtremeIndex: null,
          retracementStartTime: null,
          retracementExtremePrice: null,
          retracementExtremeTime: null,
          retracementCandleCount: 0,
          requiredRetracementCandles: minCandles,
          candleCountQualified: true,
          fibAnchorPrice: null,
          fibExtremePrice: null,
          fibRequiredRatio: minFib,
          fibRequiredPrice: null,
          actualRetracementRatio: null,
          fibQualified: true,
          decision: 'BEARISH_INVALIDATION_CONFIRMED',
          decisionReason: `Candle close of ${breakPrice.toFixed(2)} closed above active locked ${activeLockedLH.sequenceLabel ?? 'LH'} (${brokenLevel.toFixed(2)}). Bearish structure is officially broken.`,
          algorithmVersion: ALGORITHM_VERSION_V4,
        });

        addEvent(
          candle,
          'STRUCTURE_BROKEN',
          'Bearish Structure Broken (Transition → Bullish)',
          `Closed at ${breakPrice.toFixed(2)} above locked ${activeLockedLH.sequenceLabel ?? 'LH'} (${brokenLevel.toFixed(2)}).`,
          { price: breakPrice, referencePrice: brokenLevel }
        );

        candidateType = null;
        candidatePrice = 0;
        highestHighSinceCandidate = -Infinity;

        // Reset discovery trackers for transitional BULLISH search
        discoveryLowPrice = Infinity;
        discoveryLowIndex = -1;
        discoveryLowTime = '';
        discoveryLowTimeUnix = 0;
        discoveryHighestSinceLow = -Infinity;
        discoveryHighestSinceLowIndex = -1;
        discoveryHighestSinceLowTime = '';
        discoveryHighestSinceLowTimeUnix = 0;
      } else if (activeLockedLH && candle.high > activeLockedLH.price && candle.close <= activeLockedLH.price) {
        rejectedEvents.push({
          id: `rej_lh_${symbol}_${candle.openTimeUnix}`,
          regimeId: currentRegimeId,
          cycleId: `cycle_bear_${bearishCycleNumber}`,
          candleIndex: i,
          timestamp: candle.openTime,
          timestampUnix: candle.openTimeUnix,
          rejectionType: 'REJECTED_INVALIDATION',
          attemptedLevel: activeLockedLH.price,
          actualValue: candle.close,
          requiredValue: activeLockedLH.price,
          reason: `Wick breached locked ${activeLockedLH.sequenceLabel ?? 'LH'} (${activeLockedLH.price.toFixed(2)}), but candle closed at ${candle.close.toFixed(2)} below level. Invalidation rejected (structure held).`,
        });
      }

      // 2. Expansion Break: Candle CLOSE below last confirmed LL begins LL cycle
      if (lastConfirmedLL && candle.close < lastConfirmedLL.price) {
        if (!candidateType) {
          candidateType = StructurePointType.PROVISIONAL_LL;
          candidatePrice = candle.low;
          candidateCandleIndex = i;
          candidateCandleTime = candle.openTime;
          candidateCandleTimeUnix = candle.openTimeUnix;
          referencePrice = activeLockedLH ? activeLockedLH.price : lastConfirmedLL.price;
          referenceTime = activeLockedLH ? activeLockedLH.candleOpenTime : lastConfirmedLL.candleOpenTime;

          highestHighSinceCandidate = candle.high;
          highestHighIndex = i;
          highestHighTime = candle.openTime;
          highestHighTimeUnix = candle.openTimeUnix;

          breakCandleDetail = {
            index: i,
            time: candle.openTime,
            timeUnix: candle.openTimeUnix,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            wickExceededLevel: true,
            bodyCloseExceededLevel: true,
          };

          addEvent(
            candle,
            'CANDIDATE_CREATED',
            'New Bearish Expansion Cycle Begun',
            `Close ${candle.close.toFixed(2)} < previous LL (${lastConfirmedLL.price.toFixed(2)}).`,
            { price: candle.low, referencePrice }
          );
        }
      } else if (lastConfirmedLL && candle.low < lastConfirmedLL.price && candle.close >= lastConfirmedLL.price && !candidateType) {
        rejectedEvents.push({
          id: `rej_ll_wick_${symbol}_${candle.openTimeUnix}`,
          regimeId: currentRegimeId,
          cycleId: `cycle_bear_${bearishCycleNumber}`,
          candleIndex: i,
          timestamp: candle.openTime,
          timestampUnix: candle.openTimeUnix,
          rejectionType: 'REJECTED_LOW',
          attemptedLevel: lastConfirmedLL.price,
          actualValue: candle.close,
          requiredValue: lastConfirmedLL.price,
          reason: `Wick reached ${candle.low.toFixed(2)} below previous ${lastConfirmedLL.sequenceLabel ?? 'LL'} (${lastConfirmedLL.price.toFixed(2)}), but closed at ${candle.close.toFixed(2)} without a body close below. Expansion not initiated.`,
        });
      }

      // 3. Track Provisional LL and Retracement Bounce
      if (candidateType === StructurePointType.PROVISIONAL_LL) {
        if (candle.low < candidatePrice) {
          candidatePrice = candle.low;
          candidateCandleIndex = i;
          candidateCandleTime = candle.openTime;
          candidateCandleTimeUnix = candle.openTimeUnix;

          highestHighSinceCandidate = candle.high;
          highestHighIndex = i;
          highestHighTime = candle.openTime;
          highestHighTimeUnix = candle.openTimeUnix;
        } else if (candle.high > highestHighSinceCandidate) {
          highestHighSinceCandidate = candle.high;
          highestHighIndex = i;
          highestHighTime = candle.openTime;
          highestHighTimeUnix = candle.openTimeUnix;
        }

        // 4. Retracement Qualification Check
        const retraceBars = highestHighIndex - candidateCandleIndex;
        const totalRange = referencePrice - candidatePrice;
        const fibTarget = candidatePrice + minFib * totalRange;
        const currentFibDepth = totalRange > 0 ? (highestHighSinceCandidate - candidatePrice) / totalRange : 0;

        if (retraceBars >= minCandles && highestHighSinceCandidate >= fibTarget && totalRange > 0) {
          bearishCycleNumber += 1;
          const cycleId = `cycle_bear_${bearishCycleNumber}`;
          const newLLAuditId = `audit_ll_${symbol}_${candidateCandleTimeUnix}_${currentRegimeId}_cycle${bearishCycleNumber}`;
          const newLHAuditId = `audit_lh_${symbol}_${highestHighTimeUnix}_${currentRegimeId}_cycle${bearishCycleNumber}`;

          const retracementBarsDetail: RetracementBarDetail[] = [];
          let fibQualifyingCandleDetail: BreakCandleDetail | null = null;
          for (let b = candidateCandleIndex + 1; b <= i; b++) {
            const bar = workingSet[b];
            const isExtreme = b === highestHighIndex;
            const reachedFib = bar.high >= fibTarget;
            if (reachedFib && !fibQualifyingCandleDetail) {
              fibQualifyingCandleDetail = {
                index: b,
                time: bar.openTime,
                timeUnix: bar.openTimeUnix,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                wickExceededLevel: true,
                bodyCloseExceededLevel: bar.close >= fibTarget,
              };
            }
            retracementBarsDetail.push({
              index: b,
              time: bar.openTime,
              timeUnix: bar.openTimeUnix,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              isRetracementExtreme: isExtreme,
              reachedRequiredFib: reachedFib,
            });
          }

          // Confirm the LL
          const newLL: StructurePoint = {
            id: `sp_ll_${symbol}_${candidateCandleTimeUnix}_${currentRegimeId}_cycle${bearishCycleNumber}_V4`,
            symbol,
            timeframe,
            candleOpenTime: candidateCandleTime,
            candleOpenTimeUnix: candidateCandleTimeUnix,
            type: StructurePointType.LL,
            price: candidatePrice,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: candidateCandleIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: newLLAuditId,
            previousStructurePointId: activeLockedLH ? activeLockedLH.id : null,
            trendState: StructureState.BEARISH,
            sequenceIndex: bearishCycleNumber,
            sequenceLabel: `LL${bearishCycleNumber}`,
            cycleNumber: bearishCycleNumber,
            confirmationReason: `Qualified retracement (${retraceBars} bars, ${(currentFibDepth * 100).toFixed(1)}% Fib)`,
            retracementCandles: retraceBars,
            retracementFibDepth: currentFibDepth,
            fibPriceLevel: fibTarget,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          // Confirm and LOCK the new LH
          const newLH: StructurePoint = {
            id: `sp_lh_${symbol}_${highestHighTimeUnix}_${currentRegimeId}_cycle${bearishCycleNumber}_V4`,
            symbol,
            timeframe,
            candleOpenTime: highestHighTime,
            candleOpenTimeUnix: highestHighTimeUnix,
            type: StructurePointType.LH,
            price: highestHighSinceCandidate,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: highestHighIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: newLHAuditId,
            previousStructurePointId: newLL.id,
            trendState: StructureState.BEARISH,
            sequenceIndex: bearishCycleNumber,
            sequenceLabel: `LH${bearishCycleNumber}`,
            cycleNumber: bearishCycleNumber,
            confirmationReason: 'Retracement high confirmed as new Locked LH Invalidation anchor',
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          recordAudit({
            eventId: newLLAuditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: `LL${bearishCycleNumber}`,
            eventType: 'LL',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.BEARISH,
            trendStateAfter: StructureState.BEARISH,
            candleIndex: candidateCandleIndex,
            timestamp: candidateCandleTime,
            timestampUnix: candidateCandleTimeUnix,
            price: candidatePrice,
            previousLockedAnchorType: StructurePointType.LH,
            previousLockedAnchorPrice: activeLockedLH?.price || null,
            previousLockedAnchorTime: activeLockedLH?.candleOpenTime || null,
            previousStructuralExtremeType: StructurePointType.LL,
            previousStructuralExtremePrice: lastConfirmedLL?.price || null,
            previousStructuralExtremeTime: lastConfirmedLL?.candleOpenTime || null,
            breakRequired: true,
            breakLevel: lastConfirmedLL?.price || null,
            breakCandle: breakCandleDetail,
            breakWasBodyClose: true,
            breakWasWickOnly: false,
            candidateExtremeType: StructurePointType.LL,
            candidateExtremePrice: candidatePrice,
            candidateExtremeTime: candidateCandleTime,
            candidateExtremeIndex: candidateCandleIndex,
            retracementStartTime: candidateCandleTime,
            retracementExtremePrice: highestHighSinceCandidate,
            retracementExtremeTime: highestHighTime,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: referencePrice,
            fibExtremePrice: candidatePrice,
            fibRequiredRatio: minFib,
            fibRequiredPrice: fibTarget,
            actualRetracementRatio: currentFibDepth,
            fibQualified: true,
            retracementBars: retracementBarsDetail,
            fibQualifyingCandle: fibQualifyingCandleDetail,
            decision: 'LL_CONFIRMED',
            decisionReason: `Expansion low confirmed via ${retraceBars}-candle (${(currentFibDepth * 100).toFixed(1)}% Fib) bounce.`,
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          recordAudit({
            eventId: newLHAuditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: `LH${bearishCycleNumber}`,
            eventType: 'LH',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.BEARISH,
            trendStateAfter: StructureState.BEARISH,
            candleIndex: highestHighIndex,
            timestamp: highestHighTime,
            timestampUnix: highestHighTimeUnix,
            price: highestHighSinceCandidate,
            previousLockedAnchorType: StructurePointType.LH,
            previousLockedAnchorPrice: activeLockedLH?.price || null,
            previousLockedAnchorTime: activeLockedLH?.candleOpenTime || null,
            previousStructuralExtremeType: StructurePointType.LL,
            previousStructuralExtremePrice: candidatePrice,
            previousStructuralExtremeTime: candidateCandleTime,
            breakRequired: false,
            breakLevel: null,
            breakWasBodyClose: false,
            breakWasWickOnly: false,
            candidateExtremeType: StructurePointType.LH,
            candidateExtremePrice: highestHighSinceCandidate,
            candidateExtremeTime: highestHighTime,
            candidateExtremeIndex: highestHighIndex,
            retracementStartTime: candidateCandleTime,
            retracementExtremePrice: highestHighSinceCandidate,
            retracementExtremeTime: highestHighTime,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: referencePrice,
            fibExtremePrice: candidatePrice,
            fibRequiredRatio: minFib,
            fibRequiredPrice: fibTarget,
            actualRetracementRatio: currentFibDepth,
            fibQualified: true,
            retracementBars: retracementBarsDetail,
            fibQualifyingCandle: fibQualifyingCandleDetail,
            decision: 'LH_LOCKED',
            decisionReason: `Retracement high confirmed and locked as active LH invalidation anchor for cycle ${bearishCycleNumber}. Invalidation requires candle body close above ${highestHighSinceCandidate.toFixed(2)}.`,
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          addPoint(newLL);
          addPoint(newLH);
          lastConfirmedLL = newLL;
          activeLockedLH = newLH;

          cycles.push({
            cycleId,
            direction: 'BEARISH',
            status: 'CONFIRMED',
            anchorPoint: {
              id: newLH.id,
              type: newLH.type,
              price: newLH.price,
              candleTime: newLH.candleOpenTime,
              candleTimeUnix: newLH.candleOpenTimeUnix,
              candleIndex: newLH.candleIndex,
            },
            expansionExtreme: {
              type: newLL.type,
              price: newLL.price,
              candleIndex: newLL.candleIndex!,
              candleTime: newLL.candleOpenTime,
              candleTimeUnix: newLL.candleOpenTimeUnix,
            },
            startedAt: candidateCandleTime,
            confirmedAt: candle.openTime,
          });

          addEvent(
            candle,
            'STRUCTURE_CONFIRMED',
            `Cycle ${bearishCycleNumber} Confirmed (LL${bearishCycleNumber} & LH${bearishCycleNumber})`,
            `Confirmed LL: ${newLL.price.toFixed(2)}, Locked Invalidation LH: ${newLH.price.toFixed(2)}.`,
            { price: newLL.price, referencePrice: newLH.price }
          );

          candidateType = null;
          candidatePrice = 0;
          highestHighSinceCandidate = -Infinity;
        }
      }
    }

    // ==========================================
    // STATE: BULLISH_STRUCTURE_BROKEN (Transition -> Bearish)
    // ==========================================
    if (structureState === StructureState.BULLISH_STRUCTURE_BROKEN) {
      // Market needs a confirmed LH -> LL cycle to transition to BEARISH
      // Find peak after break and trough drop
      if (candle.high > discoveryHighPrice || discoveryHighIndex === -1) {
        discoveryHighPrice = candle.high;
        discoveryHighIndex = i;
        discoveryHighTime = candle.openTime;
        discoveryHighTimeUnix = candle.openTimeUnix;
        discoveryLowestSinceHigh = candle.low;
        discoveryLowestSinceHighIndex = i;
        discoveryLowestSinceHighTime = candle.openTime;
        discoveryLowestSinceHighTimeUnix = candle.openTimeUnix;
      } else if (candle.low < discoveryLowestSinceHigh) {
        discoveryLowestSinceHigh = candle.low;
        discoveryLowestSinceHighIndex = i;
        discoveryLowestSinceHighTime = candle.openTime;
        discoveryLowestSinceHighTimeUnix = candle.openTimeUnix;
      }

      if (discoveryLowestSinceHighIndex > discoveryHighIndex) {
        let bounceHigh = -Infinity;
        let bounceIdx = -1;
        for (let b = discoveryLowestSinceHighIndex; b <= i; b++) {
          if (workingSet[b].high > bounceHigh) {
            bounceHigh = workingSet[b].high;
            bounceIdx = b;
          }
        }

        const retraceBars = bounceIdx - discoveryLowestSinceHighIndex;
        const fibRange = discoveryHighPrice - discoveryLowestSinceHigh;
        const fibTarget = discoveryLowestSinceHigh + minFib * fibRange;

        if (retraceBars >= minCandles && bounceHigh >= fibTarget && fibRange > 0) {
          bearishCycleNumber = cycles.filter((c) => c.direction === 'BEARISH').length + 1;
          const cycleId = `cycle_bear_${bearishCycleNumber}`;
          regimeCounter += 1;
          currentRegimeId = `regime_bear_${regimeCounter}_${symbol}_${discoveryHighTimeUnix}`;
          regimes.push({
            regimeId: currentRegimeId,
            direction: 'BEARISH',
            startedAt: discoveryHighTime,
            startedAtUnix: discoveryHighTimeUnix,
            startReason: 'REVERSAL_CONFIRMED',
          });

          const lh1AuditId = `audit_lh_${symbol}_${discoveryHighTimeUnix}_${currentRegimeId}_rev`;
          const ll1AuditId = `audit_ll_${symbol}_${discoveryLowestSinceHighTimeUnix}_${currentRegimeId}_rev`;

          activeLockedLH = {
            id: `sp_lh_${symbol}_${discoveryHighTimeUnix}_${cycleId}_V4_rev`,
            symbol,
            timeframe,
            candleOpenTime: discoveryHighTime,
            candleOpenTimeUnix: discoveryHighTimeUnix,
            type: StructurePointType.LH,
            price: discoveryHighPrice,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: discoveryHighIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: lh1AuditId,
            trendState: StructureState.BEARISH,
            sequenceIndex: 1,
            sequenceLabel: 'LH1',
            cycleNumber: bearishCycleNumber,
            confirmationReason: 'Bearish reversal confirmed (LH1 locked)',
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          lastConfirmedLL = {
            id: `sp_ll_${symbol}_${discoveryLowestSinceHighTimeUnix}_${cycleId}_V4_rev`,
            symbol,
            timeframe,
            candleOpenTime: discoveryLowestSinceHighTime,
            candleOpenTimeUnix: discoveryLowestSinceHighTimeUnix,
            type: StructurePointType.LL,
            price: discoveryLowestSinceHigh,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: discoveryLowestSinceHighIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: ll1AuditId,
            previousStructurePointId: activeLockedLH.id,
            trendState: StructureState.BEARISH,
            sequenceIndex: 1,
            sequenceLabel: 'LL1',
            cycleNumber: bearishCycleNumber,
            retracementCandles: retraceBars,
            retracementFibDepth: fibRange > 0 ? (bounceHigh - discoveryLowestSinceHigh) / fibRange : 0,
            fibPriceLevel: fibTarget,
            confirmationReason: `Bearish reversal confirmed (LL1 confirmed via ${retraceBars}-candle bounce)`,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          recordAudit({
            eventId: lh1AuditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: 'LH1',
            eventType: 'LH',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.BULLISH_STRUCTURE_BROKEN,
            trendStateAfter: StructureState.BEARISH,
            candleIndex: discoveryHighIndex,
            timestamp: discoveryHighTime,
            timestampUnix: discoveryHighTimeUnix,
            price: discoveryHighPrice,
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
            candidateExtremeType: StructurePointType.LH,
            candidateExtremePrice: discoveryHighPrice,
            candidateExtremeTime: discoveryHighTime,
            candidateExtremeIndex: discoveryHighIndex,
            retracementStartTime: discoveryLowestSinceHighTime,
            retracementExtremePrice: bounceHigh,
            retracementExtremeTime: workingSet[bounceIdx].openTime,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: discoveryLowestSinceHigh,
            fibExtremePrice: discoveryHighPrice,
            fibRequiredRatio: minFib,
            fibRequiredPrice: fibTarget,
            actualRetracementRatio: fibRange > 0 ? (bounceHigh - discoveryLowestSinceHigh) / fibRange : 0,
            fibQualified: true,
            decision: 'LH_LOCKED',
            decisionReason: `Bearish reversal confirmed. Peak LH1 locked at ${discoveryHighPrice.toFixed(2)} as new invalidation anchor.`,
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          recordAudit({
            eventId: ll1AuditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: 'LL1',
            eventType: 'LL',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.BULLISH_STRUCTURE_BROKEN,
            trendStateAfter: StructureState.BEARISH,
            candleIndex: discoveryLowestSinceHighIndex,
            timestamp: discoveryLowestSinceHighTime,
            timestampUnix: discoveryLowestSinceHighTimeUnix,
            price: discoveryLowestSinceHigh,
            previousLockedAnchorType: StructurePointType.LH,
            previousLockedAnchorPrice: discoveryHighPrice,
            previousLockedAnchorTime: discoveryHighTime,
            previousStructuralExtremeType: null,
            previousStructuralExtremePrice: null,
            previousStructuralExtremeTime: null,
            breakRequired: false,
            breakLevel: null,
            breakWasBodyClose: false,
            breakWasWickOnly: false,
            candidateExtremeType: StructurePointType.LL,
            candidateExtremePrice: discoveryLowestSinceHigh,
            candidateExtremeTime: discoveryLowestSinceHighTime,
            candidateExtremeIndex: discoveryLowestSinceHighIndex,
            retracementStartTime: discoveryLowestSinceHighTime,
            retracementExtremePrice: bounceHigh,
            retracementExtremeTime: workingSet[bounceIdx].openTime,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: discoveryLowestSinceHigh,
            fibExtremePrice: discoveryHighPrice,
            fibRequiredRatio: minFib,
            fibRequiredPrice: fibTarget,
            actualRetracementRatio: fibRange > 0 ? (bounceHigh - discoveryLowestSinceHigh) / fibRange : 0,
            fibQualified: true,
            decision: 'LL_CONFIRMED',
            decisionReason: `Bearish reversal confirmed. Low confirmed as LL1 at ${discoveryLowestSinceHigh.toFixed(2)} with ${retraceBars}-candle bounce reaching Fib target.`,
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          addPoint(activeLockedLH);
          addPoint(lastConfirmedLL);
          structureState = StructureState.BEARISH;

          cycles.push({
            cycleId,
            direction: 'BEARISH',
            status: 'CONFIRMED',
            anchorPoint: {
              id: activeLockedLH.id,
              type: activeLockedLH.type,
              price: activeLockedLH.price,
              candleTime: activeLockedLH.candleOpenTime,
              candleTimeUnix: activeLockedLH.candleOpenTimeUnix,
              candleIndex: activeLockedLH.candleIndex,
            },
            expansionExtreme: {
              type: lastConfirmedLL.type,
              price: lastConfirmedLL.price,
              candleIndex: lastConfirmedLL.candleIndex!,
              candleTime: lastConfirmedLL.candleOpenTime,
              candleTimeUnix: lastConfirmedLL.candleOpenTimeUnix,
            },
            startedAt: activeLockedLH.candleOpenTime,
            confirmedAt: candle.openTime,
          });

          // Reset discovery trackers
          discoveryHighPrice = -Infinity;
          discoveryHighIndex = -1;
          discoveryHighTime = '';
          discoveryHighTimeUnix = 0;
          discoveryLowestSinceHigh = Infinity;
          discoveryLowestSinceHighIndex = -1;
          discoveryLowestSinceHighTime = '';
          discoveryLowestSinceHighTimeUnix = 0;

          addEvent(
            candle,
            'TREND_CONFIRMED',
            'Trend Reversal Confirmed → BEARISH (LH1 → LL1)',
            `Locked LH1: ${activeLockedLH.price.toFixed(2)}, LL1: ${lastConfirmedLL.price.toFixed(2)}.`,
            { price: activeLockedLH.price }
          );
        }
      }
    }

    // ==========================================
    // STATE: BEARISH_STRUCTURE_BROKEN (Transition -> Bullish)
    // ==========================================
    if (structureState === StructureState.BEARISH_STRUCTURE_BROKEN) {
      // Market needs a confirmed HL -> HH cycle to transition to BULLISH
      if (candle.low < discoveryLowPrice || discoveryLowIndex === -1) {
        discoveryLowPrice = candle.low;
        discoveryLowIndex = i;
        discoveryLowTime = candle.openTime;
        discoveryLowTimeUnix = candle.openTimeUnix;
        discoveryHighestSinceLow = candle.high;
        discoveryHighestSinceLowIndex = i;
        discoveryHighestSinceLowTime = candle.openTime;
        discoveryHighestSinceLowTimeUnix = candle.openTimeUnix;
      } else if (candle.high > discoveryHighestSinceLow) {
        discoveryHighestSinceLow = candle.high;
        discoveryHighestSinceLowIndex = i;
        discoveryHighestSinceLowTime = candle.openTime;
        discoveryHighestSinceLowTimeUnix = candle.openTimeUnix;
      }

      if (discoveryHighestSinceLowIndex > discoveryLowIndex) {
        let pullLow = Infinity;
        let pullIdx = -1;
        for (let b = discoveryHighestSinceLowIndex; b <= i; b++) {
          if (workingSet[b].low < pullLow) {
            pullLow = workingSet[b].low;
            pullIdx = b;
          }
        }

        const retraceBars = pullIdx - discoveryHighestSinceLowIndex;
        const fibRange = discoveryHighestSinceLow - discoveryLowPrice;
        const fibTarget = discoveryHighestSinceLow - minFib * fibRange;

        if (retraceBars >= minCandles && pullLow <= fibTarget && fibRange > 0) {
          bullishCycleNumber = cycles.filter((c) => c.direction === 'BULLISH').length + 1;
          const cycleId = `cycle_bull_${bullishCycleNumber}`;
          regimeCounter += 1;
          currentRegimeId = `regime_bull_${regimeCounter}_${symbol}_${discoveryLowTimeUnix}`;
          regimes.push({
            regimeId: currentRegimeId,
            direction: 'BULLISH',
            startedAt: discoveryLowTime,
            startedAtUnix: discoveryLowTimeUnix,
            startReason: 'REVERSAL_CONFIRMED',
          });

          const hl1AuditId = `audit_hl_${symbol}_${discoveryLowTimeUnix}_${currentRegimeId}_rev`;
          const hh1AuditId = `audit_hh_${symbol}_${discoveryHighestSinceLowTimeUnix}_${currentRegimeId}_rev`;

          activeLockedHL = {
            id: `sp_hl_${symbol}_${discoveryLowTimeUnix}_${cycleId}_V4_rev`,
            symbol,
            timeframe,
            candleOpenTime: discoveryLowTime,
            candleOpenTimeUnix: discoveryLowTimeUnix,
            type: StructurePointType.HL,
            price: discoveryLowPrice,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: discoveryLowIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: hl1AuditId,
            trendState: StructureState.BULLISH,
            sequenceIndex: 1,
            sequenceLabel: 'HL1',
            cycleNumber: bullishCycleNumber,
            confirmationReason: 'Bullish reversal confirmed (HL1 locked)',
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          lastConfirmedHH = {
            id: `sp_hh_${symbol}_${discoveryHighestSinceLowTimeUnix}_${cycleId}_V4_rev`,
            symbol,
            timeframe,
            candleOpenTime: discoveryHighestSinceLowTime,
            candleOpenTimeUnix: discoveryHighestSinceLowTimeUnix,
            type: StructurePointType.HH,
            price: discoveryHighestSinceLow,
            strength: StructureStrength.MAJOR,
            algorithmVersion: ALGORITHM_VERSION_V4,
            candleIndex: discoveryHighestSinceLowIndex,
            regimeId: currentRegimeId,
            cycleId,
            auditId: hh1AuditId,
            previousStructurePointId: activeLockedHL.id,
            trendState: StructureState.BULLISH,
            sequenceIndex: 1,
            sequenceLabel: 'HH1',
            cycleNumber: bullishCycleNumber,
            retracementCandles: retraceBars,
            retracementFibDepth: fibRange > 0 ? (discoveryHighestSinceLow - pullLow) / fibRange : 0,
            fibPriceLevel: fibTarget,
            confirmationReason: `Bullish reversal confirmed (HH1 confirmed via ${retraceBars}-candle pullback)`,
            detectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          recordAudit({
            eventId: hl1AuditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: 'HL1',
            eventType: 'HL',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.BEARISH_STRUCTURE_BROKEN,
            trendStateAfter: StructureState.BULLISH,
            candleIndex: discoveryLowIndex,
            timestamp: discoveryLowTime,
            timestampUnix: discoveryLowTimeUnix,
            price: discoveryLowPrice,
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
            candidateExtremeType: StructurePointType.HL,
            candidateExtremePrice: discoveryLowPrice,
            candidateExtremeTime: discoveryLowTime,
            candidateExtremeIndex: discoveryLowIndex,
            retracementStartTime: discoveryHighestSinceLowTime,
            retracementExtremePrice: pullLow,
            retracementExtremeTime: workingSet[pullIdx].openTime,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: discoveryLowPrice,
            fibExtremePrice: discoveryHighestSinceLow,
            fibRequiredRatio: minFib,
            fibRequiredPrice: fibTarget,
            actualRetracementRatio: fibRange > 0 ? (discoveryHighestSinceLow - pullLow) / fibRange : 0,
            fibQualified: true,
            decision: 'HL_LOCKED',
            decisionReason: `Bullish reversal confirmed. Trough HL1 locked at ${discoveryLowPrice.toFixed(2)} as new invalidation anchor.`,
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          recordAudit({
            eventId: hh1AuditId,
            regimeId: currentRegimeId,
            cycleId,
            sequenceId: 'HH1',
            eventType: 'HH',
            status: 'CONFIRMED',
            trendStateBefore: StructureState.BEARISH_STRUCTURE_BROKEN,
            trendStateAfter: StructureState.BULLISH,
            candleIndex: discoveryHighestSinceLowIndex,
            timestamp: discoveryHighestSinceLowTime,
            timestampUnix: discoveryHighestSinceLowTimeUnix,
            price: discoveryHighestSinceLow,
            previousLockedAnchorType: StructurePointType.HL,
            previousLockedAnchorPrice: discoveryLowPrice,
            previousLockedAnchorTime: discoveryLowTime,
            previousStructuralExtremeType: null,
            previousStructuralExtremePrice: null,
            previousStructuralExtremeTime: null,
            breakRequired: false,
            breakLevel: null,
            breakWasBodyClose: false,
            breakWasWickOnly: false,
            candidateExtremeType: StructurePointType.HH,
            candidateExtremePrice: discoveryHighestSinceLow,
            candidateExtremeTime: discoveryHighestSinceLowTime,
            candidateExtremeIndex: discoveryHighestSinceLowIndex,
            retracementStartTime: discoveryHighestSinceLowTime,
            retracementExtremePrice: pullLow,
            retracementExtremeTime: workingSet[pullIdx].openTime,
            retracementCandleCount: retraceBars,
            requiredRetracementCandles: minCandles,
            candleCountQualified: true,
            fibAnchorPrice: discoveryLowPrice,
            fibExtremePrice: discoveryHighestSinceLow,
            fibRequiredRatio: minFib,
            fibRequiredPrice: fibTarget,
            actualRetracementRatio: fibRange > 0 ? (discoveryHighestSinceLow - pullLow) / fibRange : 0,
            fibQualified: true,
            decision: 'HH_CONFIRMED',
            decisionReason: `Bullish reversal confirmed. High confirmed as HH1 at ${discoveryHighestSinceLow.toFixed(2)} with ${retraceBars}-candle pullback reaching Fib target.`,
            algorithmVersion: ALGORITHM_VERSION_V4,
          });

          addPoint(activeLockedHL);
          addPoint(lastConfirmedHH);
          structureState = StructureState.BULLISH;

          cycles.push({
            cycleId,
            direction: 'BULLISH',
            status: 'CONFIRMED',
            anchorPoint: {
              id: activeLockedHL.id,
              type: activeLockedHL.type,
              price: activeLockedHL.price,
              candleTime: activeLockedHL.candleOpenTime,
              candleTimeUnix: activeLockedHL.candleOpenTimeUnix,
              candleIndex: activeLockedHL.candleIndex,
            },
            expansionExtreme: {
              type: lastConfirmedHH.type,
              price: lastConfirmedHH.price,
              candleIndex: lastConfirmedHH.candleIndex!,
              candleTime: lastConfirmedHH.candleOpenTime,
              candleTimeUnix: lastConfirmedHH.candleOpenTimeUnix,
            },
            startedAt: activeLockedHL.candleOpenTime,
            confirmedAt: candle.openTime,
          });

          // Reset discovery trackers
          discoveryLowPrice = Infinity;
          discoveryLowIndex = -1;
          discoveryLowTime = '';
          discoveryLowTimeUnix = 0;
          discoveryHighestSinceLow = -Infinity;
          discoveryHighestSinceLowIndex = -1;
          discoveryHighestSinceLowTime = '';
          discoveryHighestSinceLowTimeUnix = 0;

          addEvent(
            candle,
            'TREND_CONFIRMED',
            'Trend Reversal Confirmed → BULLISH (HL1 → HH1)',
            `Locked HL1: ${activeLockedHL.price.toFixed(2)}, HH1: ${lastConfirmedHH.price.toFixed(2)}.`,
            { price: activeLockedHL.price }
          );
        }
      }
    }

    // Capture Candle Replay Step for deterministic audit inspection
    const lastBreak = structureBreakEvents[structureBreakEvents.length - 1];
    const breakThisCandle = lastBreak && lastBreak.candleTimeUnix === candle.openTimeUnix ? lastBreak.breakType : null;
    const lastPt = points[points.length - 1];
    const confirmedPointThisCandle = lastPt && lastPt.candleOpenTimeUnix === candle.openTimeUnix ? (lastPt.sequenceLabel || lastPt.type) : null;

    candleReplaySteps.push({
      candleIndex: i,
      time: candle.openTime,
      timeUnix: candle.openTimeUnix,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      trendState: structureState,
      regimeId: currentRegimeId,
      activeLockedAnchor: activeLockedHL
        ? { type: 'HL', price: activeLockedHL.price, time: activeLockedHL.candleOpenTime }
        : activeLockedLH
        ? { type: 'LH', price: activeLockedLH.price, time: activeLockedLH.candleOpenTime }
        : null,
      activeExtreme: lastConfirmedHH
        ? { type: 'HH', price: lastConfirmedHH.price, time: lastConfirmedHH.candleOpenTime }
        : lastConfirmedLL
        ? { type: 'LL', price: lastConfirmedLL.price, time: lastConfirmedLL.candleOpenTime }
        : null,
      candidate: candidateType && candidatePrice > 0
        ? {
            type: candidateType,
            price: candidatePrice,
            retracementBars: candidateType === StructurePointType.PROVISIONAL_HH
              ? (lowestLowIndex >= candidateCandleIndex ? lowestLowIndex - candidateCandleIndex : 0)
              : (highestHighIndex >= candidateCandleIndex ? highestHighIndex - candidateCandleIndex : 0),
            currentFibDepth: candidateType === StructurePointType.PROVISIONAL_HH
              ? (candidatePrice - referencePrice > 0 ? (candidatePrice - lowestLowSinceCandidate) / (candidatePrice - referencePrice) : 0)
              : (referencePrice - candidatePrice > 0 ? (highestHighSinceCandidate - candidatePrice) / (referencePrice - candidatePrice) : 0),
          }
        : null,
      confirmedPointCreatedThisCandle: confirmedPointThisCandle,
      structureBreakThisCandle: breakThisCandle,
    });
  }

  // Build active retracement diagnostics
  let activeRetracement: ActiveRetracementInfo | null = null;
  let activeProvisionalPoint: StructurePoint | null = null;

  if (candidateType === StructurePointType.PROVISIONAL_HH && candidatePrice > 0) {
    const range = candidatePrice - referencePrice;
    const fibTarget = candidatePrice - minFib * range;
    const retraceBars =
      lowestLowIndex >= candidateCandleIndex ? lowestLowIndex - candidateCandleIndex : 0;
    const depth = range > 0 ? (candidatePrice - lowestLowSinceCandidate) / range : 0;

    activeProvisionalPoint = {
      id: `sp_phh_${symbol}_${candidateCandleTimeUnix}`,
      symbol,
      timeframe,
      candleOpenTime: candidateCandleTime,
      candleOpenTimeUnix: candidateCandleTimeUnix,
      type: StructurePointType.PROVISIONAL_HH,
      price: candidatePrice,
      strength: StructureStrength.MINOR,
      algorithmVersion: ALGORITHM_VERSION_V4,
      candleIndex: candidateCandleIndex,
      isProvisional: true,
      retracementCandles: retraceBars,
      retracementFibDepth: depth,
      fibPriceLevel: fibTarget,
      detectedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    activeRetracement = {
      state: structureState,
      candidateType,
      candidatePrice,
      candidateTime: candidateCandleTime,
      candidateTimeUnix: candidateCandleTimeUnix,
      candidateCandleIndex,
      referencePrice,
      referenceTime,
      fibLevelPrice: fibTarget,
      fibRatio: minFib,
      currentRetracementCandles: retraceBars,
      requiredCandles: minCandles,
      currentFibDepth: depth,
      requiredFib: minFib,
      currentRetracementExtremePrice: lowestLowSinceCandidate < Infinity ? lowestLowSinceCandidate : null,
      currentRetracementExtremeTime: lowestLowTime || null,
      currentRetracementExtremeIndex: lowestLowIndex >= 0 ? lowestLowIndex : null,
      retracementQualified: retraceBars >= minCandles && lowestLowSinceCandidate <= fibTarget,
    };
  } else if (candidateType === StructurePointType.PROVISIONAL_LL && candidatePrice > 0) {
    const range = referencePrice - candidatePrice;
    const fibTarget = candidatePrice + minFib * range;
    const retraceBars =
      highestHighIndex >= candidateCandleIndex ? highestHighIndex - candidateCandleIndex : 0;
    const depth = range > 0 ? (highestHighSinceCandidate - candidatePrice) / range : 0;

    activeProvisionalPoint = {
      id: `sp_pll_${symbol}_${candidateCandleTimeUnix}`,
      symbol,
      timeframe,
      candleOpenTime: candidateCandleTime,
      candleOpenTimeUnix: candidateCandleTimeUnix,
      type: StructurePointType.PROVISIONAL_LL,
      price: candidatePrice,
      strength: StructureStrength.MINOR,
      algorithmVersion: ALGORITHM_VERSION_V4,
      candleIndex: candidateCandleIndex,
      isProvisional: true,
      retracementCandles: retraceBars,
      retracementFibDepth: depth,
      fibPriceLevel: fibTarget,
      detectedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    activeRetracement = {
      state: structureState,
      candidateType,
      candidatePrice,
      candidateTime: candidateCandleTime,
      candidateTimeUnix: candidateCandleTimeUnix,
      candidateCandleIndex,
      referencePrice,
      referenceTime,
      fibLevelPrice: fibTarget,
      fibRatio: minFib,
      currentRetracementCandles: retraceBars,
      requiredCandles: minCandles,
      currentFibDepth: depth,
      requiredFib: minFib,
      currentRetracementExtremePrice:
        highestHighSinceCandidate > -Infinity ? highestHighSinceCandidate : null,
      currentRetracementExtremeTime: highestHighTime || null,
      currentRetracementExtremeIndex: highestHighIndex >= 0 ? highestHighIndex : null,
      retracementQualified: retraceBars >= minCandles && highestHighSinceCandidate >= fibTarget,
    };
  }

  // State label
  let stateLabel = 'Undefined Market Structure';
  if (structureState === StructureState.BULLISH) {
    stateLabel = 'Bullish Market Structure (Locked HL)';
  } else if (structureState === StructureState.BEARISH) {
    stateLabel = 'Bearish Market Structure (Locked LH)';
  } else if (structureState === StructureState.BULLISH_STRUCTURE_BROKEN) {
    stateLabel = 'Transition → Bearish (Bullish Structure Broken)';
  } else if (structureState === StructureState.BEARISH_STRUCTURE_BROKEN) {
    stateLabel = 'Transition → Bullish (Bearish Structure Broken)';
  }

  // Count structure points
  let hhCount = 0;
  let hlCount = 0;
  let llCount = 0;
  let lhCount = 0;
  points.forEach((p) => {
    if (p.type === StructurePointType.HH) hhCount++;
    if (p.type === StructurePointType.HL) hlCount++;
    if (p.type === StructurePointType.LL) llCount++;
    if (p.type === StructurePointType.LH) lhCount++;
  });

  // Deduplicate points by unique ID and sort chronologically
  const seenPointIds = new Set<string>();
  const uniquePoints: StructurePoint[] = [];
  for (const pt of points) {
    if (!seenPointIds.has(pt.id)) {
      seenPointIds.add(pt.id);
      uniquePoints.push(pt);
    }
  }
  points.length = 0;
  points.push(...uniquePoints);
  points.sort((a, b) => a.candleOpenTimeUnix - b.candleOpenTimeUnix);

  // If user requested provisional structure to be included
  const finalPoints = [...points];
  if (params.showProvisionalStructure && activeProvisionalPoint) {
    if (!seenPointIds.has(activeProvisionalPoint.id)) {
      finalPoints.push(activeProvisionalPoint);
    }
    finalPoints.sort((a, b) => a.candleOpenTimeUnix - b.candleOpenTimeUnix);
  }

  let legacyPoints: StructurePoint[] | undefined;
  if (params.legacyPivotOverlay) {
    legacyPoints = detectLegacyPivots(workingSet, params);
  }

  return {
    symbol,
    timeframe,
    algorithmVersion: ALGORITHM_VERSION_V4,
    parameters: params,
    structureState,
    stateLabel,
    totalCandlesAvailable,
    closedCandlesEvaluated: workingSet.length,
    unclosedCandleExcluded,
    workingWindowStart: workingSet[0]?.openTime || null,
    workingWindowEnd: workingSet[workingSet.length - 1]?.openTime || null,

    analysisCandles,
    initializationSearchCandles,
    initialization: initResult,
    structureBreakEvents,

    hhCount,
    hlCount,
    llCount,
    lhCount,
    provisionalCount: activeProvisionalPoint ? 1 : 0,
    totalPointsCount: points.length,

    lastHH: lastConfirmedHH,
    lastHL: activeLockedHL,
    lastLL: lastConfirmedLL,
    lastLH: activeLockedLH,
    lastConfirmedHH,
    lastConfirmedHL: activeLockedHL,
    lastConfirmedLL,
    lastConfirmedLH: activeLockedLH,
    activeProvisionalPoint,

    cycles,
    activeCycle: cycles[cycles.length - 1] || null,
    showProvisionalStructure: params.showProvisionalStructure,

    activeRetracement,
    points: finalPoints,
    legacyPoints,
    eventLogs,

    audits,
    rejectedEvents,
    candleReplaySteps,
    currentRegimeId,
    regimes,

    executionTimeMs: Date.now() - startTime,
    detectedAt: new Date().toISOString(),
  };
}

function detectLegacyPivots(
  candles: NormalizedMarketCandle[],
  params: StructureParameters
): StructurePoint[] {
  const left = params.pivotLeftBars ?? 2;
  const right = params.pivotRightBars ?? 2;
  const legacy: StructurePoint[] = [];

  for (let i = left; i < candles.length - right; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let l = 1; l <= left; l++) {
      if (candles[i - l].high >= c.high) isHigh = false;
      if (candles[i - l].low <= c.low) isLow = false;
    }
    for (let r = 1; r <= right; r++) {
      if (candles[i + r].high >= c.high) isHigh = false;
      if (candles[i + r].low <= c.low) isLow = false;
    }

    if (isHigh) {
      legacy.push({
        id: `leg_sh_${c.openTimeUnix}`,
        symbol: c.symbol,
        timeframe: c.timeframe,
        candleOpenTime: c.openTime,
        candleOpenTimeUnix: c.openTimeUnix,
        type: StructurePointType.SWING_HIGH,
        price: c.high,
        strength: StructureStrength.MINOR,
        algorithmVersion: 'LEGACY_PIVOT_V1',
        candleIndex: i,
        detectedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    }
    if (isLow) {
      legacy.push({
        id: `leg_sl_${c.openTimeUnix}`,
        symbol: c.symbol,
        timeframe: c.timeframe,
        candleOpenTime: c.openTime,
        candleOpenTimeUnix: c.openTimeUnix,
        type: StructurePointType.SWING_LOW,
        price: c.low,
        strength: StructureStrength.MINOR,
        algorithmVersion: 'LEGACY_PIVOT_V1',
        candleIndex: i,
        detectedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    }
  }

  return legacy;
}
