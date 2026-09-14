import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Keep these regressions in the existing test:v6 entry point without changing package scripts.
import './structureV6ExternalRange.cases';
import { detectStructureV6FibQualifiedRange } from '../structureV6Engine';
import {
  ALGORITHM_VERSION_V6_REV3,
  StructurePointType,
  StructureState,
} from '../structureTypes';
import { NormalizedMarketCandle } from '../../marketData/mexcPublicMarketClient';

const BASE = Date.UTC(2026, 0, 1);
function candle(i: number, open: number, high: number, low: number, close: number, symbol = 'ETH_USDT', closed = true): NormalizedMarketCandle {
  const openTimeUnix = BASE + i * 300_000;
  return { symbol, timeframe: '5M', openTime: new Date(openTimeUnix).toISOString(), openTimeUnix, open, high, low, close, volume: 1, amount: 1, isClosed: closed, source: 'MEXC_PUBLIC' };
}
function bullishSeed(symbol = 'ETH_USDT') {
  const candles = [candle(0, 90, 100, 88, 95, symbol), candle(1, 85, 90, 80, 86, symbol)];
  return { candles, seed: { direction: 'BULLISH' as const, top: { price: 100, candleTime: candles[0].openTime, candleTimeUnix: candles[0].openTimeUnix, candleIndex: 0 }, bottom: { price: 80, candleTime: candles[1].openTime, candleTimeUnix: candles[1].openTimeUnix, candleIndex: 1 } } };
}
function bearishSeed(symbol = 'ETH_USDT') {
  const candles = [candle(0, 95, 100, 90, 92, symbol), candle(1, 90, 91, 80, 82, symbol)];
  return { candles, seed: { direction: 'BEARISH' as const, top: { price: 100, candleTime: candles[0].openTime, candleTimeUnix: candles[0].openTimeUnix, candleIndex: 0 }, bottom: { price: 80, candleTime: candles[1].openTime, candleTimeUnix: candles[1].openTimeUnix, candleIndex: 1 } } };
}
function run(candles: NormalizedMarketCandle[], manualStart: any, overrides: Record<string, unknown> = {}) {
  return detectStructureV6FibQualifiedRange(candles, { algorithmVersion: ALGORITHM_VERSION_V6_REV3, manualStart, minimumRetracementCandles: 4, minimumRetracementFib: 0.382, analysisCandles: 280, initializationSearchCandles: 0, ...overrides });
}
function assertSingleActiveAndAligned(result: ReturnType<typeof run>) {
  assert.equal(result.ranges?.filter((r) => r.status === 'ACTIVE').length, 1);
  assert.equal(result.activeRange?.direction, result.structureState);
}

describe('V6 REV3 authoritative structure state machine', () => {
  it('confirms exactly one HH+HL bullish continuation pair using retracement low', () => {
    const { candles, seed } = bullishSeed();
    candles.push(candle(2, 99, 110, 98, 105), candle(3, 105, 109, 105, 107), candle(4, 107, 108, 103, 104), candle(5, 104, 106, 100, 102), candle(6, 102, 104, 98, 100), candle(7, 100, 106, 99, 105));
    // The old micro-resumption candle leaves the external pair unresolved.
    assert.equal(run(candles, seed).points.length, 2);
    candles.push(candle(8, 105, 112, 104, 111)); // later close through the preceding expansion extreme
    const result = run(candles, seed);
    assert.deepEqual(result.points.slice(-2).map((p) => p.type), [StructurePointType.HH, StructurePointType.HL]);
    assert.equal(result.points.at(-2)?.price, 110);
    assert.equal(result.points.at(-1)?.price, 98);
    assert.equal(result.points.filter((p) => p.sequenceLabel === 'HL2').length, 1);
    assertSingleActiveAndAligned(result);
  });

  it('confirms exactly one LL+LH bearish continuation pair using retracement high', () => {
    const { candles, seed } = bearishSeed();
    candles.push(candle(2, 81, 82, 70, 75), candle(3, 74, 74, 71, 72), candle(4, 72, 77, 71, 75), candle(5, 75, 80, 74, 78), candle(6, 78, 82, 77, 80), candle(7, 80, 81, 75, 76));
    // The old micro-resumption candle leaves the external pair unresolved.
    assert.equal(run(candles, seed).points.length, 2);
    candles.push(candle(8, 76, 77, 68, 69)); // later close through the preceding expansion extreme
    const result = run(candles, seed);
    assert.deepEqual(result.points.slice(-2).map((p) => p.type), [StructurePointType.LL, StructurePointType.LH]);
    assert.equal(result.points.at(-2)?.price, 70);
    assert.equal(result.points.at(-1)?.price, 82);
    assert.equal(result.points.filter((p) => p.sequenceLabel === 'LH2').length, 1);
    assertSingleActiveAndAligned(result);
  });

  it('transitions bearish to bullish only after a close above LH and qualification', () => {
    const { candles, seed } = bearishSeed();
    candles.push(candle(2, 99, 112, 98, 105), candle(3, 105, 110, 104, 108), candle(4, 108, 109, 101, 103), candle(5, 103, 106, 98, 100), candle(6, 100, 103, 96, 99), candle(7, 99, 108, 98, 104));
    // The old micro-resumption candle leaves the external pair unresolved.
    assert.equal(run(candles, seed).points.length, 2);
    candles.push(candle(8, 104, 115, 103, 113)); // later close through the preceding expansion extreme
    const result = run(candles, seed);
    assert.deepEqual(result.points.slice(-2).map((p) => p.type), [StructurePointType.HH, StructurePointType.HL]);
    assert.equal(result.activeRange?.direction, 'BULLISH');
  });

  it('transitions bullish to bearish only after a close below HL and qualification', () => {
    const { candles, seed } = bullishSeed();
    candles.push(candle(2, 81, 82, 68, 75), candle(3, 74, 74, 69, 71), candle(4, 71, 78, 70, 75), candle(5, 75, 82, 74, 79), candle(6, 79, 84, 78, 81), candle(7, 81, 82, 75, 77));
    // The old micro-resumption candle leaves the external pair unresolved.
    assert.equal(run(candles, seed).points.length, 2);
    candles.push(candle(8, 77, 78, 65, 67)); // later close through the preceding expansion extreme
    const result = run(candles, seed);
    assert.deepEqual(result.points.slice(-2).map((p) => p.type), [StructurePointType.LL, StructurePointType.LH]);
    assert.equal(result.activeRange?.direction, 'BEARISH');
  });

  it('keeps the authoritative public state aligned with the confirmed range while reversal is pending', () => {
    const { candles, seed } = bearishSeed();
    candles.push(candle(2, 99, 112, 98, 105));
    const result = run(candles, seed);
    assert.equal(result.stateLabel, 'EXPANDING_BULLISH');
    assert.equal(result.structureState, StructureState.BEARISH);
    assert.equal(result.activeRange?.direction, 'BEARISH');
    assert.equal(result.points.length, 2);
  });

  it('ignores a wick-only boundary breach', () => {
    const { candles, seed } = bullishSeed();
    candles.push(candle(2, 95, 105, 90, 99));
    const result = run(candles, seed);
    assert.equal(result.points.length, 2);
    assert.equal(result.structureBreakEvents?.length, 0);
    assert.equal(result.rejectedEvents?.length, 1);
  });

  it('does not break on exact close equality', () => {
    const { candles, seed } = bullishSeed();
    candles.push(candle(2, 95, 105, 90, 100), candle(3, 85, 90, 75, 80));
    const result = run(candles, seed);
    assert.equal(result.structureBreakEvents?.length, 0);
    assert.equal(result.points.length, 2);
  });

  it('rejects a retracement below 0.382', () => {
    const { candles, seed } = bullishSeed();
    candles.push(candle(2, 101, 110, 100, 108), candle(3, 108, 109, 106, 107), candle(4, 107, 108, 104, 105), candle(5, 105, 107, 102, 104), candle(6, 104, 106, 100, 103));
    assert.equal(run(candles, seed).points.length, 2);
  });

  it('rejects sufficient Fib depth when candle count fails', () => {
    const { candles, seed } = bullishSeed();
    candles.push(candle(2, 101, 110, 100, 108), candle(3, 108, 109, 95, 100));
    const result = run(candles, seed);
    assert.equal(result.points.length, 2);
    assert.equal(result.activeRetracement?.isFibDepthQualified, true);
    assert.equal(result.activeRetracement?.isCandleCountQualified, false);
  });

  it('accepts an exact 0.382 wick touch', () => {
    const { candles, seed } = bullishSeed();
    const exact = 110 - 0.382 * (110 - 80);
    candles.push(candle(2, 101, 110, 100, 108), candle(3, 108, 109, 105, 107), candle(4, 107, 108, 103, 105), candle(5, 105, 106, 101, 103), candle(6, 103, 104, exact, 102), candle(7, 102, 106, 100, 105));
    assert.equal(run(candles, seed).points.length, 2);
    assert.equal(run(candles, seed).activeRetracement?.isFullyQualified, true);
    candles.push(candle(8, 105, 112, 104, 111));
    assert.equal(run(candles, seed).points.length, 4);
  });

  it('extends one candidate and resets retracement tracking', () => {
    const { candles, seed } = bullishSeed();
    candles.push(candle(2, 101, 110, 100, 108), candle(3, 108, 109, 95, 100), candle(4, 100, 115, 99, 113));
    const extending = run(candles, seed);
    assert.equal(extending.points.length, 2);
    assert.equal(extending.structureBreakEvents?.length, 1);
    assert.equal(extending.activeRetracement?.candidatePrice, 115);

    candles.push(candle(5, 113, 114, 108, 110), candle(6, 110, 112, 104, 106), candle(7, 106, 109, 100, 103), candle(8, 103, 106, 95, 100), candle(9, 100, 110, 98, 107));
    assert.equal(run(candles, seed).points.length, 2);
    candles.push(candle(10, 107, 118, 106, 116));
    const result = run(candles, seed);
    assert.equal(result.points.at(-2)?.price, 115);
    assert.equal(result.points.at(-1)?.price, 95);
    assert.equal(result.points.length, 4);
  });

  it('keeps a locked external range through internal oscillations and commits only after qualified retracement completion', () => {
    const { candles, seed } = bullishSeed('XAU_USDT');
    candles.push(
      candle(2, 94, 99, 88, 96, 'XAU_USDT'),
      candle(3, 96, 100, 91, 93, 'XAU_USDT'),
      candle(4, 93, 97, 80, 90, 'XAU_USDT'),
      candle(5, 90, 101, 86, 99, 'XAU_USDT'), // wick above HH; close remains inside
      candle(6, 99, 99, 84, 87, 'XAU_USDT'),
      candle(7, 87, 96, 79, 82, 'XAU_USDT'), // wick below HL; close remains inside
      candle(8, 82, 98, 82, 96, 'XAU_USDT'),
    );

    const internalOnly = run(candles, seed);
    assert.equal(internalOnly.points.length, 2);
    assert.equal(internalOnly.structureBreakEvents?.length, 0);
    assert.equal(internalOnly.activeRange?.rangeId, 'V6R3_BULLISH_RANGE_1');

    candles.push(
      candle(9, 99, 110, 98, 105, 'XAU_USDT'), // valid body-close break
      candle(10, 105, 109, 104, 107, 'XAU_USDT'),
      candle(11, 107, 108, 101, 103, 'XAU_USDT'),
      candle(12, 103, 106, 98, 100, 'XAU_USDT'),
      candle(13, 100, 103, 96, 98, 'XAU_USDT'), // both gates pass, but retracement is not complete
    );
    const qualifiedButUnfinished = run(candles, seed);
    assert.equal(qualifiedButUnfinished.points.length, 2);
    assert.equal(qualifiedButUnfinished.activeRange?.rangeId, 'V6R3_BULLISH_RANGE_1');
    assert.equal(qualifiedButUnfinished.stateLabel, 'RETRACING_BULLISH');

    candles.push(
      candle(14, 98, 100, 94, 95, 'XAU_USDT'), // deeper retracement must update, not commit
      candle(15, 95, 98, 93, 94, 'XAU_USDT'), // another internal extreme, still no pair
    );
    const stillRetracing = run(candles, seed);
    assert.equal(stillRetracing.points.length, 2);
    assert.equal(stillRetracing.activeRetracement?.currentRetracementExtremePrice, 93);

    candles.push(candle(16, 94, 101, 94, 99, 'XAU_USDT')); // closes above the last retracement candle high
    assert.equal(run(candles, seed).points.length, 2); // micro resumption cannot confirm
    candles.push(candle(17, 99, 112, 98, 111, 'XAU_USDT')); // close through HH=110
    const confirmed = run(candles, seed);
    assert.equal(confirmed.points.length, 4);
    assert.deepEqual(confirmed.points.slice(-2).map((point) => [point.type, point.price]), [
      [StructurePointType.HH, 110],
      [StructurePointType.HL, 93],
    ]);
    assert.equal(confirmed.ranges?.filter((range) => range.status === 'ACTIVE').length, 1);

    candles.push(
      candle(18, 99, 108, 96, 106, 'XAU_USDT'),
      candle(19, 106, 109, 95, 97, 'XAU_USDT'),
      candle(20, 97, 107, 94, 104, 'XAU_USDT'),
    );
    const rightEdgeInternals = run(candles, seed);
    assert.deepEqual(rightEdgeInternals.points, confirmed.points);
  });

  for (const symbol of ['ETH_USDT', 'XAU_USDT', 'XAG_USDT']) {
    it(`preserves ${symbol} on every emitted point`, () => {
      const { candles, seed } = bullishSeed(symbol);
      const result = run(candles, seed);
      assert.ok(result.points.every((p) => p.symbol === symbol && p.timeframe === '5M'));
    });
  }

  it('never emits opposing labels on one event or timestamp', () => {
    const { candles, seed } = bullishSeed();
    candles.push(candle(2, 101, 110, 99, 108), candle(3, 108, 109, 104, 105), candle(4, 105, 107, 102, 104), candle(5, 104, 106, 100, 102), candle(6, 102, 104, 98, 100), candle(7, 100, 106, 99, 105));
    candles.push(candle(8, 105, 112, 104, 111));
    const result = run(candles, seed);
    assert.equal(result.points.length, 4);
    assert.equal(new Set(result.points.map((p) => p.eventId)).size, result.points.length);
    assert.equal(new Set(result.points.map((p) => p.candleOpenTimeUnix)).size, result.points.length);
  });

  it('is deterministic across repeated runs', () => {
    const { candles, seed } = bearishSeed();
    candles.push(candle(2, 79, 80, 70, 75), candle(3, 74, 75, 71, 73), candle(4, 73, 78, 72, 76), candle(5, 76, 80, 75, 78), candle(6, 78, 82, 77, 80), candle(7, 80, 81, 75, 76));
    candles.push(candle(8, 76, 77, 68, 69));
    assert.equal(run(candles, seed).points.length, 4);
    const project = () => run(candles, seed).points.map(({ type, price, candleOpenTimeUnix, rangeId }) => ({ type, price, candleOpenTimeUnix, rangeId }));
    assert.deepEqual(project(), project());
  });

  it('is stable when an internal candle is appended at the window boundary', () => {
    const { candles, seed } = bullishSeed();
    const before = run(candles, seed).points;
    candles.push(candle(2, 90, 95, 85, 91));
    const after = run(candles, seed).points;
    assert.deepEqual(after, before);
  });

  it('excludes the unfinished candle from breaks and reports exclusion', () => {
    const { candles, seed } = bullishSeed();
    candles.push(candle(2, 100, 120, 99, 115, 'ETH_USDT', false));
    const result = run(candles, seed);
    assert.equal(result.points.length, 2);
    assert.equal(result.unclosedCandleExcluded, true);
    assert.equal(result.closedCandlesEvaluated, 2);
  });

  it('remains undefined when warm-up has no qualified prior cycle', () => {
    const candles = Array.from({ length: 10 }, (_, i) => candle(i, 90, 95, 85, 90));
    const result = detectStructureV6FibQualifiedRange(candles, { initializationSearchCandles: 10, analysisCandles: 50 });
    assert.equal(result.structureState, StructureState.UNDEFINED);
    assert.equal(result.points.length, 0);
    assert.equal(result.activeRange, null);
  });

  it('initializes from the first completed external warm-up cycle instead of global high/low order', () => {
    const candles = [
      candle(0, 85, 90, 80, 86),
      candle(1, 89, 102, 88, 101),
      candle(2, 101, 101, 99, 100),
      candle(3, 100, 100, 97, 98),
      candle(4, 98, 99, 95, 96),
      candle(5, 96, 97, 93, 95),
      candle(6, 95, 99, 94, 98),
    ];
    assert.equal(detectStructureV6FibQualifiedRange(candles, { initializationSearchCandles: 8 }).points.length, 0);
    candles.push(candle(7, 98, 105, 97, 103)); // first actual expansion confirmation
    const result = detectStructureV6FibQualifiedRange(candles, {
      initializationSearchCandles: 8,
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
    });
    assert.deepEqual(result.points.map((point) => point.type), [StructurePointType.HH, StructurePointType.HL]);
    assert.equal(result.activeRange?.direction, 'BULLISH');
    assert.equal(result.points[1].price, 93);
  });
});
