import { NormalizedMarketCandle } from '../marketData/mexcPublicMarketClient';
import { candleRepository } from '../marketData/candleRepository';
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
  CURRENT_ALGORITHM_VERSION,
  ALGORITHM_VERSION_V2,
  ALGORITHM_VERSION_V3,
  ALGORITHM_VERSION_V4,
  ALGORITHM_VERSION_V5,
  ALGORITHM_VERSION_V5_REV4,
  ALGORITHM_VERSION_V6,
  ALGORITHM_VERSION_V6_REV2,
} from './structureTypes';
import { structureRepository } from './structureRepository';
import { detectStructureV4WarmUpLocked } from './structureV4Engine';
import { detectStructureV5RangeLocked } from './structureV5Engine';
import { detectStructureV6FibQualifiedRange } from './structureV6Engine';

export const STRUCTURE_LOOKBACK_CANDLES = 350;
export {
  CURRENT_ALGORITHM_VERSION,
  ALGORITHM_VERSION_V2,
  ALGORITHM_VERSION_V3,
  ALGORITHM_VERSION_V4,
  ALGORITHM_VERSION_V5,
  ALGORITHM_VERSION_V5_REV4,
  ALGORITHM_VERSION_V6,
  ALGORITHM_VERSION_V6_REV2,
};

export class StructureEngine {
  /**
   * Main Entry Point: Dispatches to requested algorithm version.
   * Primary Setup Lab structure now runs on STRUCTURE_V6_FIB_QUALIFIED_RANGE.
   * V5 and V4 remain available for comparison.
   */
  public detectStructure(
    candles: NormalizedMarketCandle[],
    customParams?: Partial<StructureParameters>
  ): StructureDetectionResult {
    const version = customParams?.algorithmVersion;
    if (version === ALGORITHM_VERSION_V5 || version === ALGORITHM_VERSION_V5_REV4) {
      return this.detectStructureV5RangeLocked(candles, customParams);
    }
    if (version === ALGORITHM_VERSION_V4) {
      return this.detectStructureV4WarmUpLocked(candles, customParams);
    }
    if (version === ALGORITHM_VERSION_V3) {
      return this.detectStructureV3LockedCycles(candles, customParams);
    }
    if (
      version === ALGORITHM_VERSION_V2 ||
      (customParams?.initialSeed && !version) ||
      (customParams?.legacyPivotOverlay && !version) ||
      (customParams?.lookbackCandles && !customParams?.analysisCandles && !version)
    ) {
      return this.detectStructureV2(candles, customParams);
    }
    // Default to STRUCTURE_V6_FIB_QUALIFIED_RANGE
    return this.detectStructureV6FibQualifiedRange(candles, customParams);
  }

  /**
   * STRUCTURE_V6_FIB_QUALIFIED_RANGE
   * Strict external market structure engine enforcing minimum 4 candles & 0.382 Fib retracement.
   */
  public detectStructureV6FibQualifiedRange(
    candles: NormalizedMarketCandle[],
    customParams?: Partial<StructureParameters>
  ): StructureDetectionResult {
    return detectStructureV6FibQualifiedRange(candles, customParams);
  }

  /**
   * STRUCTURE_V5_RANGE_LOCKED
   * Strict range-locked market structure engine.
   * Anything inside the established range is internal and strictly ignored.
   */
  public detectStructureV5RangeLocked(
    candles: NormalizedMarketCandle[],
    customParams?: Partial<StructureParameters>
  ): StructureDetectionResult {
    return detectStructureV5RangeLocked(candles, customParams);
  }

  /**
   * STRUCTURE_V4_WARMUP_LOCKED (Legacy Comparison)
   * Two-part window: Warm-up search window (default 70) + Main analysis window (default 280).
   * Evaluates nearest valid completed structure before main boundary, locks incoming anchors,
   * and runs chronological stateful locked cycles.
   */
  public detectStructureV4WarmUpLocked(
    candles: NormalizedMarketCandle[],
    customParams?: Partial<StructureParameters>
  ): StructureDetectionResult {
    return detectStructureV4WarmUpLocked(candles, customParams);
  }

  /**
   * STRUCTURE_V3_LOCKED_CYCLES
   *
   * A strict, stateful, locked structure cycle engine.
   *
   * Core Invariants:
   * 1. Does NOT assume initial bullish structure. Discovers whether initial confirmed structure
   *    is BULLISH, BEARISH, or UNDEFINED based on chronological price action.
   * 2. Advances through locked cycles:
   *    Bullish: HL1 -> HH1 -> qualifying retracement -> HL2 (locked invalidation) -> HH2 ...
   *    Bearish: LH1 -> LL1 -> qualifying retracement -> LH2 (locked invalidation) -> LL2 ...
   * 3. Once structural HL or LH is confirmed, it is LOCKED. It NEVER moves simply because
   *    another internal local high or low appears.
   * 4. Internal opposite-direction labels are suppressed (no LH/LL during confirmed Bullish;
   *    no HH/HL during confirmed Bearish).
   * 5. Strict body-close rule:
   *    - Closed candle close > previous HH begins new HH cycle (or breaks LH)
   *    - Closed candle close < previous LL begins new LL cycle (or breaks HL)
   *    - Wicks alone NEVER break structure.
   * 6. Same-leg continuation: If pullbacks fail candle count or Fib depth, new extremes
   *    extend the provisional leg; no multiple HH or LL markers are created.
   * 7. Rolling Fib anchors roll forward to the newly confirmed structural point.
   */
  public detectStructureV3LockedCycles(
    candles: NormalizedMarketCandle[],
    customParams?: Partial<StructureParameters>
  ): StructureDetectionResult {
    const startTime = Date.now();

    const minCandles = Math.max(1, Math.min(20, customParams?.minimumRetracementCandles ?? 4));
    const minFib = Math.max(0.1, Math.min(1.0, customParams?.minimumRetracementFib ?? 0.382));
    const lookback = customParams?.lookbackCandles ?? STRUCTURE_LOOKBACK_CANDLES;

    const params: StructureParameters = {
      minimumRetracementCandles: minCandles,
      minimumRetracementFib: minFib,
      breakConfirmation: 'CLOSE',
      fibTouchMode: 'WICK',
      lookbackCandles: lookback,
      algorithmVersion: CURRENT_ALGORITHM_VERSION,
      cycleLocking: true,
      showProvisionalStructure: customParams?.showProvisionalStructure ?? false,
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

    // 2. Truncate to lookback window
    const workingSet =
      params.lookbackCandles > 0 && closedCandles.length > params.lookbackCandles
        ? closedCandles.slice(closedCandles.length - params.lookbackCandles)
        : closedCandles;

    const points: StructurePoint[] = [];
    const cycles: StructureCycle[] = [];
    const eventLogs: StructureEventLogItem[] = [];

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

    // State machine trackers
    let structureState: StructureState = StructureState.UNDEFINED;
    let activeLockedHL: StructurePoint | null = null;
    let lastConfirmedHH: StructurePoint | null = null;
    let activeLockedLH: StructurePoint | null = null;
    let lastConfirmedLL: StructurePoint | null = null;

    // Active candidate expansion/retracement tracker
    let candidateType: StructurePointType.PROVISIONAL_HH | StructurePointType.PROVISIONAL_LL | null = null;
    let candidatePrice: number = 0;
    let candidateCandleIndex: number = -1;
    let candidateCandleTime: string = '';
    let candidateCandleTimeUnix: number = 0;
    let referencePrice: number = 0;
    let referenceTime: string = '';

    // Retracement extremes
    let lowestLowSinceCandidate: number = Infinity;
    let lowestLowCandleIndex: number = -1;
    let lowestLowCandleTime: string = '';

    let highestHighSinceCandidate: number = -Infinity;
    let highestHighCandleIndex: number = -1;
    let highestHighCandleTime: string = '';

    // Undefined discovery trackers
    let discoveryHighPrice = workingSet[0]?.high ?? 0;
    let discoveryHighIndex = 0;
    let discoveryHighTime = workingSet[0]?.openTime ?? '';
    let discoveryHighTimeUnix = workingSet[0]?.openTimeUnix ?? 0;

    let discoveryLowPrice = workingSet[0]?.low ?? 0;
    let discoveryLowIndex = 0;
    let discoveryLowTime = workingSet[0]?.openTime ?? '';
    let discoveryLowTimeUnix = workingSet[0]?.openTimeUnix ?? 0;

    let discoveryLowestSinceHigh = workingSet[0]?.low ?? 0;
    let discoveryLowestSinceHighIndex = 0;
    let discoveryLowestSinceHighTime = workingSet[0]?.openTime ?? '';
    let discoveryLowestSinceHighTimeUnix = workingSet[0]?.openTimeUnix ?? 0;

    let discoveryHighestSinceLow = workingSet[0]?.high ?? 0;
    let discoveryHighestSinceLowIndex = 0;
    let discoveryHighestSinceLowTime = workingSet[0]?.openTime ?? '';
    let discoveryHighestSinceLowTimeUnix = workingSet[0]?.openTimeUnix ?? 0;

    // Apply initial seed if provided
    if (params.initialSeed) {
      structureState = params.initialSeed.state;
      if (params.initialSeed.confirmedHL) {
        activeLockedHL = {
          id: `sp_seed_hl_${symbol}_${params.initialSeed.confirmedHL.candleIndex ?? 0}_V3`,
          symbol,
          timeframe,
          candleOpenTime: params.initialSeed.confirmedHL.time || workingSet[0]?.openTime || '',
          candleOpenTimeUnix: workingSet[params.initialSeed.confirmedHL.candleIndex ?? 0]?.openTimeUnix || 0,
          type: StructurePointType.HL,
          price: params.initialSeed.confirmedHL.price,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: params.initialSeed.confirmedHL.candleIndex,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        points.push(activeLockedHL);
      }
      if (params.initialSeed.confirmedHH) {
        lastConfirmedHH = {
          id: `sp_seed_hh_${symbol}_${params.initialSeed.confirmedHH.candleIndex ?? 0}_V3`,
          symbol,
          timeframe,
          candleOpenTime: params.initialSeed.confirmedHH.time || workingSet[0]?.openTime || '',
          candleOpenTimeUnix: workingSet[params.initialSeed.confirmedHH.candleIndex ?? 0]?.openTimeUnix || 0,
          type: StructurePointType.HH,
          price: params.initialSeed.confirmedHH.price,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: params.initialSeed.confirmedHH.candleIndex,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        points.push(lastConfirmedHH);
      }
      if (params.initialSeed.confirmedLH) {
        activeLockedLH = {
          id: `sp_seed_lh_${symbol}_${params.initialSeed.confirmedLH.candleIndex ?? 0}_V3`,
          symbol,
          timeframe,
          candleOpenTime: params.initialSeed.confirmedLH.time || workingSet[0]?.openTime || '',
          candleOpenTimeUnix: workingSet[params.initialSeed.confirmedLH.candleIndex ?? 0]?.openTimeUnix || 0,
          type: StructurePointType.LH,
          price: params.initialSeed.confirmedLH.price,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: params.initialSeed.confirmedLH.candleIndex,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        points.push(activeLockedLH);
      }
      if (params.initialSeed.confirmedLL) {
        lastConfirmedLL = {
          id: `sp_seed_ll_${symbol}_${params.initialSeed.confirmedLL.candleIndex ?? 0}_V3`,
          symbol,
          timeframe,
          candleOpenTime: params.initialSeed.confirmedLL.time || workingSet[0]?.openTime || '',
          candleOpenTimeUnix: workingSet[params.initialSeed.confirmedLL.candleIndex ?? 0]?.openTimeUnix || 0,
          type: StructurePointType.LL,
          price: params.initialSeed.confirmedLL.price,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: params.initialSeed.confirmedLL.candleIndex,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        points.push(lastConfirmedLL);
      }
    }

    // 3. Chronological processing
    for (let i = 0; i < workingSet.length; i++) {
      const candle = workingSet[i];

      // STATE: UNDEFINED (Chronological discovery of first structure)
      if (structureState === StructureState.UNDEFINED) {
        if (i === 0) {
          discoveryHighPrice = candle.high;
          discoveryHighIndex = 0;
          discoveryHighTime = candle.openTime;
          discoveryHighTimeUnix = candle.openTimeUnix;

          discoveryLowPrice = candle.low;
          discoveryLowIndex = 0;
          discoveryLowTime = candle.openTime;
          discoveryLowTimeUnix = candle.openTimeUnix;

          discoveryLowestSinceHigh = candle.low;
          discoveryLowestSinceHighIndex = 0;
          discoveryLowestSinceHighTime = candle.openTime;
          discoveryLowestSinceHighTimeUnix = candle.openTimeUnix;

          discoveryHighestSinceLow = candle.high;
          discoveryHighestSinceLowIndex = 0;
          discoveryHighestSinceLowTime = candle.openTime;
          discoveryHighestSinceLowTimeUnix = candle.openTimeUnix;
          continue;
        }

        // Bearish tracking: high established, then low, then bounce
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

        // Bullish tracking: low established, then high, then pullback
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

        // Evaluate Bearish Qualification
        if (discoveryLowestSinceHighIndex > discoveryHighIndex) {
          let bounceHigh = -Infinity;
          let bounceIndex = -1;
          let bounceTime = '';
          let bounceTimeUnix = 0;
          for (let b = discoveryLowestSinceHighIndex; b <= i; b++) {
            if (workingSet[b].high > bounceHigh) {
              bounceHigh = workingSet[b].high;
              bounceIndex = b;
              bounceTime = workingSet[b].openTime;
              bounceTimeUnix = workingSet[b].openTimeUnix;
            }
          }

          const retraceBars = bounceIndex - discoveryLowestSinceHighIndex;
          const fibRange = discoveryHighPrice - discoveryLowestSinceHigh;
          const fibTarget = discoveryLowestSinceHigh + minFib * fibRange;

          if (retraceBars >= minCandles && bounceHigh >= fibTarget) {
            const cycleId = `cycle_bear_${cycles.length + 1}`;
            const initialLH: StructurePoint = {
              id: `sp_lh_${symbol}_${discoveryHighTimeUnix}_V3`,
              symbol,
              timeframe,
              candleOpenTime: discoveryHighTime,
              candleOpenTimeUnix: discoveryHighTimeUnix,
              type: StructurePointType.LH,
              price: discoveryHighPrice,
              strength: StructureStrength.MAJOR,
              algorithmVersion: CURRENT_ALGORITHM_VERSION,
              candleIndex: discoveryHighIndex,
              cycleId,
              previousStructurePointId: null,
              trendState: StructureState.BEARISH,
              confirmationReason: 'Initial structural LH discovered (Locked Bearish Invalidation)',
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };

            const initialLL: StructurePoint = {
              id: `sp_ll_${symbol}_${discoveryLowestSinceHighTimeUnix}_V3`,
              symbol,
              timeframe,
              candleOpenTime: discoveryLowestSinceHighTime,
              candleOpenTimeUnix: discoveryLowestSinceHighTimeUnix,
              type: StructurePointType.LL,
              price: discoveryLowestSinceHigh,
              strength: StructureStrength.MAJOR,
              algorithmVersion: CURRENT_ALGORITHM_VERSION,
              candleIndex: discoveryLowestSinceHighIndex,
              cycleId,
              previousStructurePointId: initialLH.id,
              trendState: StructureState.BEARISH,
              confirmationReason: 'Initial structural LL discovered from qualified retracement bounce',
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };

            points.push(initialLH, initialLL);
            activeLockedLH = initialLH;
            lastConfirmedLL = initialLL;
            structureState = StructureState.BEARISH;

            cycles.push({
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
                type: StructurePointType.LL,
                price: initialLL.price,
                candleIndex: initialLL.candleIndex ?? discoveryLowestSinceHighIndex,
                candleTime: initialLL.candleOpenTime,
                candleTimeUnix: initialLL.candleOpenTimeUnix,
              },
              retracementExtreme: {
                type: StructurePointType.LH,
                price: bounceHigh,
                candleIndex: bounceIndex,
                candleTime: bounceTime,
                candleTimeUnix: bounceTimeUnix,
              },
              fibLevel: fibTarget,
              retracementCandles: retraceBars,
              requiredCandles: minCandles,
              fibDepth: fibRange > 0 ? (bounceHigh - discoveryLowestSinceHigh) / fibRange : 0,
              requiredFib: minFib,
              startedAt: discoveryHighTime,
              confirmedAt: candle.openTime,
            });

            addEvent(
              candle,
              'TREND_CONFIRMED',
              'Initial Bearish Structure Discovered',
              `Market structure discovered BEARISH from chronological price action: Confirmed LH at ${initialLH.price.toFixed(2)} (locked invalidation) and LL at ${initialLL.price.toFixed(2)}.`,
              {
                price: initialLL.price,
                referencePrice: initialLH.price,
                retracementCandles: retraceBars,
                requiredCandles: minCandles,
                fibDepth: fibRange > 0 ? (bounceHigh - discoveryLowestSinceHigh) / fibRange : 0,
                requiredFib: minFib,
              }
            );

            continue;
          }
        }

        // Evaluate Bullish Qualification
        if (discoveryHighestSinceLowIndex > discoveryLowIndex) {
          let pullbackLow = Infinity;
          let pullbackIndex = -1;
          let pullbackTime = '';
          let pullbackTimeUnix = 0;
          for (let b = discoveryHighestSinceLowIndex; b <= i; b++) {
            if (workingSet[b].low < pullbackLow) {
              pullbackLow = workingSet[b].low;
              pullbackIndex = b;
              pullbackTime = workingSet[b].openTime;
              pullbackTimeUnix = workingSet[b].openTimeUnix;
            }
          }

          const retraceBars = pullbackIndex - discoveryHighestSinceLowIndex;
          const fibRange = discoveryHighestSinceLow - discoveryLowPrice;
          const fibTarget = discoveryHighestSinceLow - minFib * fibRange;

          if (retraceBars >= minCandles && pullbackLow <= fibTarget) {
            const cycleId = `cycle_bull_${cycles.length + 1}`;
            const initialHL: StructurePoint = {
              id: `sp_hl_${symbol}_${discoveryLowTimeUnix}_V3`,
              symbol,
              timeframe,
              candleOpenTime: discoveryLowTime,
              candleOpenTimeUnix: discoveryLowTimeUnix,
              type: StructurePointType.HL,
              price: discoveryLowPrice,
              strength: StructureStrength.MAJOR,
              algorithmVersion: CURRENT_ALGORITHM_VERSION,
              candleIndex: discoveryLowIndex,
              cycleId,
              previousStructurePointId: null,
              trendState: StructureState.BULLISH,
              confirmationReason: 'Initial structural HL discovered (Locked Bullish Invalidation)',
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };

            const initialHH: StructurePoint = {
              id: `sp_hh_${symbol}_${discoveryHighestSinceLowTimeUnix}_V3`,
              symbol,
              timeframe,
              candleOpenTime: discoveryHighestSinceLowTime,
              candleOpenTimeUnix: discoveryHighestSinceLowTimeUnix,
              type: StructurePointType.HH,
              price: discoveryHighestSinceLow,
              strength: StructureStrength.MAJOR,
              algorithmVersion: CURRENT_ALGORITHM_VERSION,
              candleIndex: discoveryHighestSinceLowIndex,
              cycleId,
              previousStructurePointId: initialHL.id,
              trendState: StructureState.BULLISH,
              confirmationReason: 'Initial structural HH discovered from qualified retracement pullback',
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };

            points.push(initialHL, initialHH);
            activeLockedHL = initialHL;
            lastConfirmedHH = initialHH;
            structureState = StructureState.BULLISH;

            cycles.push({
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
                type: StructurePointType.HH,
                price: initialHH.price,
                candleIndex: initialHH.candleIndex ?? discoveryHighestSinceLowIndex,
                candleTime: initialHH.candleOpenTime,
                candleTimeUnix: initialHH.candleOpenTimeUnix,
              },
              retracementExtreme: {
                type: StructurePointType.HL,
                price: pullbackLow,
                candleIndex: pullbackIndex,
                candleTime: pullbackTime,
                candleTimeUnix: pullbackTimeUnix,
              },
              fibLevel: fibTarget,
              retracementCandles: retraceBars,
              requiredCandles: minCandles,
              fibDepth: fibRange > 0 ? (discoveryHighestSinceLow - pullbackLow) / fibRange : 0,
              requiredFib: minFib,
              startedAt: discoveryLowTime,
              confirmedAt: candle.openTime,
            });

            addEvent(
              candle,
              'TREND_CONFIRMED',
              'Initial Bullish Structure Discovered',
              `Market structure discovered BULLISH from chronological price action: Confirmed HL at ${initialHL.price.toFixed(2)} (locked invalidation) and HH at ${initialHH.price.toFixed(2)}.`,
              {
                price: initialHH.price,
                referencePrice: initialHL.price,
                retracementCandles: retraceBars,
                requiredCandles: minCandles,
                fibDepth: fibRange > 0 ? (discoveryHighestSinceLow - pullbackLow) / fibRange : 0,
                requiredFib: minFib,
              }
            );

            continue;
          }
        }
      }

      // STATE: BULLISH
      else if (structureState === StructureState.BULLISH) {
        // 1. Structure Break Check: Closed candle body-close below active locked HL
        if (activeLockedHL && candle.close < activeLockedHL.price) {
          structureState = StructureState.BULLISH_STRUCTURE_BROKEN;
          candidateType = StructurePointType.PROVISIONAL_LL;
          candidatePrice = candle.low;
          candidateCandleIndex = i;
          candidateCandleTime = candle.openTime;
          candidateCandleTimeUnix = candle.openTimeUnix;
          referencePrice = lastConfirmedHH ? lastConfirmedHH.price : candle.high;
          referenceTime = lastConfirmedHH ? lastConfirmedHH.candleOpenTime : candle.openTime;
          highestHighSinceCandidate = candle.high;
          highestHighCandleIndex = i;
          highestHighCandleTime = candle.openTime;

          addEvent(
            candle,
            'STRUCTURE_BROKEN',
            'Bullish Structure Invalidation',
            `Candle body-closed at ${candle.close.toFixed(2)} below locked HL ${activeLockedHL.price.toFixed(2)}. State transitioned to BULLISH_STRUCTURE_BROKEN (transitioning to bearish).`,
            {
              price: candle.close,
              referencePrice: activeLockedHL.price,
            }
          );
          continue;
        }

        // 2. Start new HH expansion if body-close above lastConfirmedHH
        if (candidateType === null) {
          if (lastConfirmedHH && candle.close > lastConfirmedHH.price) {
            candidateType = StructurePointType.PROVISIONAL_HH;
            candidatePrice = candle.high;
            candidateCandleIndex = i;
            candidateCandleTime = candle.openTime;
            candidateCandleTimeUnix = candle.openTimeUnix;
            referencePrice = activeLockedHL ? activeLockedHL.price : candle.low;
            referenceTime = activeLockedHL ? activeLockedHL.candleOpenTime : candle.openTime;
            lowestLowSinceCandidate = candle.low;
            lowestLowCandleIndex = i;
            lowestLowCandleTime = candle.openTime;

            addEvent(
              candle,
              'CANDIDATE_CREATED',
              'New Bullish Cycle Initiated (Provisional HH)',
              `Candle body-closed at ${candle.close.toFixed(2)} above confirmed HH ${lastConfirmedHH.price.toFixed(2)}. Tracking provisional HH expansion from anchor HL ${referencePrice.toFixed(2)}.`,
              {
                price: candidatePrice,
                referencePrice,
              }
            );
          }
        } else if (candidateType === StructurePointType.PROVISIONAL_HH) {
          // 3. Same-leg extension: higher high extends provisional HH
          if (candle.high > candidatePrice) {
            candidatePrice = candle.high;
            candidateCandleIndex = i;
            candidateCandleTime = candle.openTime;
            candidateCandleTimeUnix = candle.openTimeUnix;
            // Reset retracement tracking from the new peak
            lowestLowSinceCandidate = candle.low;
            lowestLowCandleIndex = i;
            lowestLowCandleTime = candle.openTime;

            addEvent(
              candle,
              'LEG_EXTENDED',
              'Provisional HH Leg Extended',
              `Expansion leg extended to new peak ${candidatePrice.toFixed(2)}. Retracement requirements reset.`,
              {
                price: candidatePrice,
                referencePrice,
              }
            );
          } else {
            // 4. Retracement tracking & qualification
            if (candle.low < lowestLowSinceCandidate) {
              lowestLowSinceCandidate = candle.low;
              lowestLowCandleIndex = i;
              lowestLowCandleTime = candle.openTime;
            }

            const retraceBars = lowestLowCandleIndex - candidateCandleIndex;
            const fibRange = candidatePrice - referencePrice;
            const fibTarget = candidatePrice - minFib * fibRange;
            const actualFibDepth = fibRange > 0 ? (candidatePrice - lowestLowSinceCandidate) / fibRange : 0;
            const isCountQual = retraceBars >= minCandles;
            const isFibQual = lowestLowSinceCandidate <= fibTarget;

            if (isCountQual && isFibQual) {
              const cycleId = `cycle_bull_${cycles.length + 1}`;
              const newHH: StructurePoint = {
                id: `sp_hh_${symbol}_${candidateCandleTimeUnix}_V3`,
                symbol,
                timeframe,
                candleOpenTime: candidateCandleTime,
                candleOpenTimeUnix: candidateCandleTimeUnix,
                type: StructurePointType.HH,
                price: candidatePrice,
                strength: StructureStrength.MAJOR,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: candidateCandleIndex,
                cycleId,
                previousStructurePointId: activeLockedHL ? activeLockedHL.id : null,
                trendState: StructureState.BULLISH,
                confirmationReason: `Body-close broke previous HH, retraced ${retraceBars} bars (>=${minCandles}) and ${(actualFibDepth * 100).toFixed(1)}% Fib (>=${(minFib * 100).toFixed(1)}%)`,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              const newHL: StructurePoint = {
                id: `sp_hl_${symbol}_${workingSet[lowestLowCandleIndex].openTimeUnix}_V3`,
                symbol,
                timeframe,
                candleOpenTime: lowestLowCandleTime,
                candleOpenTimeUnix: workingSet[lowestLowCandleIndex].openTimeUnix,
                type: StructurePointType.HL,
                price: lowestLowSinceCandidate,
                strength: StructureStrength.MAJOR,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: lowestLowCandleIndex,
                cycleId,
                previousStructurePointId: newHH.id,
                trendState: StructureState.BULLISH,
                confirmationReason: `Locked HL confirmed at qualifying retracement trough of ${newHH.price.toFixed(2)}`,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              points.push(newHH, newHL);
              lastConfirmedHH = newHH;
              activeLockedHL = newHL; // HL IS NOW LOCKED!

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
                  type: StructurePointType.HH,
                  price: newHH.price,
                  candleIndex: newHH.candleIndex ?? candidateCandleIndex,
                  candleTime: newHH.candleOpenTime,
                  candleTimeUnix: newHH.candleOpenTimeUnix,
                },
                retracementExtreme: {
                  type: StructurePointType.HL,
                  price: newHL.price,
                  candleIndex: newHL.candleIndex ?? lowestLowCandleIndex,
                  candleTime: newHL.candleOpenTime,
                  candleTimeUnix: newHL.candleOpenTimeUnix,
                },
                fibLevel: fibTarget,
                retracementCandles: retraceBars,
                requiredCandles: minCandles,
                fibDepth: actualFibDepth,
                requiredFib: minFib,
                startedAt: candidateCandleTime,
                confirmedAt: candle.openTime,
              });

              addEvent(
                candle,
                'STRUCTURE_CONFIRMED',
                'Bullish Cycle Confirmed: Invalidation Point Rolled Forward',
                `Confirmed HH at ${newHH.price.toFixed(2)} and new LOCKED HL at ${newHL.price.toFixed(2)}. Invalidation rolled forward to ${newHL.price.toFixed(2)}.`,
                {
                  price: newHH.price,
                  referencePrice: newHL.price,
                  retracementCandles: retraceBars,
                  requiredCandles: minCandles,
                  fibDepth: actualFibDepth,
                  requiredFib: minFib,
                }
              );

              candidateType = null;
            }
          }
        }
      }

      // STATE: BULLISH_STRUCTURE_BROKEN (Transition to Bearish)
      else if (structureState === StructureState.BULLISH_STRUCTURE_BROKEN) {
        // Abort transition if price closes back above lastConfirmedHH
        if (lastConfirmedHH && candle.close > lastConfirmedHH.price) {
          structureState = StructureState.BULLISH;
          candidateType = null;
          addEvent(
            candle,
            'TREND_CONFIRMED',
            'Bullish Structure Restored',
            `Candle body-closed at ${candle.close.toFixed(2)} back above ${lastConfirmedHH.price.toFixed(2)}. Bearish transition aborted; bullish structure restored.`,
            {
              price: candle.close,
              referencePrice: lastConfirmedHH.price,
            }
          );
          continue;
        }

        // Track candidate LL downward
        if (candle.low < candidatePrice) {
          candidatePrice = candle.low;
          candidateCandleIndex = i;
          candidateCandleTime = candle.openTime;
          candidateCandleTimeUnix = candle.openTimeUnix;
          highestHighSinceCandidate = candle.high;
          highestHighCandleIndex = i;
          highestHighCandleTime = candle.openTime;

          addEvent(
            candle,
            'LEG_EXTENDED',
            'Candidate LL Extended Downward',
            `Bearish expansion leg extended downward to ${candidatePrice.toFixed(2)}.`,
            {
              price: candidatePrice,
              referencePrice,
            }
          );
        } else {
          if (candle.high > highestHighSinceCandidate) {
            highestHighSinceCandidate = candle.high;
            highestHighCandleIndex = i;
            highestHighCandleTime = candle.openTime;
          }

          const retraceBars = highestHighCandleIndex - candidateCandleIndex;
          const fibRange = referencePrice - candidatePrice;
          const fibTarget = candidatePrice + minFib * fibRange;
          const actualFibDepth = fibRange > 0 ? (highestHighSinceCandidate - candidatePrice) / fibRange : 0;
          const isCountQual = retraceBars >= minCandles;
          const isFibQual = highestHighSinceCandidate >= fibTarget;

          if (isCountQual && isFibQual) {
            const cycleId = `cycle_bear_${cycles.length + 1}`;
            const newLL: StructurePoint = {
              id: `sp_ll_${symbol}_${candidateCandleTimeUnix}_V3`,
              symbol,
              timeframe,
              candleOpenTime: candidateCandleTime,
              candleOpenTimeUnix: candidateCandleTimeUnix,
              type: StructurePointType.LL,
              price: candidatePrice,
              strength: StructureStrength.MAJOR,
              algorithmVersion: CURRENT_ALGORITHM_VERSION,
              candleIndex: candidateCandleIndex,
              cycleId,
              previousStructurePointId: activeLockedHL ? activeLockedHL.id : null,
              trendState: StructureState.BEARISH,
              confirmationReason: `Break of bullish HL confirmed with new LL and qualifying retracement (${retraceBars} bars, ${(actualFibDepth * 100).toFixed(1)}% Fib)`,
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };

            const newLH: StructurePoint = {
              id: `sp_lh_${symbol}_${workingSet[highestHighCandleIndex].openTimeUnix}_V3`,
              symbol,
              timeframe,
              candleOpenTime: highestHighCandleTime,
              candleOpenTimeUnix: workingSet[highestHighCandleIndex].openTimeUnix,
              type: StructurePointType.LH,
              price: highestHighSinceCandidate,
              strength: StructureStrength.MAJOR,
              algorithmVersion: CURRENT_ALGORITHM_VERSION,
              candleIndex: highestHighCandleIndex,
              cycleId,
              previousStructurePointId: newLL.id,
              trendState: StructureState.BEARISH,
              confirmationReason: `Locked LH confirmed at qualifying bounce peak of ${newLL.price.toFixed(2)}`,
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };

            points.push(newLL, newLH);
            lastConfirmedLL = newLL;
            activeLockedLH = newLH; // LH IS NOW LOCKED!
            activeLockedHL = null;
            structureState = StructureState.BEARISH;
            candidateType = null;

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
                type: StructurePointType.LL,
                price: newLL.price,
                candleIndex: newLL.candleIndex ?? candidateCandleIndex,
                candleTime: newLL.candleOpenTime,
                candleTimeUnix: newLL.candleOpenTimeUnix,
              },
              retracementExtreme: {
                type: StructurePointType.LH,
                price: newLH.price,
                candleIndex: newLH.candleIndex ?? highestHighCandleIndex,
                candleTime: newLH.candleOpenTime,
                candleTimeUnix: newLH.candleOpenTimeUnix,
              },
              fibLevel: fibTarget,
              retracementCandles: retraceBars,
              requiredCandles: minCandles,
              fibDepth: actualFibDepth,
              requiredFib: minFib,
              startedAt: candidateCandleTime,
              confirmedAt: candle.openTime,
            });

            addEvent(
              candle,
              'TREND_CONFIRMED',
              'Bearish Trend Confirmed',
              `Trend confirmed BEARISH: Confirmed LL at ${newLL.price.toFixed(2)} and new LOCKED LH at ${newLH.price.toFixed(2)}. Invalidation set to ${newLH.price.toFixed(2)}.`,
              {
                price: newLL.price,
                referencePrice: newLH.price,
                retracementCandles: retraceBars,
                requiredCandles: minCandles,
                fibDepth: actualFibDepth,
                requiredFib: minFib,
              }
            );
          }
        }
      }

      // STATE: BEARISH
      else if (structureState === StructureState.BEARISH) {
        // 1. Structure Break Check: Closed candle body-close above active locked LH
        if (activeLockedLH && candle.close > activeLockedLH.price) {
          structureState = StructureState.BEARISH_STRUCTURE_BROKEN;
          candidateType = StructurePointType.PROVISIONAL_HH;
          candidatePrice = candle.high;
          candidateCandleIndex = i;
          candidateCandleTime = candle.openTime;
          candidateCandleTimeUnix = candle.openTimeUnix;
          referencePrice = lastConfirmedLL ? lastConfirmedLL.price : candle.low;
          referenceTime = lastConfirmedLL ? lastConfirmedLL.candleOpenTime : candle.openTime;
          lowestLowSinceCandidate = candle.low;
          lowestLowCandleIndex = i;
          lowestLowCandleTime = candle.openTime;

          addEvent(
            candle,
            'STRUCTURE_BROKEN',
            'Bearish Structure Invalidation',
            `Candle body-closed at ${candle.close.toFixed(2)} above locked LH ${activeLockedLH.price.toFixed(2)}. State transitioned to BEARISH_STRUCTURE_BROKEN (transitioning to bullish).`,
            {
              price: candle.close,
              referencePrice: activeLockedLH.price,
            }
          );
          continue;
        }

        // 2. Start new LL expansion if body-close below lastConfirmedLL
        if (candidateType === null) {
          if (lastConfirmedLL && candle.close < lastConfirmedLL.price) {
            candidateType = StructurePointType.PROVISIONAL_LL;
            candidatePrice = candle.low;
            candidateCandleIndex = i;
            candidateCandleTime = candle.openTime;
            candidateCandleTimeUnix = candle.openTimeUnix;
            referencePrice = activeLockedLH ? activeLockedLH.price : candle.high;
            referenceTime = activeLockedLH ? activeLockedLH.candleOpenTime : candle.openTime;
            highestHighSinceCandidate = candle.high;
            highestHighCandleIndex = i;
            highestHighCandleTime = candle.openTime;

            addEvent(
              candle,
              'CANDIDATE_CREATED',
              'New Bearish Cycle Initiated (Provisional LL)',
              `Candle body-closed at ${candle.close.toFixed(2)} below confirmed LL ${lastConfirmedLL.price.toFixed(2)}. Tracking provisional LL expansion from anchor LH ${referencePrice.toFixed(2)}.`,
              {
                price: candidatePrice,
                referencePrice,
              }
            );
          }
        } else if (candidateType === StructurePointType.PROVISIONAL_LL) {
          // 3. Same-leg extension: lower low extends provisional LL
          if (candle.low < candidatePrice) {
            candidatePrice = candle.low;
            candidateCandleIndex = i;
            candidateCandleTime = candle.openTime;
            candidateCandleTimeUnix = candle.openTimeUnix;
            // Reset retracement tracking from the new trough
            highestHighSinceCandidate = candle.high;
            highestHighCandleIndex = i;
            highestHighCandleTime = candle.openTime;

            addEvent(
              candle,
              'LEG_EXTENDED',
              'Provisional LL Leg Extended',
              `Expansion leg extended to new trough ${candidatePrice.toFixed(2)}. Retracement requirements reset.`,
              {
                price: candidatePrice,
                referencePrice,
              }
            );
          } else {
            // 4. Retracement tracking & qualification
            if (candle.high > highestHighSinceCandidate) {
              highestHighSinceCandidate = candle.high;
              highestHighCandleIndex = i;
              highestHighCandleTime = candle.openTime;
            }

            const retraceBars = highestHighCandleIndex - candidateCandleIndex;
            const fibRange = referencePrice - candidatePrice;
            const fibTarget = candidatePrice + minFib * fibRange;
            const actualFibDepth = fibRange > 0 ? (highestHighSinceCandidate - candidatePrice) / fibRange : 0;
            const isCountQual = retraceBars >= minCandles;
            const isFibQual = highestHighSinceCandidate >= fibTarget;

            if (isCountQual && isFibQual) {
              const cycleId = `cycle_bear_${cycles.length + 1}`;
              const newLL: StructurePoint = {
                id: `sp_ll_${symbol}_${candidateCandleTimeUnix}_V3`,
                symbol,
                timeframe,
                candleOpenTime: candidateCandleTime,
                candleOpenTimeUnix: candidateCandleTimeUnix,
                type: StructurePointType.LL,
                price: candidatePrice,
                strength: StructureStrength.MAJOR,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: candidateCandleIndex,
                cycleId,
                previousStructurePointId: activeLockedLH ? activeLockedLH.id : null,
                trendState: StructureState.BEARISH,
                confirmationReason: `Body-close broke previous LL, retraced ${retraceBars} bars (>=${minCandles}) and ${(actualFibDepth * 100).toFixed(1)}% Fib (>=${(minFib * 100).toFixed(1)}%)`,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              const newLH: StructurePoint = {
                id: `sp_lh_${symbol}_${workingSet[highestHighCandleIndex].openTimeUnix}_V3`,
                symbol,
                timeframe,
                candleOpenTime: highestHighCandleTime,
                candleOpenTimeUnix: workingSet[highestHighCandleIndex].openTimeUnix,
                type: StructurePointType.LH,
                price: highestHighSinceCandidate,
                strength: StructureStrength.MAJOR,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: highestHighCandleIndex,
                cycleId,
                previousStructurePointId: newLL.id,
                trendState: StructureState.BEARISH,
                confirmationReason: `Locked LH confirmed at qualifying retracement peak of ${newLL.price.toFixed(2)}`,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              points.push(newLL, newLH);
              lastConfirmedLL = newLL;
              activeLockedLH = newLH; // LH IS NOW LOCKED!

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
                  type: StructurePointType.LL,
                  price: newLL.price,
                  candleIndex: newLL.candleIndex ?? candidateCandleIndex,
                  candleTime: newLL.candleOpenTime,
                  candleTimeUnix: newLL.candleOpenTimeUnix,
                },
                retracementExtreme: {
                  type: StructurePointType.LH,
                  price: newLH.price,
                  candleIndex: newLH.candleIndex ?? highestHighCandleIndex,
                  candleTime: newLH.candleOpenTime,
                  candleTimeUnix: newLH.candleOpenTimeUnix,
                },
                fibLevel: fibTarget,
                retracementCandles: retraceBars,
                requiredCandles: minCandles,
                fibDepth: actualFibDepth,
                requiredFib: minFib,
                startedAt: candidateCandleTime,
                confirmedAt: candle.openTime,
              });

              addEvent(
                candle,
                'STRUCTURE_CONFIRMED',
                'Bearish Cycle Confirmed: Invalidation Point Rolled Forward',
                `Confirmed LL at ${newLL.price.toFixed(2)} and new LOCKED LH at ${newLH.price.toFixed(2)}. Invalidation rolled forward to ${newLH.price.toFixed(2)}.`,
                {
                  price: newLL.price,
                  referencePrice: newLH.price,
                  retracementCandles: retraceBars,
                  requiredCandles: minCandles,
                  fibDepth: actualFibDepth,
                  requiredFib: minFib,
                }
              );

              candidateType = null;
            }
          }
        }
      }

      // STATE: BEARISH_STRUCTURE_BROKEN (Transition to Bullish)
      else if (structureState === StructureState.BEARISH_STRUCTURE_BROKEN) {
        // Abort transition if price closes back below lastConfirmedLL
        if (lastConfirmedLL && candle.close < lastConfirmedLL.price) {
          structureState = StructureState.BEARISH;
          candidateType = null;
          addEvent(
            candle,
            'TREND_CONFIRMED',
            'Bearish Structure Restored',
            `Candle body-closed at ${candle.close.toFixed(2)} back below ${lastConfirmedLL.price.toFixed(2)}. Bullish transition aborted; bearish structure restored.`,
            {
              price: candle.close,
              referencePrice: lastConfirmedLL.price,
            }
          );
          continue;
        }

        // Track candidate HH upward
        if (candle.high > candidatePrice) {
          candidatePrice = candle.high;
          candidateCandleIndex = i;
          candidateCandleTime = candle.openTime;
          candidateCandleTimeUnix = candle.openTimeUnix;
          lowestLowSinceCandidate = candle.low;
          lowestLowCandleIndex = i;
          lowestLowCandleTime = candle.openTime;

          addEvent(
            candle,
            'LEG_EXTENDED',
            'Candidate HH Extended Upward',
            `Bullish expansion leg extended upward to ${candidatePrice.toFixed(2)}.`,
            {
              price: candidatePrice,
              referencePrice,
            }
          );
        } else {
          if (candle.low < lowestLowSinceCandidate) {
            lowestLowSinceCandidate = candle.low;
            lowestLowCandleIndex = i;
            lowestLowCandleTime = candle.openTime;
          }

          const retraceBars = lowestLowCandleIndex - candidateCandleIndex;
          const fibRange = candidatePrice - referencePrice;
          const fibTarget = candidatePrice - minFib * fibRange;
          const actualFibDepth = fibRange > 0 ? (candidatePrice - lowestLowSinceCandidate) / fibRange : 0;
          const isCountQual = retraceBars >= minCandles;
          const isFibQual = lowestLowSinceCandidate <= fibTarget;

          if (isCountQual && isFibQual) {
            const cycleId = `cycle_bull_${cycles.length + 1}`;
            const newHH: StructurePoint = {
              id: `sp_hh_${symbol}_${candidateCandleTimeUnix}_V3`,
              symbol,
              timeframe,
              candleOpenTime: candidateCandleTime,
              candleOpenTimeUnix: candidateCandleTimeUnix,
              type: StructurePointType.HH,
              price: candidatePrice,
              strength: StructureStrength.MAJOR,
              algorithmVersion: CURRENT_ALGORITHM_VERSION,
              candleIndex: candidateCandleIndex,
              cycleId,
              previousStructurePointId: activeLockedLH ? activeLockedLH.id : null,
              trendState: StructureState.BULLISH,
              confirmationReason: `Break of bearish LH confirmed with new HH and qualifying retracement (${retraceBars} bars, ${(actualFibDepth * 100).toFixed(1)}% Fib)`,
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };

            const newHL: StructurePoint = {
              id: `sp_hl_${symbol}_${workingSet[lowestLowCandleIndex].openTimeUnix}_V3`,
              symbol,
              timeframe,
              candleOpenTime: lowestLowCandleTime,
              candleOpenTimeUnix: workingSet[lowestLowCandleIndex].openTimeUnix,
              type: StructurePointType.HL,
              price: lowestLowSinceCandidate,
              strength: StructureStrength.MAJOR,
              algorithmVersion: CURRENT_ALGORITHM_VERSION,
              candleIndex: lowestLowCandleIndex,
              cycleId,
              previousStructurePointId: newHH.id,
              trendState: StructureState.BULLISH,
              confirmationReason: `Locked HL confirmed at qualifying pullback trough of ${newHH.price.toFixed(2)}`,
              detectedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };

            points.push(newHH, newHL);
            lastConfirmedHH = newHH;
            activeLockedHL = newHL; // HL IS NOW LOCKED!
            activeLockedLH = null;
            structureState = StructureState.BULLISH;
            candidateType = null;

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
                type: StructurePointType.HH,
                price: newHH.price,
                candleIndex: newHH.candleIndex ?? candidateCandleIndex,
                candleTime: newHH.candleOpenTime,
                candleTimeUnix: newHH.candleOpenTimeUnix,
              },
              retracementExtreme: {
                type: StructurePointType.HL,
                price: newHL.price,
                candleIndex: newHL.candleIndex ?? lowestLowCandleIndex,
                candleTime: newHL.candleOpenTime,
                candleTimeUnix: newHL.candleOpenTimeUnix,
              },
              fibLevel: fibTarget,
              retracementCandles: retraceBars,
              requiredCandles: minCandles,
              fibDepth: actualFibDepth,
              requiredFib: minFib,
              startedAt: candidateCandleTime,
              confirmedAt: candle.openTime,
            });

            addEvent(
              candle,
              'TREND_CONFIRMED',
              'Bullish Trend Confirmed',
              `Trend confirmed BULLISH: Confirmed HH at ${newHH.price.toFixed(2)} and new LOCKED HL at ${newHL.price.toFixed(2)}. Invalidation set to ${newHL.price.toFixed(2)}.`,
              {
                price: newHH.price,
                referencePrice: newHL.price,
                retracementCandles: retraceBars,
                requiredCandles: minCandles,
                fibDepth: actualFibDepth,
                requiredFib: minFib,
              }
            );
          }
        }
      }
    }

    // 4. Construct Active Retracement Inspection State
    let activeRetracement: ActiveRetracementInfo | null = null;
    let activeProvisionalPoint: StructurePoint | null = null;

    if (candidateType !== null) {
      const isBullishCand = candidateType === StructurePointType.PROVISIONAL_HH;
      const retracementBars = isBullishCand
        ? lowestLowCandleIndex - candidateCandleIndex
        : highestHighCandleIndex - candidateCandleIndex;

      const fibRange = isBullishCand
        ? candidatePrice - referencePrice
        : referencePrice - candidatePrice;

      const fibTargetPrice = isBullishCand
        ? candidatePrice - minFib * fibRange
        : candidatePrice + minFib * fibRange;

      const extremeRetracementPrice = isBullishCand ? lowestLowSinceCandidate : highestHighSinceCandidate;
      const actualFibDepth =
        fibRange > 0
          ? isBullishCand
            ? (candidatePrice - lowestLowSinceCandidate) / fibRange
            : (highestHighSinceCandidate - candidatePrice) / fibRange
          : 0;

      const isCountQual = retracementBars >= minCandles;
      const isFibQual = isBullishCand
        ? lowestLowSinceCandidate <= fibTargetPrice
        : highestHighSinceCandidate >= fibTargetPrice;

      activeRetracement = {
        state: structureState,
        candidateType,
        candidatePrice,
        candidateTime: candidateCandleTime,
        candidateTimeUnix: candidateCandleTimeUnix,
        candidateCandleIndex,
        referencePrice,
        referenceTime,
        fibLevelPrice: fibTargetPrice,
        fibRatio: minFib,
        currentRetracementCandles: Math.max(0, retracementBars),
        requiredRetracementCandles: minCandles,
        isCandleCountQualified: isCountQual,
        currentRetracementPrice: extremeRetracementPrice,
        currentFibDepth: Math.max(0, actualFibDepth),
        isFibDepthQualified: isFibQual,
        isFullyQualified: isCountQual && isFibQual,
        bestRetracementCandleTime: isBullishCand ? lowestLowCandleTime : highestHighCandleTime,
      };

      activeProvisionalPoint = {
        id: `sp_prov_${symbol}_${candidateCandleTimeUnix}_V3`,
        symbol,
        timeframe,
        candleOpenTime: candidateCandleTime,
        candleOpenTimeUnix: candidateCandleTimeUnix,
        type: candidateType,
        price: candidatePrice,
        strength: StructureStrength.MINOR,
        algorithmVersion: CURRENT_ALGORITHM_VERSION,
        candleIndex: candidateCandleIndex,
        isProvisional: true,
        retracementCandles: Math.max(0, retracementBars),
        retracementFibDepth: Math.max(0, actualFibDepth),
        fibPriceLevel: fibTargetPrice,
        detectedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
    }

    // 5. Sort points chronologically
    points.sort((a, b) => a.candleOpenTimeUnix - b.candleOpenTimeUnix);

    const hhCount = points.filter((p) => p.type === StructurePointType.HH).length;
    const hlCount = points.filter((p) => p.type === StructurePointType.HL).length;
    const llCount = points.filter((p) => p.type === StructurePointType.LL).length;
    const lhCount = points.filter((p) => p.type === StructurePointType.LH).length;

    // Active Structure Levels:
    // When bullish: show ONLY active locked HL Invalidation and relevant confirmed HH. Do NOT show stale LH/LL lines!
    // When bearish: show ONLY active locked LH Invalidation and relevant confirmed LL. Do NOT show stale HL/HH lines!
    const isBullishMode =
      structureState === StructureState.BULLISH || structureState === StructureState.BULLISH_STRUCTURE_BROKEN;
    const isBearishMode =
      structureState === StructureState.BEARISH || structureState === StructureState.BEARISH_STRUCTURE_BROKEN;

    const activeHL = isBullishMode ? activeLockedHL : null;
    const activeHH = isBullishMode ? lastConfirmedHH : null;
    const activeLH = isBearishMode ? activeLockedLH : null;
    const activeLL = isBearishMode ? lastConfirmedLL : null;

    // Optional legacy pivot comparison
    let legacyPoints: StructurePoint[] | undefined;
    if (params.legacyPivotOverlay) {
      legacyPoints = this.detectLegacyPivots(workingSet, params);
    }

    const stateLabels: Record<StructureState, string> = {
      [StructureState.UNDEFINED]: 'UNDEFINED',
      [StructureState.BULLISH]: 'BULLISH',
      [StructureState.BULLISH_STRUCTURE_BROKEN]: 'BULLISH STRUCTURE BROKEN (TRANSITION TO BEARISH)',
      [StructureState.BEARISH]: 'BEARISH',
      [StructureState.BEARISH_STRUCTURE_BROKEN]: 'BEARISH STRUCTURE BROKEN (TRANSITION TO BULLISH)',
    };

    const executionTimeMs = Date.now() - startTime;

    return {
      symbol,
      timeframe,
      algorithmVersion: ALGORITHM_VERSION_V3,
      parameters: params,
      structureState,
      stateLabel: stateLabels[structureState] || structureState,
      totalCandlesAvailable,
      closedCandlesEvaluated: workingSet.length,
      unclosedCandleExcluded,
      workingWindowStart: workingSet[0]?.openTime || null,
      workingWindowEnd: workingSet[workingSet.length - 1]?.openTime || null,
      hhCount,
      hlCount,
      llCount,
      lhCount,
      provisionalCount: activeProvisionalPoint ? 1 : 0,
      totalPointsCount: points.length + (activeProvisionalPoint ? 1 : 0),
      lastHH: activeHH,
      lastHL: activeHL,
      lastLL: activeLL,
      lastLH: activeLH,
      lastConfirmedHH,
      lastConfirmedHL: activeLockedHL,
      lastConfirmedLL,
      lastConfirmedLH: activeLockedLH,
      activeProvisionalPoint,
      cycles,
      activeCycle: cycles.length > 0 ? cycles[cycles.length - 1] : null,
      showProvisionalStructure: params.showProvisionalStructure,
      activeRetracement,
      points,
      legacyPoints,
      eventLogs: eventLogs.slice(-50),
      executionTimeMs,
      detectedAt: new Date().toISOString(),
    };
  }

  /**
   * STRUCTURE_V2_RETRACEMENT (Legacy Engine preserved for side-by-side verification)
   */
  public detectStructureV2(
    candles: NormalizedMarketCandle[],
    customParams?: Partial<StructureParameters>
  ): StructureDetectionResult {
    const startTime = Date.now();

    const minCandles = Math.max(1, Math.min(20, customParams?.minimumRetracementCandles ?? 4));
    const minFib = Math.max(0.1, Math.min(1.0, customParams?.minimumRetracementFib ?? 0.382));
    const lookback = customParams?.lookbackCandles ?? STRUCTURE_LOOKBACK_CANDLES;

    const params: StructureParameters = {
      minimumRetracementCandles: minCandles,
      minimumRetracementFib: minFib,
      breakConfirmation: 'CLOSE',
      fibTouchMode: 'WICK',
      lookbackCandles: lookback,
      legacyPivotOverlay: customParams?.legacyPivotOverlay ?? false,
      pivotLeftBars: customParams?.pivotLeftBars ?? 2,
      pivotRightBars: customParams?.pivotRightBars ?? 2,
      equalityMode: 'STRICT',
      initialSeed: customParams?.initialSeed,
    };

    const symbol = candles[0]?.symbol || 'UNKNOWN';
    const timeframe = candles[0]?.timeframe || '5M';

    // 1. Filter strictly closed candles
    const totalCandlesAvailable = candles.length;
    const closedCandles = candles.filter((c) => c.isClosed);
    const unclosedCandleExcluded = candles.some((c) => !c.isClosed);

    // 2. Truncate to lookback window
    const workingSet =
      params.lookbackCandles > 0 && closedCandles.length > params.lookbackCandles
        ? closedCandles.slice(closedCandles.length - params.lookbackCandles)
        : closedCandles;

    const points: StructurePoint[] = [];
    const eventLogs: StructureEventLogItem[] = [];

    // State machine trackers
    let structureState: StructureState = StructureState.UNDEFINED;
    let confirmedHL: StructurePoint | null = null;
    let confirmedHH: StructurePoint | null = null;
    let confirmedLH: StructurePoint | null = null;
    let confirmedLL: StructurePoint | null = null;

    // Active candidate expansion/retracement tracker
    let candidateType: StructurePointType.PROVISIONAL_HH | StructurePointType.PROVISIONAL_LL | null = null;
    let candidatePrice: number = 0;
    let candidateCandleIndex: number = -1;
    let candidateCandleTime: string = '';
    let candidateCandleTimeUnix: number = 0;
    let referencePrice: number = 0;
    let referenceTime: string = '';

    // Retracement extremes
    let lowestLowSinceCandidate: number = Infinity;
    let lowestLowCandleIndex: number = -1;
    let lowestLowCandleTime: string = '';

    let highestHighSinceCandidate: number = -Infinity;
    let highestHighCandleIndex: number = -1;
    let highestHighCandleTime: string = '';

    // Helper: add event log
    const addEvent = (
      candle: NormalizedMarketCandle,
      eventType: StructureEventLogItem['eventType'],
      title: string,
      message: string,
      details?: StructureEventLogItem['details']
    ) => {
      eventLogs.push({
        id: `ev_${candle.openTimeUnix}_${eventLogs.length}`,
        candleTime: candle.openTime,
        candleTimeUnix: candle.openTimeUnix,
        eventType,
        title,
        message,
        details,
      });
    };

    // Apply seed if provided
    if (params.initialSeed) {
      structureState = params.initialSeed.state;
      if (params.initialSeed.confirmedHL) {
        const c = params.initialSeed.confirmedHL;
        confirmedHL = {
          id: `seed_hl_${symbol}_${c.price}`,
          symbol,
          timeframe,
          candleOpenTime: c.time || workingSet[0]?.openTime || new Date().toISOString(),
          candleOpenTimeUnix: workingSet[0]?.openTimeUnix || Date.now(),
          type: StructurePointType.HL,
          price: c.price,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: c.candleIndex ?? 0,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        points.push(confirmedHL);
      }
      if (params.initialSeed.confirmedHH) {
        const c = params.initialSeed.confirmedHH;
        confirmedHH = {
          id: `seed_hh_${symbol}_${c.price}`,
          symbol,
          timeframe,
          candleOpenTime: c.time || workingSet[0]?.openTime || new Date().toISOString(),
          candleOpenTimeUnix: workingSet[0]?.openTimeUnix || Date.now(),
          type: StructurePointType.HH,
          price: c.price,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: c.candleIndex ?? 0,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        points.push(confirmedHH);
      }
      if (params.initialSeed.confirmedLH) {
        const c = params.initialSeed.confirmedLH;
        confirmedLH = {
          id: `seed_lh_${symbol}_${c.price}`,
          symbol,
          timeframe,
          candleOpenTime: c.time || workingSet[0]?.openTime || new Date().toISOString(),
          candleOpenTimeUnix: workingSet[0]?.openTimeUnix || Date.now(),
          type: StructurePointType.LH,
          price: c.price,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: c.candleIndex ?? 0,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        points.push(confirmedLH);
      }
      if (params.initialSeed.confirmedLL) {
        const c = params.initialSeed.confirmedLL;
        confirmedLL = {
          id: `seed_ll_${symbol}_${c.price}`,
          symbol,
          timeframe,
          candleOpenTime: c.time || workingSet[0]?.openTime || new Date().toISOString(),
          candleOpenTimeUnix: workingSet[0]?.openTimeUnix || Date.now(),
          type: StructurePointType.LL,
          price: c.price,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: c.candleIndex ?? 0,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        points.push(confirmedLL);
      }
    }

    // 3. Chronological Candle-by-Candle Processing
    const len = workingSet.length;
    let seedStartIndex = 0;

    // If still UNDEFINED and no seed provided, bootstrap from earliest candles
    if (structureState === StructureState.UNDEFINED && len >= 4) {
      // Find initial trend in earliest window (first 25 candles or half len)
      const bootstrapWindow = Math.min(len, 25);
      let minBar = 0;
      let maxBar = 0;
      for (let b = 1; b < bootstrapWindow; b++) {
        if (workingSet[b].low < workingSet[minBar].low) minBar = b;
        if (workingSet[b].high > workingSet[maxBar].high) maxBar = b;
      }

      if (maxBar > minBar) {
        // Bullish initial setup
        structureState = StructureState.BULLISH;
        confirmedHL = {
          id: `sp_hl_${symbol}_${workingSet[minBar].openTimeUnix}_V2`,
          symbol,
          timeframe,
          candleOpenTime: workingSet[minBar].openTime,
          candleOpenTimeUnix: workingSet[minBar].openTimeUnix,
          type: StructurePointType.HL,
          price: workingSet[minBar].low,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: minBar,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        confirmedHH = {
          id: `sp_hh_${symbol}_${workingSet[maxBar].openTimeUnix}_V2`,
          symbol,
          timeframe,
          candleOpenTime: workingSet[maxBar].openTime,
          candleOpenTimeUnix: workingSet[maxBar].openTimeUnix,
          type: StructurePointType.HH,
          price: workingSet[maxBar].high,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: maxBar,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        points.push(confirmedHL, confirmedHH);
        seedStartIndex = maxBar + 1;
        addEvent(
          workingSet[maxBar],
          'INFO',
          'Initial Bullish Baseline Seeded',
          `Seeded initial HL at ${confirmedHL.price.toFixed(2)} and initial HH at ${confirmedHH.price.toFixed(2)}.`
        );
      } else if (minBar > maxBar) {
        // Bearish initial setup
        structureState = StructureState.BEARISH;
        confirmedLH = {
          id: `sp_lh_${symbol}_${workingSet[maxBar].openTimeUnix}_V2`,
          symbol,
          timeframe,
          candleOpenTime: workingSet[maxBar].openTime,
          candleOpenTimeUnix: workingSet[maxBar].openTimeUnix,
          type: StructurePointType.LH,
          price: workingSet[maxBar].high,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: maxBar,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        confirmedLL = {
          id: `sp_ll_${symbol}_${workingSet[minBar].openTimeUnix}_V2`,
          symbol,
          timeframe,
          candleOpenTime: workingSet[minBar].openTime,
          candleOpenTimeUnix: workingSet[minBar].openTimeUnix,
          type: StructurePointType.LL,
          price: workingSet[minBar].low,
          strength: StructureStrength.MAJOR,
          algorithmVersion: CURRENT_ALGORITHM_VERSION,
          candleIndex: minBar,
          detectedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        points.push(confirmedLH, confirmedLL);
        seedStartIndex = minBar + 1;
        addEvent(
          workingSet[minBar],
          'INFO',
          'Initial Bearish Baseline Seeded',
          `Seeded initial LH at ${confirmedLH.price.toFixed(2)} and initial LL at ${confirmedLL.price.toFixed(2)}.`
        );
      }
    }

    // Step through each candle chronologically
    for (let i = seedStartIndex; i < len; i++) {
      const candle = workingSet[i];

      // ==========================================
      // STATE 1: BULLISH
      // ==========================================
      if (structureState === StructureState.BULLISH) {
        // Condition A: Bullish Structure Break (Strict Body Close Rule)
        if (confirmedHL && candle.close < confirmedHL.price) {
          structureState = StructureState.BULLISH_STRUCTURE_BROKEN;
          addEvent(
            candle,
            'STRUCTURE_BROKEN',
            'Bullish Structure Broken',
            `Candle closed at ${candle.close.toFixed(2)} below previous HL (${confirmedHL.price.toFixed(2)}). Transition to bearish initiated.`,
            { price: candle.close, referencePrice: confirmedHL.price }
          );

          // The breakdown initiates candidate LL tracking downward
          candidateType = StructurePointType.PROVISIONAL_LL;
          candidatePrice = candle.low;
          candidateCandleIndex = i;
          candidateCandleTime = candle.openTime;
          candidateCandleTimeUnix = candle.openTimeUnix;
          referencePrice = confirmedHH ? confirmedHH.price : candle.high;
          referenceTime = confirmedHH ? confirmedHH.candleOpenTime : candle.openTime;

          highestHighSinceCandidate = candle.high;
          highestHighCandleIndex = i;
          highestHighCandleTime = candle.openTime;
          continue;
        }

        // Condition B: Bullish Continuation & Candidate HH Tracking
        if (candidateType === null) {
          // Check if candidate new HH is eligible: requires CLOSED candle close > previous valid HH
          if (confirmedHH && candle.close > confirmedHH.price) {
            candidateType = StructurePointType.PROVISIONAL_HH;
            candidatePrice = candle.high;
            candidateCandleIndex = i;
            candidateCandleTime = candle.openTime;
            candidateCandleTimeUnix = candle.openTimeUnix;
            referencePrice = confirmedHL ? confirmedHL.price : candle.low;
            referenceTime = confirmedHL ? confirmedHL.candleOpenTime : candle.openTime;

            lowestLowSinceCandidate = candle.low;
            lowestLowCandleIndex = i;
            lowestLowCandleTime = candle.openTime;

            addEvent(
              candle,
              'CANDIDATE_CREATED',
              'Candidate HH Formed',
              `Candle close ${candle.close.toFixed(2)} broke previous HH (${confirmedHH.price.toFixed(2)}). Tracking candidate HH at ${candidatePrice.toFixed(2)}.`,
              { price: candidatePrice, referencePrice }
            );
          }
        } else if (candidateType === StructurePointType.PROVISIONAL_HH) {
          // We are currently tracking a candidate HH
          if (candle.high > candidatePrice) {
            // Same-Leg Extension: Higher high formed before retracement qualified
            candidatePrice = candle.high;
            candidateCandleIndex = i;
            candidateCandleTime = candle.openTime;
            candidateCandleTimeUnix = candle.openTimeUnix;

            // Reset retracement tracking from the new peak
            lowestLowSinceCandidate = candle.low;
            lowestLowCandleIndex = i;
            lowestLowCandleTime = candle.openTime;

            addEvent(
              candle,
              'LEG_EXTENDED',
              'Bullish Expansion Extended',
              `Higher high reached at ${candidatePrice.toFixed(2)} without qualified retracement. Provisional HH updated.`,
              { price: candidatePrice, referencePrice }
            );
          } else {
            // Price is retracing from candidate HH
            if (candle.low < lowestLowSinceCandidate) {
              lowestLowSinceCandidate = candle.low;
              lowestLowCandleIndex = i;
              lowestLowCandleTime = candle.openTime;
            }

            // Evaluate retracement qualification
            const retracementBars = lowestLowCandleIndex - candidateCandleIndex;
            const fibRange = candidatePrice - referencePrice;
            const fibTargetPrice = candidatePrice - minFib * fibRange;
            const actualFibDepth = fibRange > 0 ? (candidatePrice - lowestLowSinceCandidate) / fibRange : 0;

            const isCandleCountQualified = retracementBars >= minCandles;
            const isFibDepthQualified = lowestLowSinceCandidate <= fibTargetPrice; // Wick touch counts

            if (isCandleCountQualified && isFibDepthQualified) {
              // Both conditions satisfied: Finalize valid HH and new HL!
              const newHH: StructurePoint = {
                id: `sp_hh_${symbol}_${candidateCandleTimeUnix}_V2`,
                symbol,
                timeframe,
                candleOpenTime: candidateCandleTime,
                candleOpenTimeUnix: candidateCandleTimeUnix,
                type: StructurePointType.HH,
                price: candidatePrice,
                strength: StructureStrength.MAJOR,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: candidateCandleIndex,
                retracementCandles: retracementBars,
                retracementFibDepth: actualFibDepth,
                fibPriceLevel: fibTargetPrice,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              const newHL: StructurePoint = {
                id: `sp_hl_${symbol}_${workingSet[lowestLowCandleIndex].openTimeUnix}_V2`,
                symbol,
                timeframe,
                candleOpenTime: lowestLowCandleTime,
                candleOpenTimeUnix: workingSet[lowestLowCandleIndex].openTimeUnix,
                type: StructurePointType.HL,
                price: lowestLowSinceCandidate,
                strength: StructureStrength.INTERMEDIATE,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: lowestLowCandleIndex,
                retracementCandles: retracementBars,
                retracementFibDepth: actualFibDepth,
                fibPriceLevel: fibTargetPrice,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              points.push(newHH, newHL);
              confirmedHH = newHH;
              confirmedHL = newHL;

              addEvent(
                candle,
                'STRUCTURE_CONFIRMED',
                'Valid HH and HL Confirmed',
                `HH confirmed at ${newHH.price.toFixed(2)} and HL confirmed at ${newHL.price.toFixed(2)}. Retracement: ${retracementBars}/${minCandles} bars, Fib depth: ${actualFibDepth.toFixed(3)} >= ${minFib}.`,
                {
                  price: newHH.price,
                  referencePrice: newHL.price,
                  retracementCandles: retracementBars,
                  requiredCandles: minCandles,
                  fibDepth: actualFibDepth,
                  requiredFib: minFib,
                }
              );

              // Reset candidate tracking
              candidateType = null;
            }
          }
        }
      }

      // =========================================================
      // STATE 2: BULLISH_STRUCTURE_BROKEN (TRANSITION_TO_BEARISH)
      // =========================================================
      else if (structureState === StructureState.BULLISH_STRUCTURE_BROKEN) {
        // If price rallies and closes back above previous valid HH, transition fails and bullish structure resumes
        if (confirmedHH && candle.close > confirmedHH.price) {
          structureState = StructureState.BULLISH;
          addEvent(
            candle,
            'TREND_CONFIRMED',
            'Bullish Structure Restored',
            `Candle closed above previous HH (${confirmedHH.price.toFixed(2)}). Transition aborted, bullish resumed.`
          );
          candidateType = null;
          continue;
        }

        // Tracking candidate LL and subsequent upward retracement for LH
        if (candidateType === StructurePointType.PROVISIONAL_LL) {
          if (candle.low < candidatePrice) {
            // Same-leg extension downward
            candidatePrice = candle.low;
            candidateCandleIndex = i;
            candidateCandleTime = candle.openTime;
            candidateCandleTimeUnix = candle.openTimeUnix;

            highestHighSinceCandidate = candle.high;
            highestHighCandleIndex = i;
            highestHighCandleTime = candle.openTime;

            addEvent(
              candle,
              'LEG_EXTENDED',
              'Bearish Expansion Extended',
              `Lower low reached at ${candidatePrice.toFixed(2)}. Provisional LL updated.`,
              { price: candidatePrice, referencePrice }
            );
          } else {
            // Upward retracement forming from candidate LL
            if (candle.high > highestHighSinceCandidate) {
              highestHighSinceCandidate = candle.high;
              highestHighCandleIndex = i;
              highestHighCandleTime = candle.openTime;
            }

            const retracementBars = highestHighCandleIndex - candidateCandleIndex;
            const fibRange = referencePrice - candidatePrice;
            const fibTargetPrice = candidatePrice + minFib * fibRange;
            const actualFibDepth = fibRange > 0 ? (highestHighSinceCandidate - candidatePrice) / fibRange : 0;

            const isCandleCountQualified = retracementBars >= minCandles;
            const isFibDepthQualified = highestHighSinceCandidate >= fibTargetPrice; // Wick touch counts

            if (isCandleCountQualified && isFibDepthQualified) {
              // Valid LL and qualifying LH confirmed! Reversal confirmed to BEARISH!
              const newLL: StructurePoint = {
                id: `sp_ll_${symbol}_${candidateCandleTimeUnix}_V2`,
                symbol,
                timeframe,
                candleOpenTime: candidateCandleTime,
                candleOpenTimeUnix: candidateCandleTimeUnix,
                type: StructurePointType.LL,
                price: candidatePrice,
                strength: StructureStrength.MAJOR,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: candidateCandleIndex,
                retracementCandles: retracementBars,
                retracementFibDepth: actualFibDepth,
                fibPriceLevel: fibTargetPrice,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              const newLH: StructurePoint = {
                id: `sp_lh_${symbol}_${workingSet[highestHighCandleIndex].openTimeUnix}_V2`,
                symbol,
                timeframe,
                candleOpenTime: highestHighCandleTime,
                candleOpenTimeUnix: workingSet[highestHighCandleIndex].openTimeUnix,
                type: StructurePointType.LH,
                price: highestHighSinceCandidate,
                strength: StructureStrength.INTERMEDIATE,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: highestHighCandleIndex,
                retracementCandles: retracementBars,
                retracementFibDepth: actualFibDepth,
                fibPriceLevel: fibTargetPrice,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              points.push(newLL, newLH);
              confirmedLL = newLL;
              confirmedLH = newLH;
              structureState = StructureState.BEARISH;

              addEvent(
                candle,
                'TREND_CONFIRMED',
                'Bearish Trend Confirmed',
                `Break + retracement sequence completed: Valid LL at ${newLL.price.toFixed(2)} and LH at ${newLH.price.toFixed(2)}. Market structure confirmed BEARISH.`,
                {
                  price: newLL.price,
                  referencePrice: newLH.price,
                  retracementCandles: retracementBars,
                  requiredCandles: minCandles,
                  fibDepth: actualFibDepth,
                  requiredFib: minFib,
                }
              );

              candidateType = null;
            }
          }
        }
      }

      // ==========================================
      // STATE 3: BEARISH
      // ==========================================
      else if (structureState === StructureState.BEARISH) {
        // Condition A: Bearish Structure Break (Strict Body Close Rule)
        if (confirmedLH && candle.close > confirmedLH.price) {
          structureState = StructureState.BEARISH_STRUCTURE_BROKEN;
          addEvent(
            candle,
            'STRUCTURE_BROKEN',
            'Bearish Structure Broken',
            `Candle closed at ${candle.close.toFixed(2)} above previous LH (${confirmedLH.price.toFixed(2)}). Transition to bullish initiated.`,
            { price: candle.close, referencePrice: confirmedLH.price }
          );

          // The breakout initiates candidate HH tracking upward
          candidateType = StructurePointType.PROVISIONAL_HH;
          candidatePrice = candle.high;
          candidateCandleIndex = i;
          candidateCandleTime = candle.openTime;
          candidateCandleTimeUnix = candle.openTimeUnix;
          referencePrice = confirmedLL ? confirmedLL.price : candle.low;
          referenceTime = confirmedLL ? confirmedLL.candleOpenTime : candle.openTime;

          lowestLowSinceCandidate = candle.low;
          lowestLowCandleIndex = i;
          lowestLowCandleTime = candle.openTime;
          continue;
        }

        // Condition B: Bearish Continuation & Candidate LL Tracking
        if (candidateType === null) {
          // Check if candidate new LL is eligible: requires CLOSED candle close < previous valid LL
          if (confirmedLL && candle.close < confirmedLL.price) {
            candidateType = StructurePointType.PROVISIONAL_LL;
            candidatePrice = candle.low;
            candidateCandleIndex = i;
            candidateCandleTime = candle.openTime;
            candidateCandleTimeUnix = candle.openTimeUnix;
            referencePrice = confirmedLH ? confirmedLH.price : candle.high;
            referenceTime = confirmedLH ? confirmedLH.candleOpenTime : candle.openTime;

            highestHighSinceCandidate = candle.high;
            highestHighCandleIndex = i;
            highestHighCandleTime = candle.openTime;

            addEvent(
              candle,
              'CANDIDATE_CREATED',
              'Candidate LL Formed',
              `Candle close ${candle.close.toFixed(2)} broke previous LL (${confirmedLL.price.toFixed(2)}). Tracking candidate LL at ${candidatePrice.toFixed(2)}.`,
              { price: candidatePrice, referencePrice }
            );
          }
        } else if (candidateType === StructurePointType.PROVISIONAL_LL) {
          if (candle.low < candidatePrice) {
            // Same-Leg Extension: Lower low formed before retracement qualified
            candidatePrice = candle.low;
            candidateCandleIndex = i;
            candidateCandleTime = candle.openTime;
            candidateCandleTimeUnix = candle.openTimeUnix;

            highestHighSinceCandidate = candle.high;
            highestHighCandleIndex = i;
            highestHighCandleTime = candle.openTime;

            addEvent(
              candle,
              'LEG_EXTENDED',
              'Bearish Expansion Extended',
              `Lower low reached at ${candidatePrice.toFixed(2)} without qualified retracement. Provisional LL updated.`,
              { price: candidatePrice, referencePrice }
            );
          } else {
            // Retracing upward from candidate LL
            if (candle.high > highestHighSinceCandidate) {
              highestHighSinceCandidate = candle.high;
              highestHighCandleIndex = i;
              highestHighCandleTime = candle.openTime;
            }

            const retracementBars = highestHighCandleIndex - candidateCandleIndex;
            const fibRange = referencePrice - candidatePrice;
            const fibTargetPrice = candidatePrice + minFib * fibRange;
            const actualFibDepth = fibRange > 0 ? (highestHighSinceCandidate - candidatePrice) / fibRange : 0;

            const isCandleCountQualified = retracementBars >= minCandles;
            const isFibDepthQualified = highestHighSinceCandidate >= fibTargetPrice; // Wick touch counts

            if (isCandleCountQualified && isFibDepthQualified) {
              // Finalize valid LL and new LH!
              const newLL: StructurePoint = {
                id: `sp_ll_${symbol}_${candidateCandleTimeUnix}_V2`,
                symbol,
                timeframe,
                candleOpenTime: candidateCandleTime,
                candleOpenTimeUnix: candidateCandleTimeUnix,
                type: StructurePointType.LL,
                price: candidatePrice,
                strength: StructureStrength.MAJOR,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: candidateCandleIndex,
                retracementCandles: retracementBars,
                retracementFibDepth: actualFibDepth,
                fibPriceLevel: fibTargetPrice,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              const newLH: StructurePoint = {
                id: `sp_lh_${symbol}_${workingSet[highestHighCandleIndex].openTimeUnix}_V2`,
                symbol,
                timeframe,
                candleOpenTime: highestHighCandleTime,
                candleOpenTimeUnix: workingSet[highestHighCandleIndex].openTimeUnix,
                type: StructurePointType.LH,
                price: highestHighSinceCandidate,
                strength: StructureStrength.INTERMEDIATE,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: highestHighCandleIndex,
                retracementCandles: retracementBars,
                retracementFibDepth: actualFibDepth,
                fibPriceLevel: fibTargetPrice,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              points.push(newLL, newLH);
              confirmedLL = newLL;
              confirmedLH = newLH;

              addEvent(
                candle,
                'STRUCTURE_CONFIRMED',
                'Valid LL and LH Confirmed',
                `LL confirmed at ${newLL.price.toFixed(2)} and LH confirmed at ${newLH.price.toFixed(2)}. Retracement: ${retracementBars}/${minCandles} bars, Fib depth: ${actualFibDepth.toFixed(3)} >= ${minFib}.`,
                {
                  price: newLL.price,
                  referencePrice: newLH.price,
                  retracementCandles: retracementBars,
                  requiredCandles: minCandles,
                  fibDepth: actualFibDepth,
                  requiredFib: minFib,
                }
              );

              candidateType = null;
            }
          }
        }
      }

      // =========================================================
      // STATE 4: BEARISH_STRUCTURE_BROKEN (TRANSITION_TO_BULLISH)
      // =========================================================
      else if (structureState === StructureState.BEARISH_STRUCTURE_BROKEN) {
        // If price drops and closes back below previous valid LL, transition fails and bearish structure resumes
        if (confirmedLL && candle.close < confirmedLL.price) {
          structureState = StructureState.BEARISH;
          addEvent(
            candle,
            'TREND_CONFIRMED',
            'Bearish Structure Restored',
            `Candle closed below previous LL (${confirmedLL.price.toFixed(2)}). Transition aborted, bearish resumed.`
          );
          candidateType = null;
          continue;
        }

        // Tracking candidate HH and downward retracement for HL
        if (candidateType === StructurePointType.PROVISIONAL_HH) {
          if (candle.high > candidatePrice) {
            // Same-leg extension upward
            candidatePrice = candle.high;
            candidateCandleIndex = i;
            candidateCandleTime = candle.openTime;
            candidateCandleTimeUnix = candle.openTimeUnix;

            lowestLowSinceCandidate = candle.low;
            lowestLowCandleIndex = i;
            lowestLowCandleTime = candle.openTime;

            addEvent(
              candle,
              'LEG_EXTENDED',
              'Bullish Expansion Extended',
              `Higher high reached at ${candidatePrice.toFixed(2)}. Provisional HH updated.`,
              { price: candidatePrice, referencePrice }
            );
          } else {
            // Downward retracement forming from candidate HH
            if (candle.low < lowestLowSinceCandidate) {
              lowestLowSinceCandidate = candle.low;
              lowestLowCandleIndex = i;
              lowestLowCandleTime = candle.openTime;
            }

            const retracementBars = lowestLowCandleIndex - candidateCandleIndex;
            const fibRange = candidatePrice - referencePrice;
            const fibTargetPrice = candidatePrice - minFib * fibRange;
            const actualFibDepth = fibRange > 0 ? (candidatePrice - lowestLowSinceCandidate) / fibRange : 0;

            const isCandleCountQualified = retracementBars >= minCandles;
            const isFibDepthQualified = lowestLowSinceCandidate <= fibTargetPrice; // Wick touch counts

            if (isCandleCountQualified && isFibDepthQualified) {
              // Valid HH and qualifying HL confirmed! Reversal confirmed to BULLISH!
              const newHH: StructurePoint = {
                id: `sp_hh_${symbol}_${candidateCandleTimeUnix}_V2`,
                symbol,
                timeframe,
                candleOpenTime: candidateCandleTime,
                candleOpenTimeUnix: candidateCandleTimeUnix,
                type: StructurePointType.HH,
                price: candidatePrice,
                strength: StructureStrength.MAJOR,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: candidateCandleIndex,
                retracementCandles: retracementBars,
                retracementFibDepth: actualFibDepth,
                fibPriceLevel: fibTargetPrice,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              const newHL: StructurePoint = {
                id: `sp_hl_${symbol}_${workingSet[lowestLowCandleIndex].openTimeUnix}_V2`,
                symbol,
                timeframe,
                candleOpenTime: lowestLowCandleTime,
                candleOpenTimeUnix: workingSet[lowestLowCandleIndex].openTimeUnix,
                type: StructurePointType.HL,
                price: lowestLowSinceCandidate,
                strength: StructureStrength.INTERMEDIATE,
                algorithmVersion: CURRENT_ALGORITHM_VERSION,
                candleIndex: lowestLowCandleIndex,
                retracementCandles: retracementBars,
                retracementFibDepth: actualFibDepth,
                fibPriceLevel: fibTargetPrice,
                detectedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              };

              points.push(newHH, newHL);
              confirmedHH = newHH;
              confirmedHL = newHL;
              structureState = StructureState.BULLISH;

              addEvent(
                candle,
                'TREND_CONFIRMED',
                'Bullish Trend Confirmed',
                `Break + retracement sequence completed: Valid HH at ${newHH.price.toFixed(2)} and HL at ${newHL.price.toFixed(2)}. Market structure confirmed BULLISH.`,
                {
                  price: newHH.price,
                  referencePrice: newHL.price,
                  retracementCandles: retracementBars,
                  requiredCandles: minCandles,
                  fibDepth: actualFibDepth,
                  requiredFib: minFib,
                }
              );

              candidateType = null;
            }
          }
        }
      }
    }

    // 4. Construct Active Retracement Inspection State
    let activeRetracement: ActiveRetracementInfo | null = null;
    let activeProvisionalPoint: StructurePoint | null = null;

    if (candidateType !== null) {
      const isBullishCand = candidateType === StructurePointType.PROVISIONAL_HH;
      const retracementBars = isBullishCand
        ? lowestLowCandleIndex - candidateCandleIndex
        : highestHighCandleIndex - candidateCandleIndex;

      const fibRange = isBullishCand
        ? candidatePrice - referencePrice
        : referencePrice - candidatePrice;

      const fibTargetPrice = isBullishCand
        ? candidatePrice - minFib * fibRange
        : candidatePrice + minFib * fibRange;

      const extremeRetracementPrice = isBullishCand ? lowestLowSinceCandidate : highestHighSinceCandidate;
      const actualFibDepth =
        fibRange > 0
          ? isBullishCand
            ? (candidatePrice - lowestLowSinceCandidate) / fibRange
            : (highestHighSinceCandidate - candidatePrice) / fibRange
          : 0;

      const isCountQual = retracementBars >= minCandles;
      const isFibQual = isBullishCand
        ? lowestLowSinceCandidate <= fibTargetPrice
        : highestHighSinceCandidate >= fibTargetPrice;

      activeRetracement = {
        state: structureState,
        candidateType,
        candidatePrice,
        candidateTime: candidateCandleTime,
        candidateTimeUnix: candidateCandleTimeUnix,
        candidateCandleIndex,
        referencePrice,
        referenceTime,
        fibLevelPrice: fibTargetPrice,
        fibRatio: minFib,
        currentRetracementCandles: Math.max(0, retracementBars),
        requiredRetracementCandles: minCandles,
        isCandleCountQualified: isCountQual,
        currentRetracementPrice: extremeRetracementPrice,
        currentFibDepth: Math.max(0, actualFibDepth),
        isFibDepthQualified: isFibQual,
        isFullyQualified: isCountQual && isFibQual,
        bestRetracementCandleTime: isBullishCand ? lowestLowCandleTime : highestHighCandleTime,
      };

      activeProvisionalPoint = {
        id: `sp_prov_${symbol}_${candidateCandleTimeUnix}_V2`,
        symbol,
        timeframe,
        candleOpenTime: candidateCandleTime,
        candleOpenTimeUnix: candidateCandleTimeUnix,
        type: candidateType,
        price: candidatePrice,
        strength: StructureStrength.MINOR,
        algorithmVersion: CURRENT_ALGORITHM_VERSION,
        candleIndex: candidateCandleIndex,
        isProvisional: true,
        retracementCandles: Math.max(0, retracementBars),
        retracementFibDepth: Math.max(0, actualFibDepth),
        fibPriceLevel: fibTargetPrice,
        detectedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
    }

    // 5. Sort points chronologically
    points.sort((a, b) => a.candleOpenTimeUnix - b.candleOpenTimeUnix);

    // Filter counts
    const hhCount = points.filter((p) => p.type === StructurePointType.HH).length;
    const hlCount = points.filter((p) => p.type === StructurePointType.HL).length;
    const llCount = points.filter((p) => p.type === StructurePointType.LL).length;
    const lhCount = points.filter((p) => p.type === StructurePointType.LH).length;

    // Optional legacy pivot comparison
    let legacyPoints: StructurePoint[] | undefined;
    if (params.legacyPivotOverlay) {
      legacyPoints = this.detectLegacyPivots(workingSet, params);
    }

    const stateLabels: Record<StructureState, string> = {
      [StructureState.UNDEFINED]: 'UNDEFINED',
      [StructureState.BULLISH]: 'BULLISH',
      [StructureState.BULLISH_STRUCTURE_BROKEN]: 'BULLISH STRUCTURE BROKEN (TRANSITION TO BEARISH)',
      [StructureState.BEARISH]: 'BEARISH',
      [StructureState.BEARISH_STRUCTURE_BROKEN]: 'BEARISH STRUCTURE BROKEN (TRANSITION TO BULLISH)',
    };

    const executionTimeMs = Date.now() - startTime;

    return {
      symbol,
      timeframe,
      algorithmVersion: ALGORITHM_VERSION_V2,
      parameters: params,
      structureState,
      stateLabel: stateLabels[structureState] || structureState,
      totalCandlesAvailable,
      closedCandlesEvaluated: workingSet.length,
      unclosedCandleExcluded,
      workingWindowStart: workingSet[0]?.openTime || null,
      workingWindowEnd: workingSet[workingSet.length - 1]?.openTime || null,
      hhCount,
      hlCount,
      llCount,
      lhCount,
      provisionalCount: activeProvisionalPoint ? 1 : 0,
      totalPointsCount: points.length + (activeProvisionalPoint ? 1 : 0),
      lastHH: confirmedHH,
      lastHL: confirmedHL,
      lastLL: confirmedLL,
      lastLH: confirmedLH,
      lastConfirmedHH: confirmedHH,
      lastConfirmedHL: confirmedHL,
      lastConfirmedLL: confirmedLL,
      lastConfirmedLH: confirmedLH,
      activeProvisionalPoint,
      activeRetracement,
      points,
      legacyPoints,
      eventLogs: eventLogs.slice(-50), // keep latest 50 events for clean inspection
      executionTimeMs,
      detectedAt: new Date().toISOString(),
    };
  }

  /**
   * Optional legacy 2-bar pivot detection for side-by-side comparison overlay
   */
  private detectLegacyPivots(
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

  /**
   * High-level workflow: retrieve candles from repository, detect structure, and persist.
   */
  public async detectAndSaveStructure(
    symbol: string,
    timeframe: string = '5M',
    lookback: number = STRUCTURE_LOOKBACK_CANDLES,
    customParams?: Partial<StructureParameters>
  ): Promise<StructureDetectionResult> {
    const candles = await candleRepository.getCandles(symbol, timeframe, lookback + 50);
    const result = this.detectStructure(candles, {
      ...customParams,
      lookbackCandles: lookback,
    });

    if (result.points.length > 0) {
      await structureRepository.savePoints(result.points);
    }

    return result;
  }
}

export const structureEngine = new StructureEngine();
