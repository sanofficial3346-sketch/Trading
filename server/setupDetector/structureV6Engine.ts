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
  fibAnchorPrice: number;
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
    const seed = seedManualRange(customParams.manualStart, candles, symbol, timeframe, algorithmVersion, 1);
    if (seed) {
      sequence = 1;
      activeRange = seed.range;
      points.push(...seed.points);
      ranges.push(seed.range);
      engineState = seed.range.direction === 'BULLISH' ? 'RANGE_LOCKED_BULLISH' : 'RANGE_LOCKED_BEARISH';
      loopStart = Math.max(seed.range.top.candleIndex ?? 0, seed.range.bottom.candleIndex ?? 0) + 1;
      stampConfirmation(seed, candles[loopStart - 1], loopStart - 1);
      initializationLogs.push(`Manual ${seed.range.direction} range accepted.`);
    } else {
      loopStart = candles.length;
      initializationLogs.push('Manual anchors are not both present as closed candles; waiting without inventing a range.');
    }
  } else {
    const initialization = findFirstCompletedWarmUpCycle(
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
      stampConfirmation(seed, candles[initialization.confirmationIndex], initialization.confirmationIndex);
      activeRange = seed.range;
      points.push(...seed.points);
      ranges.push(seed.range);
      engineState = initialization.direction === 'BULLISH' ? 'RANGE_LOCKED_BULLISH' : 'RANGE_LOCKED_BEARISH';
      loopStart = initialization.confirmationIndex + 1;
      const next = detectBreak(activeRange, candles[initialization.confirmationIndex], initialization.confirmationIndex, rejectedEvents)!;
      candidate = next.candidate;
      breakEvents.push(next.event);
      engineState = candidate.direction === 'BULLISH' ? 'EXPANDING_BULLISH' : 'EXPANDING_BEARISH';
      initializationLogs.push(`First completed ${initialization.direction} external cycle seeded; replaying forward to preserve parent-range history.`);
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
    // The completed seed cannot be visible before its confirmation candle.
    const seedConfirmed = activeRange !== null && i === loopStart - 1;
    recordReplay(candleReplaySteps, i, candles[i], seedConfirmed ? engineState : 'UNINITIALIZED', seedConfirmed ? activeRange : null,
      [seedConfirmed ? 'Completed seed confirmed.' : 'Warm-up evaluation; no confirmed range yet.'], seedConfirmed ? candidate?.breakEvent.id ?? null : null, seedConfirmed ? points[0].id : null);
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
      // Parent boundaries remain authoritative even while a candidate is pending.
      const oppositeParentBreak = candidate.direction === 'BULLISH'
        ? candle.close < activeRange.bottom.price
        : candle.close > activeRange.top.price;
      if (oppositeParentBreak) {
        const reversal = detectBreak(activeRange, candle, i, rejectedEvents)!;
        candidate = reversal.candidate;
        breakEvents.push(reversal.event);
        breakThisCandle = reversal.event.id ?? null;
        engineState = candidate.direction === 'BULLISH' ? 'EXPANDING_BULLISH' : 'EXPANDING_BEARISH';
        trace.push(`Pending candidate cancelled by ${reversal.event.breakType} through the confirmed parent boundary.`);
        eventLogs.push(logItem(candle, 'STRUCTURE_BROKEN', 'Parent boundary broken', trace[trace.length - 1]));
      } else {
        // Check the PREVIOUS expansion extreme and qualification before this
        // candle's wick can extend/reset the leg. A micro resumption is irrelevant.
        const qualification = qualify(candidate, minimumRetracementCandles, minimumRetracementFib);
        if (canConfirmExpansion(candidate, candle, i, qualification) && candidate.retracement) {
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
          stampConfirmation({ points: proposed.proposedPoints, range: proposed.proposedRange }, candle, i);

          // Atomic commit: the old range persists until this confirmation close.
          const brokenPrevious: StructuralRange = {
            ...proposed.previousRange,
            status: proposed.breakEvent.breakType.includes('STRUCTURE_BROKEN') ? 'BROKEN_REVERSAL' : 'BROKEN_CONTINUATION',
            endedAt: candle.openTime,
            endedAtUnix: candle.openTimeUnix,
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
          trace.push(`Close ${candle.close} crossed the prior candidate expansion ${candidate.extreme.price}; committed ${proposed.proposedPoints.map((point) => point.type).join('+')} atomically.`);
          eventLogs.push(logItem(candle, 'STRUCTURE_CONFIRMED', `${candidate.direction} cycle confirmed`, trace[trace.length - 1]));

          // The confirming candle is already outside the newly confirmed range.
          // Carry its wick into the next leg; never lose it or confirm twice.
          const next = detectBreak(activeRange, candle, i, rejectedEvents)!;
          candidate = next.candidate;
          breakEvents.push(next.event);
          breakThisCandle = next.event.id ?? null;
          engineState = candidate.direction === 'BULLISH' ? 'EXPANDING_BULLISH' : 'EXPANDING_BEARISH';
        } else {
          const extended = advanceUnconfirmedCandidate(candidate, candle, i, minimumRetracementCandles, minimumRetracementFib);
          engineState = candidate.direction === 'BULLISH'
            ? extended ? 'EXPANDING_BULLISH' : 'RETRACING_BULLISH'
            : extended ? 'EXPANDING_BEARISH' : 'RETRACING_BEARISH';
          if (extended) {
            trace.push(`Same-leg ${candidate.direction} extreme extended to ${candidate.extreme.price}; retracement reset.`);
            eventLogs.push(logItem(candle, 'LEG_EXTENDED', 'Candidate extended', trace[trace.length - 1]));
          } else {
            const current = qualify(candidate, minimumRetracementCandles, minimumRetracementFib);
            trace.push(`Retracement ${current.candleCount}/${minimumRetracementCandles} candles, ${(current.fibDepth * 100).toFixed(1)}%/${(minimumRetracementFib * 100).toFixed(1)}% Fib.`);
            if (current.candleQualified && current.fibQualified) {
              trace.push(`Qualified candidate only; waiting for a later close through expansion extreme ${candidate.extreme.price}.`);
            }
          }
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

function findFirstCompletedWarmUpCycle(
  candles: NormalizedMarketCandle[],
  minimumCandles: number,
  minimumFib: number
): InitializationCandidate | null {
  const completed: InitializationCandidate[] = [];
  for (let breakIndex = 1; breakIndex < candles.length; breakIndex++) {
    const prior = candles.slice(0, breakIndex);
    const priorHigh = Math.max(...prior.map((c) => c.high));
    const priorLow = Math.min(...prior.map((c) => c.low));
    const breakCandle = candles[breakIndex];
    const direction: Direction | null = breakCandle.close > priorHigh
      ? 'BULLISH'
      : breakCandle.close < priorLow ? 'BEARISH' : null;
    if (!direction) continue;

    // Bootstrap only from a close beyond the entire observed prefix envelope.
    // A completed expansion/retracement/expansion is required, never four bars alone.
    const anchorPrice = direction === 'BULLISH' ? priorLow : priorHigh;
    const candidate: CandidateLeg = {
      direction,
      anchor: {
        type: direction === 'BULLISH' ? StructurePointType.HL : StructurePointType.LH,
        price: anchorPrice, candleTime: prior[0].openTime,
        candleTimeUnix: prior[0].openTimeUnix, label: 'UNCONFIRMED_SEED',
      },
      breakEvent: {
        candleTime: breakCandle.openTime, candleTimeUnix: breakCandle.openTimeUnix,
        price: breakCandle.close, brokenLevel: direction === 'BULLISH' ? priorHigh : priorLow,
        breakType: 'WARMUP', label: 'WARMUP',
      },
      breakCandle,
      extreme: { price: direction === 'BULLISH' ? breakCandle.high : breakCandle.low, candle: breakCandle, index: breakIndex },
      retracement: null, retracementCandles: 0, qualificationReachedAtIndex: null,
    };
    for (let i = breakIndex + 1; i < candles.length; i++) {
      const candle = candles[i];
      // A seed that crosses its opposing prefix boundary has been invalidated.
      if (direction === 'BULLISH' ? candle.close < priorLow : candle.close > priorHigh) break;
      const qualification = qualify(candidate, minimumCandles, minimumFib);
      if (canConfirmExpansion(candidate, candle, i, qualification) && candidate.retracement) {
        completed.push({
          direction, extreme: candidate.extreme, retracement: candidate.retracement,
          anchorPrice, confirmationIndex: i, retracementCandles: qualification.candleCount,
          fibDepth: qualification.fibDepth,
        });
        break;
      }
      advanceUnconfirmedCandidate(candidate, candle, i, minimumCandles, minimumFib);
    }
  }
  // Seed the earliest completed cycle, then let the ordinary state machine
  // replay forward. Picking the latest independent micro-cycle loses its parent.
  return completed.sort((a, b) => a.confirmationIndex - b.confirmationIndex)[0] ?? null;
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

function canConfirmExpansion(candidate: CandidateLeg, candle: NormalizedMarketCandle, index: number, qualification: ReturnType<typeof qualify>): boolean {
  return candle.isClosed === true
    && candidate.qualificationReachedAtIndex !== null
    && index > candidate.qualificationReachedAtIndex
    && qualification.candleQualified && qualification.fibQualified
    && (candidate.direction === 'BULLISH' ? candle.close > candidate.extreme.price : candle.close < candidate.extreme.price);
}

function advanceUnconfirmedCandidate(candidate: CandidateLeg, candle: NormalizedMarketCandle, index: number, minimumCandles: number, minimumFib: number): boolean {
  if (extendCandidate(candidate, candle, index)) return true;
  updateRetracement(candidate, candle, index);
  const qualification = qualify(candidate, minimumCandles, minimumFib);
  if (qualification.candleQualified && qualification.fibQualified && candidate.qualificationReachedAtIndex === null) {
    candidate.qualificationReachedAtIndex = index;
  }
  return false;
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
    fibAnchorPrice: candidate.anchor.price,
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
    confirmationReason: warmUp ? 'Completed prior external cycle (or explicit manual seed).' : 'External body-close break, qualified retracement, then a later close through the preceding expansion extreme.',
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

function stampConfirmation(pair: { points: [StructurePoint, StructurePoint]; range: StructuralRange }, candle: NormalizedMarketCandle, index: number): void {
  for (const point of pair.points) {
    point.confirmationCandleTime = candle.openTime;
    point.confirmationCandleTimeUnix = candle.openTimeUnix;
    point.confirmationCandleIndex = index;
  }
  // Range lifetime begins when it is confirmed, not at the historical wick.
  pair.range.startedAt = candle.openTime;
  pair.range.startedAtUnix = candle.openTimeUnix;
}

function seedManualRange(
  manual: NonNullable<StructureParameters['manualStart']>,
  candles: NormalizedMarketCandle[],
  symbol: string,
  timeframe: string,
  algorithmVersion: string,
  sequence: number
): { points: [StructurePoint, StructurePoint]; range: BullishRange | BearishRange } | null {
  const locate = (value: typeof manual.top): Extreme | null => {
    const unix = value.candleTimeUnix ?? new Date(value.candleTime).getTime();
    // Array indices can shift after filtering an open candle or slicing a window.
    // Anchor identity comes from its timestamp, never a guessed fallback candle.
    const index = candles.findIndex((c) => c.openTimeUnix === unix);
    return index < 0 ? null : { price: value.price, candle: candles[index], index };
  };
  const top = locate(manual.top);
  const bottom = locate(manual.bottom);
  if (!top || !bottom || top.index === bottom.index) return null;
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
  const expansionConfirmed = bullish ? confirmingCandle.close > proposed.candidateExtreme.price : confirmingCandle.close < proposed.candidateExtreme.price;
  if (!expansionConfirmed || confirmingCandle.openTimeUnix <= proposed.retracementExtreme.candle.openTimeUnix) throw new Error('V6 invariant failure: later close must cross the preceding expansion extreme.');
  const fibQualified = bullish ? proposed.retracementExtreme.price <= proposed.fibRequiredPrice : proposed.retracementExtreme.price >= proposed.fibRequiredPrice;
  if (proposed.retracementCandles < proposed.requiredRetracementCandles || !fibQualified) throw new Error('V6 invariant failure: retracement was not qualified.');
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
  const classifications = new Map<number, StructurePointType>();
  for (const point of points) {
    const key = point.eventId ?? point.id;
    if (events.has(key)) throw new Error(`V6 invariant failure: duplicate event ${key}.`);
    events.add(key);
    const existing = classifications.get(point.candleOpenTimeUnix);
    if (existing !== undefined && existing !== point.type) throw new Error('V6 invariant failure: opposing types share one candle.');
    classifications.set(point.candleOpenTimeUnix, point.type);
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
    fibAnchorPrice: proposed.fibAnchorPrice,
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
