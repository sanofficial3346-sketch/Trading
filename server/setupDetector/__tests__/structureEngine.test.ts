import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import { mexcPublicMarketClient, NormalizedMarketCandle } from '../../marketData/mexcPublicMarketClient';
import { candleRepository } from '../../marketData/candleRepository';
import { structureEngine, STRUCTURE_LOOKBACK_CANDLES } from '../structureEngine';
import { StructurePointType, StructureStrength } from '../structureTypes';

describe('Public Market Data Normalization & Ingestion', () => {
  it('normalizes MEXC public contract array format correctly', () => {
    // Array format: [timeSec, open, close, high, low, vol, amount]
    const rawArray = [1788799800, 78949.9, 78970.5, 78983.6, 78931.1, 1974854, 15593931.50292];
    const nowUnix = 1788800500000; // After candle close (5m = 300s = 300,000ms later)

    const normalized = mexcPublicMarketClient.normalizeCandleData(
      rawArray[0],
      rawArray[1],
      rawArray[3],
      rawArray[4],
      rawArray[2],
      rawArray[5],
      rawArray[6],
      'BTC_USDT',
      '5M',
      nowUnix
    );

    assert.strictEqual(normalized.symbol, 'BTC_USDT');
    assert.strictEqual(normalized.timeframe, '5M');
    assert.strictEqual(normalized.openTimeUnix, 1788799800000);
    assert.strictEqual(normalized.openTime, '2026-09-07T16:50:00.000Z');
    assert.strictEqual(normalized.open, 78949.9);
    assert.strictEqual(normalized.close, 78970.5);
    assert.strictEqual(normalized.high, 78983.6);
    assert.strictEqual(normalized.low, 78931.1);
    assert.strictEqual(normalized.volume, 1974854);
    assert.strictEqual(normalized.isClosed, true);
    assert.strictEqual(normalized.source, 'MEXC_PUBLIC');
  });

  it('correctly flags currently forming candle as unclosed', () => {
    const candleStartSec = Math.floor(Date.now() / 1000); // starts now
    const rawArray = [candleStartSec, 79000, 79010, 79020, 78990, 100, 790000];

    const normalized = mexcPublicMarketClient.normalizeCandleData(
      rawArray[0],
      rawArray[1],
      rawArray[3],
      rawArray[4],
      rawArray[2],
      rawArray[5],
      rawArray[6],
      'BTC_USDT',
      '5M',
      Date.now()
    );
    assert.strictEqual(normalized.isClosed, false);
  });

  it('orders candles chronologically and avoids duplicates', async () => {
    const baseTime = 1700000000000;
    const testCandles: NormalizedMarketCandle[] = [
      {
        id: 'c1',
        symbol: 'TEST_BTC',
        timeframe: '5M',
        openTime: new Date(baseTime + 300000).toISOString(),
        openTimeUnix: baseTime + 300000,
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 10,
        amount: 1000,
        isClosed: true,
        source: 'MEXC_PUBLIC',
      },
      {
        id: 'c0',
        symbol: 'TEST_BTC',
        timeframe: '5M',
        openTime: new Date(baseTime).toISOString(),
        openTimeUnix: baseTime,
        open: 98,
        high: 101,
        low: 97,
        close: 100,
        volume: 8,
        amount: 800,
        isClosed: true,
        source: 'MEXC_PUBLIC',
      },
      // Duplicate of c0 with updated close
      {
        id: 'c0_dup',
        symbol: 'TEST_BTC',
        timeframe: '5M',
        openTime: new Date(baseTime).toISOString(),
        openTimeUnix: baseTime,
        open: 98,
        high: 101,
        low: 97,
        close: 100.5,
        volume: 9,
        amount: 900,
        isClosed: true,
        source: 'MEXC_PUBLIC',
      },
    ];

    const result = await candleRepository.saveCandles(testCandles);
    assert.strictEqual(result.inserted, 2);
    assert.strictEqual(result.updated, 1);

    const stored = await candleRepository.getCandles('TEST_BTC', '5M', 10);
    assert.strictEqual(stored.length, 2);
    assert.strictEqual(stored[0].openTimeUnix, baseTime);
    assert.strictEqual(stored[1].openTimeUnix, baseTime + 300000);
    assert.strictEqual(stored[0].close, 100.5); // updated
  });
});

describe('Market Structure Engine (V2 Retracement Qualified)', () => {
  function makeCandle(
    index: number,
    high: number,
    low: number,
    isClosed: boolean = true
  ): NormalizedMarketCandle {
    const unix = 1700000000000 + index * 300000;
    return {
      id: `synthetic_${index}`,
      symbol: 'SYN_USDT',
      timeframe: '5M',
      openTime: new Date(unix).toISOString(),
      openTimeUnix: unix,
      open: (high + low) / 2,
      high,
      low,
      close: (high + low) / 2,
      volume: 100,
      amount: 10000,
      isClosed,
      source: 'MEXC_PUBLIC',
    };
  }

  it('supports legacy pivot comparison overlay when requested', () => {
    // 7 candles with peak at 2 and valley at 4
    const candles: NormalizedMarketCandle[] = [
      makeCandle(0, 100, 90),
      makeCandle(1, 105, 92),
      makeCandle(2, 120, 95),
      makeCandle(3, 110, 85),
      makeCandle(4, 95, 70),
      makeCandle(5, 100, 80),
      makeCandle(6, 105, 88),
    ];

    const result = structureEngine.detectStructure(candles, {
      legacyPivotOverlay: true,
      pivotLeftBars: 2,
      pivotRightBars: 2,
      lookbackCandles: 350,
    });

    assert.ok(result.legacyPoints);
    assert.strictEqual(result.legacyPoints.length, 2);

    const sh = result.legacyPoints.find((p) => p.type === StructurePointType.SWING_HIGH);
    assert.ok(sh);
    assert.strictEqual(sh.price, 120);

    const sl = result.legacyPoints.find((p) => p.type === StructurePointType.SWING_LOW);
    assert.ok(sl);
    assert.strictEqual(sl.price, 70);
  });

  it('strictly excludes unclosed forming candle from structure evaluation', () => {
    const candles: NormalizedMarketCandle[] = [
      makeCandle(0, 100, 90, true),
      makeCandle(1, 105, 92, true),
      makeCandle(2, 120, 95, true),
      makeCandle(3, 110, 85, true),
      makeCandle(4, 100, 80, false), // UNCLOSED!
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
    });

    assert.strictEqual(result.unclosedCandleExcluded, true);
    assert.strictEqual(result.closedCandlesEvaluated, 4);
  });

  it('limits lookback to exactly user-specified closed candles count when larger history is supplied', () => {
    const candles: NormalizedMarketCandle[] = [];
    for (let i = 0; i < 500; i++) {
      const high = 200 + (i % 20);
      const low = 100 + (i % 15);
      candles.push(makeCandle(i, high, low, true));
    }

    const result = structureEngine.detectStructure(candles, {
      algorithmVersion: 'STRUCTURE_V2_RETRACEMENT',
      lookbackCandles: 350,
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
    });

    assert.strictEqual(result.totalCandlesAvailable, 500);
    assert.strictEqual(result.closedCandlesEvaluated, 350);
    assert.strictEqual(result.algorithmVersion, 'STRUCTURE_V2_RETRACEMENT');
  });
});

describe('STRUCTURE_V6_FIB_QUALIFIED_RANGE Engine Tests', () => {
  function makeCandle(
    index: number,
    open: number,
    high: number,
    low: number,
    close: number
  ): NormalizedMarketCandle {
    const unix = 1700000000000 + index * 300000;
    return {
      id: `v6_synth_${index}`,
      symbol: 'ETH_USDT',
      timeframe: '5M',
      openTime: new Date(unix).toISOString(),
      openTimeUnix: unix,
      open,
      high,
      low,
      close,
      volume: 100,
      amount: 10000,
      isClosed: true,
      source: 'MEXC_PUBLIC',
    };
  }

  it('Test 28: ignores wick-only breaches and does not trigger expansion', () => {
    // Start with seeded Bearish structure: LH1 = 100, LL1 = 80
    const candles: NormalizedMarketCandle[] = [
      makeCandle(0, 95, 100, 90, 92), // seed top
      makeCandle(1, 90, 91, 80, 82),  // seed bottom
      makeCandle(2, 82, 84, 75, 82),  // Wick breaches LL (low 75 < 80) but close 82 >= 80 -> WICK ONLY
      makeCandle(3, 82, 85, 81, 84),  // Inside range
    ];

    const result = structureEngine.detectStructure(candles, {
      algorithmVersion: 'STRUCTURE_V6_FIB_QUALIFIED_RANGE',
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleTimeUnix: candles[0].openTimeUnix, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleTimeUnix: candles[1].openTimeUnix, candleIndex: 1 },
      },
    });

    // Should remain in RANGE_LOCKED, with no confirmed points other than initial seeds
    assert.strictEqual(result.points.length, 2);
    assert.strictEqual(result.activeRange?.top.price, 100);
    assert.strictEqual(result.activeRange?.bottom.price, 80);
    assert.strictEqual(result.rejectedEvents.length, 1);
    assert.strictEqual(result.rejectedEvents[0].rejectionType, 'REJECTED_LOW');
  });

  it('Test 25: does NOT confirm LL2/LH2 when retracement fails Fib 0.382 and extends same leg when lower low is made', () => {
    // Seed Bearish: LH1 = 100, LL1 = 80
    // Candle 2: body close below 80 -> candidate LL = 70
    // Candles 3-8: 6 candles retracement, max high = 76 (depth = (76-70)/30 = 0.20 < 0.382)
    // Candle 9: falls to 65 -> same candidate LL extends to 65
    const candles: NormalizedMarketCandle[] = [
      makeCandle(0, 95, 100, 90, 92),
      makeCandle(1, 90, 91, 80, 82),
      makeCandle(2, 79, 79, 70, 72),  // Body break: close 72 < 80, low 70.
      makeCandle(3, 72, 73, 71, 72),  // Retrace c1: high 73
      makeCandle(4, 72, 74, 72, 73),  // Retrace c2: high 74
      makeCandle(5, 73, 75, 72, 74),  // Retrace c3: high 75
      makeCandle(6, 74, 76, 73, 75),  // Retrace c4: high 76 (depth = 6/30 = 0.20 < 0.382)
      makeCandle(7, 75, 75, 72, 73),  // Retrace c5
      makeCandle(8, 73, 74, 70, 71),  // Retrace c6
      makeCandle(9, 71, 72, 65, 66),  // Lower low: candidate LL extends to 65!
    ];

    const result = structureEngine.detectStructure(candles, {
      algorithmVersion: 'STRUCTURE_V6_FIB_QUALIFIED_RANGE',
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleTimeUnix: candles[0].openTimeUnix, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleTimeUnix: candles[1].openTimeUnix, candleIndex: 1 },
      },
    });

    // NO new confirmed points yet because retracement failed to qualify
    assert.strictEqual(result.points.length, 2);
    // Active retracement info shows extended candidate LL @ 65
    assert.ok(result.activeRetracement);
    assert.strictEqual(result.activeRetracement.candidatePrice, 65);
    assert.strictEqual(result.activeRetracement.referencePrice, 100);
    // Fib required depth from 100 -> 65 is: 65 + 0.382 * 35 = 78.37
    assert.strictEqual(result.activeRetracement.isFullyQualified, false);
  });

  it('Test 26: confirms LL2 and LH2 when BOTH candle count >= 4 and Fib depth >= 0.382 are satisfied', () => {
    // Seed Bearish: LH1 = 100, LL1 = 80
    // Candle 2: body break close 72 < 80, low 70. Candidate LL = 70.
    // Fib target: 70 + 0.382 * 30 = 81.46.
    // Candles 3-7: 5 candles retracement reaching high of 83 (depth = 13/30 = 0.433 >= 0.382)
    const candles: NormalizedMarketCandle[] = [
      makeCandle(0, 95, 100, 90, 92),
      makeCandle(1, 90, 91, 80, 82),
      makeCandle(2, 79, 79, 70, 72), // Break: candidate LL = 70
      makeCandle(3, 72, 75, 71, 74), // Retrace c1
      makeCandle(4, 74, 78, 73, 77), // Retrace c2
      makeCandle(5, 77, 80, 76, 79), // Retrace c3
      makeCandle(6, 79, 83, 78, 81), // Retrace c4: high 83 (4 candles from candidate, depth = 0.433 >= 0.382) -> QUALIFIED!
      makeCandle(7, 81, 82, 79, 80), // Retrace c5
    ];

    const result = structureEngine.detectStructure(candles, {
      algorithmVersion: 'STRUCTURE_V6_FIB_QUALIFIED_RANGE',
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleTimeUnix: candles[0].openTimeUnix, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleTimeUnix: candles[1].openTimeUnix, candleIndex: 1 },
      },
    });

    // Should have 4 confirmed points: LH1, LL1, LL2, LH2
    assert.strictEqual(result.points.length, 4);
    const ll2 = result.points.find((p) => p.sequenceLabel === 'LL2');
    const lh2 = result.points.find((p) => p.sequenceLabel === 'LH2');
    assert.ok(ll2, 'LL2 must exist');
    assert.ok(lh2, 'LH2 must exist');
    assert.strictEqual(ll2.price, 70);
    assert.strictEqual(lh2.price, 83);

    // Active range locked: LH2 (83) <-> LL2 (70)
    assert.ok(result.activeRange);
    assert.strictEqual(result.activeRange.direction, 'BEARISH');
    assert.strictEqual(result.activeRange.top.price, 83);
    assert.strictEqual(result.activeRange.bottom.price, 70);
    // Invariant check: LH must always be higher than LL
    assert.ok(result.activeRange.top.price > result.activeRange.bottom.price);
  });

  it('Test 27: does NOT qualify when Fib depth >= 0.382 but candle count is only 2 or 3 (< 4 candles)', () => {
    // Seed Bearish: LH1 = 100, LL1 = 80
    // Candle 2: break to 70.
    // Candle 3: massive 1-candle spike to 85 (Fib depth = 15/30 = 0.50 >= 0.382), but only 1 candle!
    const candles: NormalizedMarketCandle[] = [
      makeCandle(0, 95, 100, 90, 92),
      makeCandle(1, 90, 91, 80, 82),
      makeCandle(2, 79, 79, 70, 72),
      makeCandle(3, 72, 85, 72, 78), // Depth is 50%, but only 1 candle from candidate LL!
    ];

    const result = structureEngine.detectStructure(candles, {
      algorithmVersion: 'STRUCTURE_V6_FIB_QUALIFIED_RANGE',
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleTimeUnix: candles[0].openTimeUnix, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleTimeUnix: candles[1].openTimeUnix, candleIndex: 1 },
      },
    });

    // Only seeds confirmed, not LL2/LH2
    assert.strictEqual(result.points.length, 2);
    assert.ok(result.activeRetracement);
    assert.strictEqual(result.activeRetracement.isCandleCountQualified, false);
    assert.strictEqual(result.activeRetracement.isFibDepthQualified, true);
    assert.strictEqual(result.activeRetracement.isFullyQualified, false);
  });
});
