import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectStructureV6FibQualifiedRange as detect } from '../structureV6Engine';
import type { NormalizedMarketCandle } from '../../marketData/mexcPublicMarketClient';
import type { StructureParameters } from '../structureTypes';

type Row = [number, number, number, number];
const BASE = Date.UTC(2026, 0, 1);
const seedRows: Row[] = [[90, 100, 88, 95], [85, 90, 80, 86]];
const expansion: Row = [99, 120, 98, 115];
const pullback: Row[] = [[115, 119, 112, 114], [114, 116, 106, 108], [108, 110, 100, 103], [103, 105, 96, 98]];
const micro: Row = [98, 108, 97, 107];
const resume: Row = [107, 124, 106, 121];

function candles(rows: Row[], mirror = false): NormalizedMarketCandle[] {
  return rows.map(([o, h, l, c], i) => {
    const [open, high, low, close] = mirror ? [200-o, 200-l, 200-h, 200-c] : [o, h, l, c];
    const openTimeUnix = BASE + i * 300_000;
    return { symbol: mirror ? 'XAU_USDT' : 'ETH_USDT', timeframe: '5M', openTime: new Date(openTimeUnix).toISOString(), openTimeUnix, open, high, low, close, volume: 1, amount: 1, isClosed: true, source: 'MEXC_PUBLIC' };
  });
}
function parameters(mirror = false): Partial<StructureParameters> {
  const input = candles(seedRows, mirror);
  const topIndex = mirror ? 1 : 0;
  const bottomIndex = mirror ? 0 : 1;
  return {
    analysisCandles: 280, initializationSearchCandles: 0,
    minimumRetracementCandles: 4, minimumRetracementFib: 0.382,
    manualStart: {
      direction: mirror ? 'BEARISH' : 'BULLISH',
      top: { price: mirror ? 120 : 100, candleTime: input[topIndex].openTime, candleTimeUnix: input[topIndex].openTimeUnix, candleIndex: topIndex },
      bottom: { price: mirror ? 100 : 80, candleTime: input[bottomIndex].openTime, candleTimeUnix: input[bottomIndex].openTimeUnix, candleIndex: bottomIndex },
    },
  };
}
const qualifiedRows = [...seedRows, expansion, ...pullback];

for (const mirror of [false, true]) {
  const direction = mirror ? 'BEARISH' : 'BULLISH';
  const opposite = mirror ? 'BULLISH' : 'BEARISH';
  const price = (v: number) => mirror ? 200-v : v;
  const run = (rows: Row[]) => detect(candles(rows, mirror), parameters(mirror));

  describe(`${direction} external range persistence`, () => {
    it('ignores repeated internal oscillations without starting a candidate or shrinking the range', () => {
      const base = run(seedRows);
      const internals: Row[] = Array.from({ length: 30 }, (_, i) => [90, 99, 81, i % 2 ? 98 : 82]);
      const result = run([...seedRows, ...internals]);
      assert.deepEqual(result.points, base.points);
      assert.deepEqual(result.activeRange, base.activeRange);
      assert.equal(result.structureBreakEvents?.length, 0);
      assert.equal(result.activeRetracement, null);
    });

    it('rejects wick-only continuation and reversal breaches', () => {
      const result = run([...seedRows, [90, 125, 75, 95]]);
      assert.equal(result.points.length, 2);
      assert.equal(result.structureBreakEvents?.length, 0);
      assert.equal(result.rejectedEvents?.length, 2);
      assert.equal(result.activeRetracement, null);
    });

    it('requires a strict body close for continuation and reversal', () => {
      const continuation = run([...seedRows, expansion]);
      assert.equal(continuation.stateLabel, `EXPANDING_${direction}`);
      assert.equal(continuation.structureBreakEvents?.[0].breakType, `${direction}_CONTINUATION`);
      const reversal = run([...seedRows, [85, 90, 75, 79]]);
      assert.equal(reversal.stateLabel, `EXPANDING_${opposite}`);
      assert.equal(reversal.structureBreakEvents?.[0].breakType, `${direction}_STRUCTURE_BROKEN`);
      assert.equal(reversal.structureState, direction);
      assert.equal(reversal.points.length, 2);
      assert.equal(run([...seedRows, [90, 105, 75, 80], [90, 105, 75, 100]]).structureBreakEvents?.length, 0);
    });

    it('four candles and Fib qualification produce only an unresolved candidate', () => {
      const result = run(qualifiedRows);
      assert.equal(result.activeRetracement?.currentRetracementCandles, 4);
      assert.ok(result.activeRetracement?.isFullyQualified);
      assert.equal(result.points.length, 2);
      assert.deepEqual(result.activeRange, run(seedRows).activeRange);
      assert.equal(result.activeRetracement?.currentRetracementExtremePrice, price(96));
    });

    it('a single micro resumption does not confirm a pair', () => {
      const result = run([...qualifiedRows, micro]);
      assert.equal(result.points.length, 2);
      assert.equal(result.ranges?.length, 1);
      assert.ok(result.activeRetracement?.isFullyQualified);
    });

    it('qualified candidate remains unresolved through repeated internal swings', () => {
      const oscillations: Row[] = Array.from({ length: 25 }, (_, i) => [98, 112, 94, i % 2 ? 99 : 95]);
      const result = run([...qualifiedRows, ...oscillations]);
      assert.equal(result.points.length, 2);
      assert.equal(result.ranges?.length, 1);
      assert.equal(result.structureBreakEvents?.length, 1);
      assert.ok(result.activeRetracement?.isFullyQualified);
      assert.deepEqual(result.activeRange, run(seedRows).activeRange);
    });

    it('confirms the preceding pair only on a later close through the expansion extreme', () => {
      const result = run([...qualifiedRows, micro, resume]);
      assert.equal(result.points.length, 4);
      assert.deepEqual(result.points.slice(2).map(p => [p.type, p.price]), mirror ? [['LL', 80], ['LH', 104]] : [['HH', 120], ['HL', 96]]);
      assert.ok(result.points.slice(2).every(p => p.confirmationCandleIndex === 8));
      assert.ok(result.points.slice(2).every(p => p.candleIndex! < p.confirmationCandleIndex!));
      assert.equal(result.ranges?.length, 2);
      assert.equal(result.ranges?.filter(r => r.status === 'ACTIVE').length, 1);
      assert.equal(result.ranges?.[0].endedAtUnix, BASE + 8 * 300_000);
      assert.equal(result.activeRange?.startedAtUnix, BASE + 8 * 300_000);
      assert.equal(result.activeRetracement?.candidatePrice, price(124));
      assert.equal(result.activeRetracement?.currentRetracementCandles, 0);
    });

    it('an exact close at the expansion extreme is not confirmation', () => {
      const result = run([...qualifiedRows, [107, 120, 106, 120]]);
      assert.equal(result.points.length, 2);
      assert.ok(result.activeRetracement?.isFullyQualified);
    });

    it('same-leg wick extension resets qualification without spawning a range or BOS', () => {
      const result = run([...qualifiedRows, [98, 125, 97, 99]]);
      assert.equal(result.points.length, 2);
      assert.equal(result.ranges?.length, 1);
      assert.equal(result.structureBreakEvents?.length, 1);
      assert.equal(result.activeRetracement?.candidatePrice, price(125));
      assert.equal(result.activeRetracement?.currentRetracementCandles, 0);
      assert.equal(result.activeRetracement?.isFullyQualified, false);
      const after = run([...qualifiedRows, [98, 125, 97, 99], [99, 128, 98, 127]]);
      assert.equal(after.points.length, 2);
      assert.equal(after.activeRetracement?.candidatePrice, price(128));
    });

    it('an expansion close before four retracement candles only extends the leg', () => {
      const result = run([...seedRows, expansion, ...pullback.slice(0, 3), resume]);
      assert.equal(result.points.length, 2);
      assert.equal(result.activeRetracement?.candidatePrice, price(124));
      assert.equal(result.activeRetracement?.isFullyQualified, false);
    });

    it('four shallow retracement candles cannot confirm on an expansion close', () => {
      const shallow: Row[] = [[115,119,115,117],[117,119,114,116],[116,119,113,115],[115,118,112,114]];
      const result = run([...seedRows, expansion, ...shallow, resume]);
      assert.equal(result.points.length, 2);
      assert.equal(result.activeRetracement?.candidatePrice, price(124));
    });

    it('candidate retracement wicks affect Fib but do not invalidate the confirmed parent', () => {
      const result = run([...qualifiedRows, [98, 108, 75, 90]]);
      assert.equal(result.points.length, 2);
      assert.equal(result.structureBreakEvents?.length, 1);
      assert.equal(result.stateLabel, `RETRACING_${direction}`);
      assert.equal(result.activeRetracement?.currentRetracementExtremePrice, price(75));
    });

    it('the confirmed parent boundary cancels a pending candidate and starts the opposite leg', () => {
      // Outside candle extends the old candidate wick AND breaks its parent by close.
      const result = run([...qualifiedRows, [98, 130, 75, 79]]);
      assert.equal(result.points.length, 2);
      assert.deepEqual(result.activeRange, run(seedRows).activeRange);
      assert.equal(result.stateLabel, `EXPANDING_${opposite}`);
      assert.equal(result.structureBreakEvents?.at(-1)?.breakType, `${direction}_STRUCTURE_BROKEN`);
      assert.equal(result.activeRetracement?.candidatePrice, price(75));
      assert.equal(result.activeRetracement?.currentRetracementCandles, 0);
    });

    it('can cancel a reversal candidate and return to parent-direction expansion', () => {
      const result = run([...seedRows, [85, 90, 75, 79], [79, 122, 78, 110]]);
      assert.equal(result.points.length, 2);
      assert.equal(result.stateLabel, `EXPANDING_${direction}`);
      assert.equal(result.structureBreakEvents?.at(-1)?.breakType, `${direction}_CONTINUATION`);
    });

    it('uses the prior retracement anchor on an outside confirmation candle', () => {
      const result = run([...qualifiedRows, [98, 124, 85, 121]]);
      assert.equal(result.points.length, 4);
      assert.equal(result.points[3].price, price(96));
      assert.equal(result.points[3].candleIndex, 6);
      assert.equal(result.activeRetracement?.candidatePrice, price(124));
    });

    it('does not allow forming candles to confirm, reverse, extend or qualify', () => {
      for (const row of [resume, [98,130,75,79] as Row, [98,125,97,99] as Row]) {
        const input = candles([...qualifiedRows, row], mirror);
        input.at(-1)!.isClosed = false;
        const result = detect(input, parameters(mirror));
        const before = run(qualifiedRows);
        assert.deepEqual(result.points, before.points);
        assert.deepEqual(result.activeRange, before.activeRange);
        assert.deepEqual(result.activeRetracement, before.activeRetracement);
        assert.deepEqual(result.candleReplaySteps, before.candleReplaySteps);
        assert.equal(result.unclosedCandleExcluded, true);
      }
    });

    it('replay matches every closed-candle prefix with immutable confirmed points and no lookahead', () => {
      const rows = [...qualifiedRows, micro, resume, [121,123,112,115], [115,118,108,110], [110,114,104,107], [107,110,100,103], [103,130,102,126]] as Row[];
      const input = candles(rows, mirror);
      const full = detect(input, parameters(mirror));
      for (let length = 2; length <= input.length; length++) {
        const prefix = detect(input.slice(0, length), parameters(mirror));
        assert.deepEqual(prefix.candleReplaySteps, full.candleReplaySteps?.slice(0, length));
        assert.deepEqual(prefix.points, full.points.filter(p => p.confirmationCandleIndex! < length));
      }
      assert.equal(full.points.length, 6);
      assert.equal(new Set(full.points.map(p => p.candleOpenTimeUnix)).size, full.points.length);
      assert.deepEqual(detect(input, parameters(mirror)).points, full.points);
    });
  });
}

describe('causal warm-up seeding', () => {
  const seedCycle: Row[] = [[85,90,80,86],[89,102,88,101],[101,101,99,100],[100,100,97,98],[98,99,95,96],[96,97,93,95],[95,99,94,98]];
  const warmParams = { initializationSearchCandles: 70, minimumRetracementCandles: 4, minimumRetracementFib: 0.382 };

  it('does not materialize a future or forming manual seed anchor', () => {
    const input = candles([...seedRows, [86, 92, 84, 88]]);
    const params = parameters();
    params.manualStart!.bottom.candleTime = new Date(BASE + 10 * 300_000).toISOString();
    params.manualStart!.bottom.candleTimeUnix = BASE + 10 * 300_000;
    assert.equal(detect(input, params).points.length, 0);
    input[1].isClosed = false;
    assert.equal(detect(input, parameters()).points.length, 0);
  });

  it('does not seed a qualified four-bar micro cycle without expansion confirmation', () => {
    const result = detect(candles(seedCycle), warmParams);
    assert.equal(result.activeRange, null);
    assert.equal(result.points.length, 0);
    assert.equal(result.stateLabel, 'UNINITIALIZED');
  });

  it('seeds the first completed cycle and carries the confirming candle into the next expansion', () => {
    const result = detect(candles([...seedCycle, [98,110,97,105]]), warmParams);
    assert.deepEqual(result.points.map(p => [p.type,p.price]), [['HH',102],['HL',93]]);
    assert.equal(result.activeRetracement?.candidatePrice, 110);
    assert.ok(result.candleReplaySteps?.slice(0,7).every(s => s.activeRange === null));
    assert.ok(result.points.every(p => p.confirmationCandleIndex === 7));
  });

  it('does not choose a later independent seed over the external parent established earlier', () => {
    const rows: Row[] = [...seedCycle,[98,110,97,105],[105,109,103,106],[106,108,102,104],[104,107,101,103],[103,106,100,102],[102,106,101,105]];
    const result = detect(candles(rows), warmParams);
    assert.equal(result.points.length, 2);
    assert.equal(result.activeRange?.top.price, 102);
    assert.equal(result.activeRange?.bottom.price, 93);
    assert.ok(result.activeRetracement?.isFullyQualified);
  });

  it('matches sequential prefixes throughout warm-up and after subsequent confirmation', () => {
    const input = candles([...seedCycle,[98,110,97,105],[105,109,103,106],[106,108,102,104],[104,107,101,103],[103,106,100,102],[102,106,101,105],[105,115,104,111]]);
    const full = detect(input, warmParams);
    for (let length = 2; length <= input.length; length++) {
      const prefix = detect(input.slice(0,length), warmParams);
      assert.deepEqual(prefix.points, full.points.filter(p => p.confirmationCandleIndex! < length));
      assert.deepEqual(prefix.candleReplaySteps, full.candleReplaySteps?.slice(0,length));
    }
    assert.equal(full.points.length, 4);
  });

  it('invalidates a prospective seed if its opposing prefix boundary closes through first', () => {
    const input = candles([...seedCycle,[98,105,75,79],[79,120,78,110]]);
    const result = detect(input, warmParams);
    assert.equal(result.points.length, 0);
    assert.equal(result.activeRange, null);
  });
});
