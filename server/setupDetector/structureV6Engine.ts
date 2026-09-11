import { NormalizedMarketCandle } from '../marketData/mexcPublicMarketClient';
import {
  ActiveRetracementInfo,
  ALGORITHM_VERSION_V6_REV3,
  BullishRange,
  BearishRange,
  createBearishRange,
  createBullishRange,
  InitializationStructureResult,
  StructureBreakEvent,
  StructureDetectionResult,
  StructureEventLogItem,
  StructureParameters,
  StructurePoint,
  StructurePointType,
  StructureState,
  StructureStrength,
  StructuralRange,
  TypedStructuralAnchor,
  assertSingleStructureType,
} from './structureTypes';
import {
  CandleReplayStep,
  EngineStateSnapshot,
  RejectedStructureEvent,
  StructureDecisionAudit,
} from './structureAuditTypes';

export type V6EngineState =
  | 'UNINITIALIZED'
  | 'RANGE_LOCKED_BULLISH'
  | 'RANGE_LOCKED_BEARISH'
  | 'EXPANDING_BULLISH'
  | 'RETRACING_BULLISH'
  | 'EXPANDING_BEARISH'
  | 'RETRACING_BEARISH';

type Direction = 'BULLISH' | 'BEARISH';

interface Extreme {
  price: number;
  candle: NormalizedMarketCandle;
  index: number;
}

interface CandidateLeg {
  direction: Direction;
  anchor: TypedStructuralAnchor<StructurePointType>;
  breakEvent: StructureBreakEvent;
  breakCandle: NormalizedMarketCandle;
  extreme: Extreme;
  retracement: Extreme | null;
  retracementCandles: number;
  qualificationReachedAtIndex: number | null;
  resumptionLevel: number | null;
}

interface ProposedTransition {
  previousRange: StructuralRange;
  breakEvent: StructureBreakEvent;
  candidateExtreme: Extreme;
  retracementExtreme: Extreme;
  proposedPoints: [StructurePoint, StructurePoint];
  proposedRange: BullishRange | BearishRange;
  nextState: 'RANGE_LOCKED_BULLISH' | 'RANGE_LOCKED_BEARISH';
  retracementCandles: number;
  fibDepth: number;
  fibRequiredPrice: number;
  requiredRetracementCandles: number;
  requiredRetracementFib: number;
}

interface InitializationCandidate {
  direction: Direction;
  extreme: Extreme;
  retracement: Extreme;
  anchorPrice: number;
  confirmationIndex: number;
  retracementCandles: number;
  fibDepth: number;
}

/**
 * Authoritative external market-structure engine.
 *
 * Breaks are close-only. Fibonacci qualification is wick-based. A qualified
 * transition is validated and committed as one immutable HH/HL or LL/LH pair.
 */
export function detectStructureV6FibQualifiedRange(
  allCandles: NormalizedMarketCandle[],
  customParams?: Partial<StructureParameters>
): StructureDetectionResult {
  const started = Date.now();
  const algorithmVersion = customParams?.algorithmVersion ?? ALGORITHM_VERSION_V6_REV3;
  const analysisCandles = clamp(customParams?.analysisCandles ?? 280, 50, 1000);
  const warmUpCandles = clamp(
    customParams?.initializationSearchCandles ?? customParams?.warmUpCandles ?? 70,
    0,
    200
  );
  const minimumRetracementCandles = clamp(customParams?.minimumRetracementCandles ?? 4, 1, 20);
  const minimumRetracementFib = clamp(customParams?.minimumRetracementFib ?? 0.382, 0.1, 1);
  const lookback = analysisCandles + warmUpCandles;
  const totalCandlesAvailable = allCandles.length;
  const unclosedCandleExcluded = allCandles.some((c) => c.isClosed === false);
  const closed = allCandles.filter((c) => c.isClosed === true);
  const candles = closed.slice(Math.max(0, closed.length - lookback));
  const symbol = candles[0]?.symbol ?? allCandles[0]?.symbol ?? 'UNKNOWN';
  const timeframe = candles[0]?.timeframe ?? allCandles[0]?.timeframe ?? '5M';
  const parameters: StructureParameters = {
    analysisCandles,
    initializationSearchCandles: warmUpCandles,
    minimumRetracementCandles,
    minimumRetracementFib,
    breakConfirmation: 'CLOSE',
    fibTouchMode: 'WICK',
    lookbackCandles: lookback,
    algorithmVersion,
    legacyPivotOverlay: false,
    showSequenceNumbers: customParams?.showSequenceNumbers ?? true,
    manualStart: customParams?.manualStart,
  };

  if (candles.length < 2) {
    return emptyResult(started, symbol, timeframe, algorithmVersion, parameters, totalCandlesAvailable, unclosedCandleExcluded);
  }

  const points: StructurePoint[] = [];
  const ranges: StructuralRange[] = [];
  const breakEvents: StructureBreakEvent[] = [];
  const eventLogs: StructureEventLogItem[] = [];
  const audits: StructureDecisionAudit[] = [];
  const rejectedEvents: RejectedStructureEvent[] = [];
  const candleReplaySteps: CandleReplayStep[] = [];
  let engineState: V6EngineState = 'UNINITIALIZED';
  let activeRange: StructuralRange | null = null;
  let candidate: CandidateLeg | null = null;
  let sequence = 0;
  let loopStart = 0;
  const warmUpCount = Math.min(warmUpCandles, candles.length);
  const initializationLogs: string[] = [];

  if (customParams?.manualStart) {
    sequence = 1;
    const seed = seedManualRange(customParams.manualStart, candles, symbol, timeframe, algorithmVersion, sequence);
    activeRange = seed.range;
    points.push(...seed.points);
    ranges.push(seed.range);
    engineState = seed.range.direction === 'BULLISH' ? 'RANGE_LOCKED_BULLISH' : 'RANGE_LOCKED_BEARISH';
    loopStart = Math.max(0, Math.max(seed.range.top.candleIndex ?? 0, seed.range.bottom.candleIndex ?? 0) + 1);
    initializationLogs.push(`Manual ${seed.range.direction} range accepted.`);
  } else {
    const initialization = findNearestQualifiedWarmUpCycle(
      candles.slice(0, warmUpCount),
      minimumRetracementCandles,
      minimumRetracementFib
    );
    if (initialization) {
      sequence = 1;
      const seed = createQualifiedPair(
        initialization.direction,
        initialization.extreme,
        initialization.retracement,
        symbol,
        timeframe,
        algorithmVersion,
        sequence,
        initialization.retracementCandles,
        initialization.fibDepth,
        true
      );
      activeRange = seed.range;
      points.push(...seed.points);
      ranges.push(seed.range);
      engineState = initialization.direction === 'BULLISH' ? 'RANGE_LOCKED_BULLISH' : 'RANGE_LOCKED_BEARISH';
      loopStart = initialization.confirmationIndex + 1;
      initializationLogs.push(`Nearest qualified ${initialization.direction} warm-up cycle confirmed.`);
    } else {
      loopStart = warmUpCount;
      initializationLogs.push('No qualified prior cycle found; engine remains UNINITIALIZED.');
    }
  }

  const initialization: InitializationStructureResult = {
    initialState: toPublicState(engineState),
    initialSequence: activeRange?.direction === 'BULLISH' ? 'HL → HH' : activeRange ? 'LH → LL' : 'NONE',
    warmUpCandlesUsed: customParams?.manualStart ? 0 : warmUpCount,
    warmUpCandlesMax: warmUpCandles,
    initialFoundAt: activeRange?.top.candleTime ?? null,
    initialFoundTimeUnix: activeRange?.top.candleTimeUnix ?? null,
    initialLH: activeRange?.direction === 'BEARISH' ? activeRange.top.price : null,
    initialLL: activeRange?.direction === 'BEARISH' ? activeRange.bottom.price : null,
    initialHH: activeRange?.direction === 'BULLISH' ? activeRange.top.price : null,
    initialHL: activeRange?.direction === 'BULLISH' ? activeRange.bottom.price : null,
    warmUpStartIndex: 0,
    mainAnalysisStartIndex: warmUpCount,
    mainAnalysisStartTime: candles[warmUpCount]?.openTime ?? null,
    initializationLogs,
    usedWarmUp: !customParams?.manualStart && !!activeRange,
    initialTrend: toPublicState(engineState),
    candlesEvaluated: candles.length,
    warmUpCandlesCount: warmUpCount,
  };

  for (let i = 0; i < loopStart && i < candles.length; i++) {
    recordReplay(candleReplaySteps, i, candles[i], engineState, activeRange, ['Warm-up evaluation.'], null, null);
  }

  for (let i = loopStart; i < candles.length; i++) {
    const candle = candles[i];
    const trace: string[] = [];
    let breakThisCandle: string | null = null;
    let confirmedThisCandle: string | null = null;

    if (engineState === 'UNINITIALIZED') {
      trace.push('No qualified seed range; external structure is undefined.');
      recordReplay(candleReplaySteps, i, candle, engineState, null, trace, null, null);
      continue;
    }

    if (engineState === 'RANGE_LOCKED_BULLISH' || engineState === 'RANGE_LOCKED_BEARISH') {
      if (!activeRange || activeRange.status !== 'ACTIVE') {
        throw new Error('V6 invariant failure: locked state requires exactly one active range.');
      }
      const breakResult = detectBreak(activeRange, candle, i, rejectedEvents);
      if (breakResult) {
        candidate = breakResult.candidate;
        breakEvents.push(breakResult.event);
        breakThisCandle = breakResult.event.id ?? null;
        engineState = candidate.direction === 'BULLISH' ? 'EXPANDING_BULLISH' : 'EXPANDING_BEARISH';
        trace.push(`${breakResult.event.breakType}: closed at ${candle.close}.`);
        eventLogs.push(logItem(candle, 'STRUCTURE_BROKEN', 'Body-close structure break', trace[trace.length - 1]));
      } else {
        trace.push('Internal price action ignored inside the active external range.');
      }
    } else {
      if (!candidate || !activeRange) {
        throw new Error('V6 invariant failure: expansion/retracement state requires a candidate and range.');
      }
      const extended = extendCandidate(candidate, candle, i);
      if (extended) {
        engineState = candidate.direction === 'BULLISH' ? 'EXPANDING_BULLISH' : 'EXPANDING_BEARISH';
        trace.push(`Same-leg ${candidate.direction} extreme extended to ${candidate.extreme.price}.`);
        eventLogs.push(logItem(candle, 'LEG_EXTENDED', 'Candidate extended', trace[trace.length - 1]));
      } else {
        const retracementExtended = updateRetracement(candidate, candle, i);
        if (retracementExtended) {
          candidate.qualificationReachedAtIndex = null;
          candidate.resumptionLevel = candidate.direction === 'BULLISH' ? candle.high : candle.low;
        }
        engineState = candidate.direction === 'BULLISH' ? 'RETRACING_BULLISH' : 'RETRACING_BEARISH';
        const qualification = qualify(candidate, minimumRetracementCandles, minimumRetracementFib);
        trace.push(
          `Retracement ${qualification.candleCount}/${minimumRetracementCandles} candles, ${(qualification.fibDepth * 100).toFixed(1)}%/${(minimumRetracementFib * 100).toFixed(1)}% Fib.`
        );
        const fullyQualified = qualification.candleQualified && qualification.fibQualified;
        if (fullyQualified && candidate.qualificationReachedAtIndex === null) {
          candidate.qualificationReachedAtIndex = i;
          trace.push('Retracement gates satisfied; waiting for body-close resumption before locking the new external range.');
        }
        const resumed = candidate.resumptionLevel !== null
          && candidate.qualificationReachedAtIndex !== null
          && i > candidate.qualificationReachedAtIndex
          && (candidate.direction === 'BULLISH'
            ? candle.close > candidate.resumptionLevel
            : candle.close < candidate.resumptionLevel);
        if (fullyQualified && resumed && candidate.retracement) {
          const proposed = proposeTransition(
            activeRange,
            candidate,
            candidate.retracement,
            symbol,
            timeframe,
            algorithmVersion,
            sequence + 1,
            qualification
          );
          validateTransition(proposed, candle, symbol, timeframe, ranges);

          // Atomic commit: all derived values were validated before shared state changes.
          const brokenPrevious: StructuralRange = {
            ...proposed.previousRange,
            status: proposed.breakEvent.breakType.includes('STRUCTURE_BROKEN') ? 'BROKEN_REVERSAL' : 'BROKEN_CONTINUATION',
            endedAt: proposed.breakEvent.candleTime,
            endedAtUnix: proposed.breakEvent.candleTimeUnix,
            breakEventId: proposed.breakEvent.id,
            breakCandleTime: proposed.breakEvent.candleTime,
            breakCandleClose: proposed.breakEvent.price,
          };
          const previousIndex = ranges.findIndex((range) => range.rangeId === proposed.previousRange.rangeId);
          if (previousIndex >= 0) ranges[previousIndex] = brokenPrevious;
          points.push(...proposed.proposedPoints);
          ranges.push(proposed.proposedRange);
          activeRange = proposed.proposedRange;
          engineState = proposed.nextState;
          sequence++;
          audits.push(...createAudits(proposed, algorithmVersion));
          confirmedThisCandle = proposed.proposedPoints[0].id;
          eventLogs.push(logItem(candle, 'STRUCTURE_CONFIRMED', `${candidate.direction} cycle confirmed`, trace[trace.length - 1]));
          trace.push(`Committed ${proposed.proposedPoints.map((point) => point.type).join('+')} atomically.`);
          candidate = null;
        }
      }
    }

    recordReplay(candleReplaySteps, i, candle, engineState, activeRange, trace, breakThisCandle, confirmedThisCandle);
  }

  validateFinalState(points, ranges, activeRange, engineState);
  const activeRetracement = candidate
    ? buildActiveRetracement(candidate, activeRange, minimumRetracementCandles, minimumRetracementFib)
    : null;
  const byType = (type: StructurePointType) => points.filter((point) => point.type === type);
  const hh = byType(StructurePointType.HH);
  const hl = byType(StructurePointType.HL);
  const lh = byType(StructurePointType.LH);
  const ll = byType(StructurePointType.LL);

  return {
    symbol,
    timeframe,
    algorithmVersion,
    parameters,
    structureState: activeRange?.direction === 'BULLISH' ? StructureState.BULLISH : activeRange ? StructureState.BEARISH : StructureState.UNDEFINED,
    stateLabel: engineState,
    totalCandlesAvailable,
    closedCandlesEvaluated: candles.length,
    unclosedCandleExcluded,
    workingWindowStart: candles[0]?.openTime ?? null,
    workingWindowEnd: candles[candles.length - 1]?.openTime ?? null,
    hhCount: hh.length,
    hlCount: hl.length,
    lhCount: lh.length,
    llCount: ll.length,
    provisionalCount: 0,
    totalPointsCount: points.length,
    lastHH: hh.at(-1) ?? null,
    lastHL: hl.at(-1) ?? null,
    lastLH: lh.at(-1) ?? null,
    lastLL: ll.at(-1) ?? null,
    lastConfirmedHH: hh.at(-1) ?? null,
    lastConfirmedHL: hl.at(-1) ?? null,
    lastConfirmedLH: lh.at(-1) ?? null,
    lastConfirmedLL: ll.at(-1) ?? null,
    activeProvisionalPoint: null,
    activeRetracement,
    points,
    ranges,
    activeRange,
    internalStructureIgnored: true,
    structureBreakEvents: breakEvents,
    eventLogs,
    audits,
    rejectedEvents,
    candleReplaySteps,
    engineState: candleReplaySteps.at(-1)?.engineState,
    executionTimeMs: Date.now() - started,
    detectedAt: new Date().toISOString(),
    initialization,
  };
}

function findNearestQualifiedWarmUpCycle(
  candles: NormalizedMarketCandle[],
  minimumCandles: number,
  minimumFib: number
): InitializationCandidate | null {
  const completed: InitializationCandidate[] = [];
  for (let breakIndex = 1; breakIndex < candles.length; breakIndex++) {
    const prior = candles.slice(0, breakIndex);
    const priorHigh = Math.max(...prior.map((c) => c.high));
    const priorLow = Math.min(...prior.map((c) => c.low));
    const direction: Direction | null = candles[breakIndex].close > priorHigh
      ? 'BULLISH'
      : candles[breakIndex].close < priorLow
        ? 'BEARISH'
        : null;
    if (!direction) continue;

    const anchorPrice = direction === 'BULLISH' ? priorLow : priorHigh;
    let extreme: Extreme = { price: direction === 'BULLISH' ? candles[breakIndex].high : candles[breakIndex].low, candle: candles[breakIndex], index: breakIndex };
    let retracement: Extreme | null = null;
    let qualificationReachedAtIndex: number | null = null;
    let resumptionLevel: number | null = null;
    for (let i = breakIndex + 1; i < candles.length; i++) {
      const candle = candles[i];
      const isExtension = direction === 'BULLISH' ? candle.high > extreme.price : candle.low < extreme.price;
      if (isExtension) {
        extreme = { price: direction === 'BULLISH' ? candle.high : candle.low, candle, index: i };
        retracement = null;
        qualificationReachedAtIndex = null;
        resumptionLevel = null;
        continue;
      }
      if (!retracement || (direction === 'BULLISH' ? candle.low < retracement.price : candle.high > retracement.price)) {
        retracement = { price: direction === 'BULLISH' ? candle.low : candle.high, candle, index: i };
        qualificationReachedAtIndex = null;
        resumptionLevel = direction === 'BULLISH' ? candle.high : candle.low;
      }
      const count = i - extreme.index;
      const range = Math.abs(extreme.price - anchorPrice);
      const depth = range > 0
        ? direction === 'BULLISH'
          ? (extreme.price - retracement.price) / range
          : (retracement.price - extreme.price) / range
        : 0;
      const fullyQualified = count >= minimumCandles && depth >= minimumFib;
      if (fullyQualified && qualificationReachedAtIndex === null) {
        qualificationReachedAtIndex = i;
      }
      const resumed = resumptionLevel !== null
        && qualificationReachedAtIndex !== null
        && i > qualificationReachedAtIndex
        && (direction === 'BULLISH' ? candle.close > resumptionLevel : candle.close < resumptionLevel);
      if (fullyQualified && resumed) {
        completed.push({ direction, extreme, retracement, anchorPrice, confirmationIndex: i, retracementCandles: count, fibDepth: depth });
        break;
      }
    }
  }
  return completed.sort((a, b) => b.confirmationIndex - a.confirmationIndex)[0] ?? null;
}

function detectBreak(
  range: StructuralRange,
  candle: NormalizedMarketCandle,
  index: number,
  rejected: RejectedStructureEvent[]
): { event: StructureBreakEvent; candidate: CandidateLeg } | null {
  let direction: Direction | null = null;
  let brokenLevel = 0;
  let breakType = '';
  let anchor: TypedStructuralAnchor<StructurePointType>;
  if (range.direction === 'BULLISH') {
    if (candle.close > range.top.price) {
      direction = 'BULLISH'; brokenLevel = range.top.price; breakType = 'BULLISH_CONTINUATION'; anchor = range.bottom;
    } else if (candle.close < range.bottom.price) {
      direction = 'BEARISH'; brokenLevel = range.bottom.price; breakType = 'BULLISH_STRUCTURE_BROKEN'; anchor = range.top;
    } else {
      rejectWicks(range, candle, index, rejected);
      return null;
    }
  } else {
    if (candle.close < range.bottom.price) {
      direction = 'BEARISH'; brokenLevel = range.bottom.price; breakType = 'BEARISH_CONTINUATION'; anchor = range.top;
    } else if (candle.close > range.top.price) {
      direction = 'BULLISH'; brokenLevel = range.top.price; breakType = 'BEARISH_STRUCTURE_BROKEN'; anchor = range.bottom;
    } else {
      rejectWicks(range, candle, index, rejected);
      return null;
    }
  }
  const event: StructureBreakEvent = {
    id: `v6r3_break_${range.rangeId}_${candle.openTimeUnix}`,
    candleTime: candle.openTime,
    candleTimeUnix: candle.openTimeUnix,
    candleIndex: index,
    price: candle.close,
    brokenLevel,
    breakType,
    label: breakType,
    regimeId: range.rangeId,
  };
  return {
    event,
    candidate: {
      direction,
      anchor,
      breakEvent: event,
      breakCandle: candle,
      extreme: { price: direction === 'BULLISH' ? candle.high : candle.low, candle, index },
      retracement: null,
      retracementCandles: 0,
      qualificationReachedAtIndex: null,
      resumptionLevel: null,
    },
  };
}

function extendCandidate(candidate: CandidateLeg, candle: NormalizedMarketCandle, index: number): boolean {
  const extended = candidate.direction === 'BULLISH'
    ? candle.high > candidate.extreme.price
    : candle.low < candidate.extreme.price;
  if (!extended) return false;
  candidate.extreme = { price: candidate.direction === 'BULLISH' ? candle.high : candle.low, candle, index };
  candidate.retracement = null;
  candidate.retracementCandles = 0;
  candidate.qualificationReachedAtIndex = null;
  candidate.resumptionLevel = null;
  return true;
}

function updateRetracement(candidate: CandidateLeg, candle: NormalizedMarketCandle, index: number): boolean {
  const price = candidate.direction === 'BULLISH' ? candle.low : candle.high;
  let extended = false;
  if (!candidate.retracement || (candidate.direction === 'BULLISH' ? price < candidate.retracement.price : price > candidate.retracement.price)) {
    candidate.retracement = { price, candle, index };
    extended = true;
  }
  candidate.retracementCandles = index - candidate.extreme.index;
  return extended;
}

function qualify(candidate: CandidateLeg, requiredCandles: number, requiredFib: number) {
  const range = Math.abs(candidate.extreme.price - candidate.anchor.price);
  const retracementPrice = candidate.retracement?.price ?? candidate.extreme.price;
  const fibDepth = range > 0
    ? candidate.direction === 'BULLISH'
      ? (candidate.extreme.price - retracementPrice) / range
      : (retracementPrice - candidate.extreme.price) / range
    : 0;
  const fibRequiredPrice = candidate.direction === 'BULLISH'
    ? candidate.extreme.price - requiredFib * range
    : candidate.extreme.price + requiredFib * range;
  return {
    candleCount: candidate.retracementCandles,
    fibDepth,
    fibRequiredPrice,
    candleQualified: candidate.retracementCandles >= requiredCandles,
    fibQualified: candidate.direction === 'BULLISH' ? retracementPrice <= fibRequiredPrice : retracementPrice >= fibRequiredPrice,
    requiredCandles,
    requiredFib,
  };
}

function proposeTransition(
  previousRange: StructuralRange,
  candidate: CandidateLeg,
  retracement: Extreme,
  symbol: string,
  timeframe: string,
  algorithmVersion: string,
  sequence: number,
  qualification: ReturnType<typeof qualify>
): ProposedTransition {
  const created = createQualifiedPair(
    candidate.direction,
    candidate.extreme,
    retracement,
    symbol,
    timeframe,
    algorithmVersion,
    sequence,
    qualification.candleCount,
    qualification.fibDepth,
    false
  );
  return {
    previousRange,
    breakEvent: candidate.breakEvent,
    candidateExtreme: candidate.extreme,
    retracementExtreme: retracement,
    proposedPoints: created.points,
    proposedRange: created.range,
    nextState: candidate.direction === 'BULLISH' ? 'RANGE_LOCKED_BULLISH' : 'RANGE_LOCKED_BEARISH',
    retracementCandles: qualification.candleCount,
    fibDepth: qualification.fibDepth,
    fibRequiredPrice: qualification.fibRequiredPrice,
    requiredRetracementCandles: qualification.requiredCandles,
    requiredRetracementFib: qualification.requiredFib,
  };
}

function createQualifiedPair(
  direction: Direction,
  extreme: Extreme,
  retracement: Extreme,
  symbol: string,
  timeframe: string,
  algorithmVersion: string,
  sequence: number,
  retracementCandles: number,
  fibDepth: number,
  warmUp: boolean
): { points: [StructurePoint, StructurePoint]; range: BullishRange | BearishRange } {
  const rangeId = `V6R3_${direction}_RANGE_${sequence}`;
  const extremeType = direction === 'BULLISH' ? StructurePointType.HH : StructurePointType.LL;
  const retracementType = direction === 'BULLISH' ? StructurePointType.HL : StructurePointType.LH;
  const extremePoint = makePoint(extremeType, extreme, symbol, timeframe, algorithmVersion, rangeId, sequence, retracementCandles, fibDepth, warmUp);
  const retracementPoint = makePoint(retracementType, retracement, symbol, timeframe, algorithmVersion, rangeId, sequence, retracementCandles, fibDepth, warmUp);
  const extremeAnchor = pointToAnchor(extremePoint);
  const retracementAnchor = pointToAnchor(retracementPoint);
  const range = direction === 'BULLISH'
    ? createBullishRange(
        extremeAnchor as TypedStructuralAnchor<StructurePointType.HH>,
        retracementAnchor as TypedStructuralAnchor<StructurePointType.HL>,
        rangeId,
        sequence
      )
    : createBearishRange(
        retracementAnchor as TypedStructuralAnchor<StructurePointType.LH>,
        extremeAnchor as TypedStructuralAnchor<StructurePointType.LL>,
        rangeId,
        sequence
      );
  return { points: [extremePoint, retracementPoint], range };
}

function makePoint(
  type: StructurePointType.HH | StructurePointType.HL | StructurePointType.LH | StructurePointType.LL,
  source: Extreme,
  symbol: string,
  timeframe: string,
  algorithmVersion: string,
  rangeId: string,
  sequence: number,
  retracementCandles: number,
  fibDepth: number,
  warmUp: boolean
): StructurePoint {
  const id = `v6r3_${rangeId}_${type}_${source.candle.openTimeUnix}`;
  return {
    id,
    eventId: id,
    auditId: `${id}_audit`,
    symbol,
    timeframe,
    candleOpenTime: source.candle.openTime,
    candleOpenTimeUnix: source.candle.openTimeUnix,
    candleIndex: source.index,
    type,
    price: source.price,
    strength: StructureStrength.MAJOR,
    algorithmVersion,
    rangeId,
    sequenceIndex: sequence,
    sequenceLabel: `${type}${sequence}`,
    isRangeTop: type === StructurePointType.HH || type === StructurePointType.LH,
    isRangeBottom: type === StructurePointType.HL || type === StructurePointType.LL,
    confirmed: true,
    structureScope: 'EXTERNAL',
    retracementCandles,
    retracementFibDepth: fibDepth,
    isWarmUpAnchor: warmUp,
    confirmationReason: warmUp ? 'Nearest qualified prior warm-up cycle.' : 'Body-close break followed by candle-count and wick-Fibonacci qualified retracement.',
    detectedAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
  };
}

function pointToAnchor(point: StructurePoint): TypedStructuralAnchor<StructurePointType> {
  return {
    type: point.type,
    price: point.price,
    candleTime: point.candleOpenTime,
    candleTimeUnix: point.candleOpenTimeUnix,
    candleIndex: point.candleIndex,
    label: point.sequenceLabel ?? point.type,
    eventId: point.eventId,
    rangeId: point.rangeId,
  };
}

function seedManualRange(
  manual: NonNullable<StructureParameters['manualStart']>,
  candles: NormalizedMarketCandle[],
  symbol: string,
  timeframe: string,
  algorithmVersion: string,
  sequence: number
): { points: [StructurePoint, StructurePoint]; range: BullishRange | BearishRange } {
  const locate = (value: typeof manual.top, fallback: number): Extreme => {
    const unix = value.candleTimeUnix ?? new Date(value.candleTime).getTime();
    const index = value.candleIndex ?? candles.findIndex((c) => c.openTimeUnix === unix);
    const candle = candles[index >= 0 ? index : fallback] ?? candles[0];
    return { price: value.price, candle: { ...candle, openTime: value.candleTime, openTimeUnix: unix }, index: index >= 0 ? index : fallback };
  };
  const top = locate(manual.top, 0);
  const bottom = locate(manual.bottom, 1);
  return manual.direction === 'BULLISH'
    ? createQualifiedPair('BULLISH', top, bottom, symbol, timeframe, algorithmVersion, sequence, 0, 0, true)
    : createQualifiedPair('BEARISH', bottom, top, symbol, timeframe, algorithmVersion, sequence, 0, 0, true);
}

function validateTransition(
  proposed: ProposedTransition,
  confirmingCandle: NormalizedMarketCandle,
  symbol: string,
  timeframe: string,
  ranges: StructuralRange[]
): void {
  const [extreme, retracement] = proposed.proposedPoints;
  if (proposed.proposedPoints.length !== 2) throw new Error('V6 invariant failure: a cycle must contain exactly two points.');
  if (!assertSingleStructureType(extreme) || !assertSingleStructureType(retracement)) throw new Error('V6 invariant failure: invalid point type.');
  const bullish = proposed.nextState === 'RANGE_LOCKED_BULLISH';
  const expected = bullish ? [StructurePointType.HH, StructurePointType.HL] : [StructurePointType.LL, StructurePointType.LH];
  if (extreme.type !== expected[0] || retracement.type !== expected[1]) throw new Error('V6 invariant failure: invalid directional point pair.');
  if (proposed.proposedRange.direction !== (bullish ? 'BULLISH' : 'BEARISH')) throw new Error('V6 invariant failure: range/state disagreement.');
  const topPoint = bullish ? extreme : retracement;
  const bottomPoint = bullish ? retracement : extreme;
  if (proposed.proposedRange.top.eventId !== topPoint.eventId || proposed.proposedRange.bottom.eventId !== bottomPoint.eventId) throw new Error('V6 invariant failure: emitted points differ from range boundaries.');
  if (ranges.filter((range) => range.status === 'ACTIVE').length !== 1) throw new Error('V6 invariant failure: expected one active prior range.');
  const breakCloseQualified = proposed.breakEvent.breakType === 'BULLISH_CONTINUATION'
    ? proposed.breakEvent.price > proposed.previousRange.top.price
    : proposed.breakEvent.breakType === 'BEARISH_CONTINUATION'
      ? proposed.breakEvent.price < proposed.previousRange.bottom.price
      : proposed.breakEvent.breakType === 'BEARISH_STRUCTURE_BROKEN'
        ? proposed.breakEvent.price > proposed.previousRange.top.price
        : proposed.breakEvent.price < proposed.previousRange.bottom.price;
  if (!proposed.breakEvent.id || !breakCloseQualified || confirmingCandle.isClosed !== true) throw new Error('V6 invariant failure: transition requires a closed-candle body break.');
  if (proposed.retracementCandles < proposed.requiredRetracementCandles || proposed.fibDepth < proposed.requiredRetracementFib) throw new Error('V6 invariant failure: retracement was not qualified.');
  if (extreme.symbol !== symbol || retracement.symbol !== symbol || extreme.timeframe !== timeframe || retracement.timeframe !== timeframe) throw new Error('V6 invariant failure: symbol/timeframe mismatch.');
  if (extreme.eventId === retracement.eventId || extreme.candleOpenTimeUnix === retracement.candleOpenTimeUnix) throw new Error('V6 invariant failure: opposing types share one event.');
}

function validateFinalState(points: StructurePoint[], ranges: StructuralRange[], activeRange: StructuralRange | null, state: V6EngineState): void {
  const active = ranges.filter((range) => range.status === 'ACTIVE');
  if (activeRange) {
    if (active.length !== 1 || active[0].rangeId !== activeRange.rangeId) throw new Error('V6 invariant failure: exactly one range must be active.');
    const direction = state.includes('BULLISH') ? 'BULLISH' : state.includes('BEARISH') ? 'BEARISH' : null;
    if (state.startsWith('RANGE_LOCKED') && direction !== activeRange.direction) throw new Error('V6 invariant failure: state and active range direction disagree.');
  } else if (active.length !== 0 || state !== 'UNINITIALIZED') {
    throw new Error('V6 invariant failure: undefined state cannot own an active range.');
  }
  const events = new Set<string>();
  for (const point of points) {
    const key = point.eventId ?? point.id;
    if (events.has(key)) throw new Error(`V6 invariant failure: duplicate event ${key}.`);
    events.add(key);
  }
}

function createAudits(proposed: ProposedTransition, algorithmVersion: string): StructureDecisionAudit[] {
  return proposed.proposedPoints.map((point) => ({
    eventId: point.auditId!,
    regimeId: proposed.proposedRange.rangeId,
    cycleId: proposed.proposedRange.rangeId,
    sequenceId: point.sequenceLabel ?? point.type,
    eventType: point.type as 'HH' | 'HL' | 'LH' | 'LL',
    status: 'CONFIRMED',
    trendStateBefore: proposed.previousRange.direction === 'BULLISH' ? StructureState.BULLISH : StructureState.BEARISH,
    trendStateAfter: proposed.proposedRange.direction === 'BULLISH' ? StructureState.BULLISH : StructureState.BEARISH,
    candleIndex: point.candleIndex ?? 0,
    timestamp: point.candleOpenTime,
    timestampUnix: point.candleOpenTimeUnix,
    price: point.price,
    previousLockedAnchorType: proposed.previousRange.direction === 'BULLISH' ? StructurePointType.HL : StructurePointType.LH,
    previousLockedAnchorPrice: proposed.previousRange.direction === 'BULLISH' ? proposed.previousRange.bottom.price : proposed.previousRange.top.price,
    previousLockedAnchorTime: proposed.previousRange.direction === 'BULLISH' ? proposed.previousRange.bottom.candleTime : proposed.previousRange.top.candleTime,
    previousStructuralExtremeType: proposed.previousRange.direction === 'BULLISH' ? StructurePointType.HH : StructurePointType.LL,
    previousStructuralExtremePrice: proposed.previousRange.direction === 'BULLISH' ? proposed.previousRange.top.price : proposed.previousRange.bottom.price,
    previousStructuralExtremeTime: proposed.previousRange.direction === 'BULLISH' ? proposed.previousRange.top.candleTime : proposed.previousRange.bottom.candleTime,
    breakRequired: true,
    breakLevel: proposed.breakEvent.brokenLevel,
    breakCandleOpen: null,
    breakCandleHigh: null,
    breakCandleLow: null,
    breakCandleClose: proposed.breakEvent.price,
    breakWasBodyClose: true,
    breakWasWickOnly: false,
    candidateExtremeType: proposed.candidateExtreme === proposed.retracementExtreme ? null : proposed.proposedPoints[0].type,
    candidateExtremePrice: proposed.candidateExtreme.price,
    candidateExtremeTime: proposed.candidateExtreme.candle.openTime,
    candidateExtremeTimeUnix: proposed.candidateExtreme.candle.openTimeUnix,
    candidateExtremeIndex: proposed.candidateExtreme.index,
    retracementStartTime: proposed.candidateExtreme.candle.openTime,
    retracementExtremePrice: proposed.retracementExtreme.price,
    retracementExtremeTime: proposed.retracementExtreme.candle.openTime,
    retracementExtremeTimeUnix: proposed.retracementExtreme.candle.openTimeUnix,
    retracementExtremeIndex: proposed.retracementExtreme.index,
    retracementCandleCount: proposed.retracementCandles,
    requiredRetracementCandles: proposed.requiredRetracementCandles,
    candleCountQualified: true,
    fibAnchorPrice: proposed.previousRange.direction === 'BULLISH' ? proposed.previousRange.bottom.price : proposed.previousRange.top.price,
    fibExtremePrice: proposed.candidateExtreme.price,
    fibRequiredRatio: proposed.requiredRetracementFib,
    fibRequiredPrice: proposed.fibRequiredPrice,
    actualRetracementRatio: proposed.fibDepth,
    actualRetracementDepthPrice: proposed.retracementExtreme.price,
    fibQualified: true,
    decision: `${point.type} CONFIRMED`,
    decisionReason: point.confirmationReason ?? '',
    algorithmVersion,
  }));
}

function rejectWicks(range: StructuralRange, candle: NormalizedMarketCandle, index: number, rejected: RejectedStructureEvent[]): void {
  const attempts: Array<{ breached: boolean; level: number; value: number; kind: 'REJECTED_HIGH' | 'REJECTED_LOW' }> = [
    { breached: candle.high > range.top.price, level: range.top.price, value: candle.high, kind: 'REJECTED_HIGH' },
    { breached: candle.low < range.bottom.price, level: range.bottom.price, value: candle.low, kind: 'REJECTED_LOW' },
  ];
  for (const attempt of attempts) {
    if (!attempt.breached) continue;
    rejected.push({
      id: `v6r3_rejected_${range.rangeId}_${attempt.kind}_${candle.openTimeUnix}`,
      rangeId: range.rangeId,
      cycleId: range.rangeId,
      candleIndex: index,
      candleTime: candle.openTime,
      candleTimeUnix: candle.openTimeUnix,
      timestamp: candle.openTime,
      timestampUnix: candle.openTimeUnix,
      price: attempt.value,
      attemptedLevel: attempt.level,
      actualValue: attempt.value,
      requiredValue: attempt.level,
      rejectionType: attempt.kind,
      label: 'WICK BREACH (NO BODY CLOSE)',
      reason: `Wick crossed ${attempt.level}, but close ${candle.close} did not.`,
    });
  }
}

function buildActiveRetracement(candidate: CandidateLeg, range: StructuralRange | null, requiredCandles: number, requiredFib: number): ActiveRetracementInfo {
  const qualification = qualify(candidate, requiredCandles, requiredFib);
  return {
    state: range?.direction === 'BULLISH' ? StructureState.BULLISH : range ? StructureState.BEARISH : StructureState.UNDEFINED,
    candidateType: candidate.direction === 'BULLISH' ? StructurePointType.PROVISIONAL_HH : StructurePointType.PROVISIONAL_LL,
    candidatePrice: candidate.extreme.price,
    candidateTime: candidate.extreme.candle.openTime,
    candidateTimeUnix: candidate.extreme.candle.openTimeUnix,
    candidateCandleIndex: candidate.extreme.index,
    referencePrice: candidate.anchor.price,
    referenceTime: candidate.anchor.candleTime,
    fibLevelPrice: qualification.fibRequiredPrice,
    fibRatio: requiredFib,
    currentRetracementCandles: qualification.candleCount,
    requiredRetracementCandles: requiredCandles,
    currentRetracementPrice: candidate.retracement?.price ?? candidate.extreme.price,
    currentFibDepth: Math.max(0, qualification.fibDepth),
    currentRetracementExtremePrice: candidate.retracement?.price ?? null,
    currentRetracementExtremeTime: candidate.retracement?.candle.openTime ?? null,
    currentRetracementExtremeIndex: candidate.retracement?.index ?? null,
    isCandleCountQualified: qualification.candleQualified,
    isFibDepthQualified: qualification.fibQualified,
    isFullyQualified: qualification.candleQualified && qualification.fibQualified,
    retracementQualified: qualification.candleQualified && qualification.fibQualified,
    requiredCandles,
    requiredFib,
  };
}

function recordReplay(
  steps: CandleReplayStep[],
  index: number,
  candle: NormalizedMarketCandle,
  state: V6EngineState,
  range: StructuralRange | null,
  decisionTrace: string[],
  breakId: string | null,
  pointId: string | null
): void {
  const publicState = range?.direction === 'BULLISH' ? StructureState.BULLISH : range ? StructureState.BEARISH : StructureState.UNDEFINED;
  const snapshot: EngineStateSnapshot = {
    state: publicState,
    phase: state as any,
    activeTopAnchor: range ? { type: range.top.type, price: range.top.price, label: range.top.label, eventId: range.top.eventId, candleTime: range.top.candleTime, candleIndex: range.top.candleIndex } : null,
    activeBottomAnchor: range ? { type: range.bottom.type, price: range.bottom.price, label: range.bottom.label, eventId: range.bottom.eventId, candleTime: range.bottom.candleTime, candleIndex: range.bottom.candleIndex } : null,
    lastBreakEvent: breakId,
    candleIndex: index,
    rangeId: range?.rangeId,
    direction: range?.direction,
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
    state: publicState,
    trendState: publicState,
    rangeId: range?.rangeId,
    activeRange: range ? { rangeId: range.rangeId, direction: range.direction, topPrice: range.top.price, bottomPrice: range.bottom.price, topLabel: range.top.label, bottomLabel: range.bottom.label } : null,
    lockedAnchor: range ? { type: range.direction === 'BULLISH' ? range.bottom.type : range.top.type, price: range.direction === 'BULLISH' ? range.bottom.price : range.top.price, time: range.direction === 'BULLISH' ? range.bottom.candleTime : range.top.candleTime, label: range.direction === 'BULLISH' ? range.bottom.label : range.top.label } : null,
    decisionTrace,
    structureBreakThisCandle: breakId,
    confirmedPointCreatedThisCandle: pointId,
    engineState: snapshot,
  });
}

function toPublicState(state: V6EngineState): StructureState {
  if (state.includes('BULLISH')) return StructureState.BULLISH;
  if (state.includes('BEARISH')) return StructureState.BEARISH;
  return StructureState.UNDEFINED;
}

function logItem(candle: NormalizedMarketCandle, eventType: StructureEventLogItem['eventType'], title: string, message: string): StructureEventLogItem {
  return { id: `v6r3_log_${eventType}_${candle.openTimeUnix}`, candleTime: candle.openTime, candleTimeUnix: candle.openTimeUnix, eventType, title, message };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function emptyResult(
  started: number,
  symbol: string,
  timeframe: string,
  algorithmVersion: string,
  parameters: StructureParameters,
  totalCandlesAvailable: number,
  unclosedCandleExcluded: boolean
): StructureDetectionResult {
  return {
    symbol, timeframe, algorithmVersion, parameters,
    structureState: StructureState.UNDEFINED, stateLabel: 'UNINITIALIZED',
    totalCandlesAvailable, closedCandlesEvaluated: 0, unclosedCandleExcluded,
    workingWindowStart: null, workingWindowEnd: null,
    hhCount: 0, hlCount: 0, lhCount: 0, llCount: 0, provisionalCount: 0, totalPointsCount: 0,
    lastHH: null, lastHL: null, lastLH: null, lastLL: null, activeProvisionalPoint: null,
    activeRetracement: null, points: [], ranges: [], activeRange: null,
    internalStructureIgnored: true, structureBreakEvents: [], eventLogs: [], audits: [], rejectedEvents: [], candleReplaySteps: [],
    executionTimeMs: Date.now() - started, detectedAt: new Date().toISOString(),
  };
}
