import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NormalizedMarketCandle } from '../../marketData/mexcPublicMarketClient';
import { structureEngine } from '../structureEngine';
import { detectStructureV5RangeLocked } from '../structureV5Engine';
import {
  ALGORITHM_VERSION_V5,
  ALGORITHM_VERSION_V5_REV4,
  StructurePointType,
  StructureState,
} from '../structureTypes';

describe('STRUCTURE_V5_RANGE_LOCKED Engine Acceptance Suite', () => {
  const baseUnix = 1700000000000;

  function createCandle(
    index: number,
    open: number,
    high: number,
    low: number,
    close: number,
    isClosed: boolean = true
  ): NormalizedMarketCandle {
    const unix = baseUnix + index * 300000;
    return {
      id: `c_${index}`,
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
      isClosed,
      source: 'MEXC_PUBLIC',
    };
  }

  it('Test 1 (Section 32): Exact ETH Acceptance Test', () => {
    // Initial bearish: LH1 ≈ 2513, LL1 ≈ 2473
    const candles: NormalizedMarketCandle[] = [];

    // Candle 0: LH1 candle (high 2513)
    candles.push(createCandle(0, 2510, 2513, 2505, 2508));
    // Candle 1: Drop down to LL1 (low 2473)
    candles.push(createCandle(1, 2508, 2509, 2473, 2476));

    // Internal movements inside range [2473, 2513]
    candles.push(createCandle(2, 2476, 2490, 2475, 2488));
    candles.push(createCandle(3, 2488, 2505, 2485, 2500));
    candles.push(createCandle(4, 2500, 2502, 2480, 2482));
    candles.push(createCandle(5, 2482, 2485, 2474, 2475));

    // Candle 6: Candle closes below LL1 (2473) -> Break to 2471!
    candles.push(createCandle(6, 2475, 2476, 2470, 2471));

    // Candles 7-9: Bearish expansion pushing down to 2464
    candles.push(createCandle(7, 2471, 2472, 2468, 2469));
    candles.push(createCandle(8, 2469, 2470, 2465, 2466));
    candles.push(createCandle(9, 2466, 2467, 2464, 2464)); // lowest low = 2464 (LL2)

    // Candles 10-14: Retracement upward to 2506
    candles.push(createCandle(10, 2464, 2480, 2464, 2478)); // bounce begins
    candles.push(createCandle(11, 2478, 2495, 2476, 2492));
    candles.push(createCandle(12, 2492, 2506, 2490, 2504)); // highest high = 2506 (LH2)
    candles.push(createCandle(13, 2504, 2505, 2490, 2492)); // roll over
    candles.push(createCandle(14, 2492, 2495, 2470, 2472));

    // Candle 15 (Section 7): WICK below 2464 (Low = 2461) BUT Close = 2466!
    candles.push(createCandle(15, 2472, 2473, 2461, 2466));

    // Candle 16: Still inside range
    candles.push(createCandle(16, 2466, 2470, 2464, 2468));

    // Candle 17 (Section 8): Later body-close break below 2464 -> Close = 2460!
    candles.push(createCandle(17, 2468, 2468, 2458, 2460));

    // Candle 18-19: Expansion to 2444 (LL3)
    candles.push(createCandle(18, 2460, 2461, 2450, 2452));
    candles.push(createCandle(19, 2452, 2453, 2444, 2444)); // reaches 2444

    const result = detectStructureV5RangeLocked(candles, {
      analysisCandles: 20,
      initializationSearchCandles: 2,
      manualStart: {
        direction: 'BEARISH',
        top: { price: 2513, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 2473, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });

    // 1. Verify wick on Candle 15 did NOT create a break or new LL
    const wickRejection = result.rejectedEvents?.find(
      (r) => r.candleIndex === 15 || (r.price === 2461 && r.attemptedLevel === 2464)
    );
    assert.ok(wickRejection, 'Wick on candle 15 should be logged as rejected invalidation');

    // 2. Verify points: LH1 (2513), LL1 (2473), LL2 (2464), LH2 (2506)
    const lhPoints = result.points.filter((p) => p.type === StructurePointType.LH);
    const llPoints = result.points.filter((p) => p.type === StructurePointType.LL);

    assert.strictEqual(lhPoints[0]?.price, 2513, 'LH1 should be 2513');
    assert.strictEqual(llPoints[0]?.price, 2473, 'LL1 should be 2473');
    assert.strictEqual(llPoints[1]?.price, 2464, 'LL2 should be 2464');
    assert.strictEqual(lhPoints[1]?.price, 2506, 'LH2 should be 2506');

    // 3. Verify break events: Exactly 2 continuation breaks (one for LL1 @ 2473, one for LL2 @ 2464)
    assert.strictEqual(
      result.structureBreakEvents?.length,
      2,
      'Exactly two continuation breaks should be emitted'
    );
    assert.strictEqual(result.structureBreakEvents?.[0].brokenLevel, 2473);
    assert.strictEqual(result.structureBreakEvents?.[1].brokenLevel, 2464);
  });

  it('Test 2 (Section 33): Internal Range Acceptance Test', () => {
    // Active bearish range: LH = 100, LL = 80
    // Sequence of 8 candles: 90, 95, 85, 92, 82, 98, 84, 81. All closes > 80 and < 100.
    const candles: NormalizedMarketCandle[] = [];
    candles.push(createCandle(0, 95, 100, 90, 95)); // LH = 100
    candles.push(createCandle(1, 95, 96, 80, 85)); // LL = 80

    const internalCloses = [90, 95, 85, 92, 82, 98, 84, 81];
    internalCloses.forEach((c, idx) => {
      candles.push(createCandle(idx + 2, c, Math.min(99, c + 2), Math.max(81, c - 2), c));
    });

    const result = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });

    // Zero new structure events
    assert.strictEqual(
      result.structureBreakEvents?.length,
      0,
      'Internal movement must produce zero break events'
    );

    // Active range remains 100 -> 80
    assert.strictEqual(result.activeRange?.top.price, 100);
    assert.strictEqual(result.activeRange?.bottom.price, 80);

    // Only initial LH1 and LL1 in points list
    assert.strictEqual(result.points.length, 2, 'No internal points should be created');
  });

  it('Test 3 (Section 34): Wick Acceptance Test', () => {
    // Active bearish: LL = 80
    const candles: NormalizedMarketCandle[] = [];
    candles.push(createCandle(0, 95, 100, 90, 95)); // LH = 100
    candles.push(createCandle(1, 95, 95, 80, 85)); // LL = 80

    // Candle 2: Low = 77, Close = 81 -> NO BREAK
    candles.push(createCandle(2, 85, 86, 77, 81));

    let res1 = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });
    assert.strictEqual(res1.structureBreakEvents?.length, 0, 'Wick below 80 must not break');

    // Candle 3: Low = 78, Close = 79 -> VALID BREAK
    candles.push(createCandle(3, 81, 82, 78, 79));

    let res2 = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });
    assert.strictEqual(res2.structureBreakEvents?.length, 1, 'Body close at 79 must break 80');
    assert.strictEqual(res2.structureBreakEvents?.[0].brokenLevel, 80);
  });

  it('Test 4 (Section 35): Bullish Mirror Test', () => {
    // Active: HL = 80, HH = 100
    const candles: NormalizedMarketCandle[] = [];
    candles.push(createCandle(0, 85, 90, 80, 85)); // HL = 80
    candles.push(createCandle(1, 85, 100, 84, 98)); // HH = 100

    // Candle 2: High = 103, Close = 99 -> NO BREAK
    candles.push(createCandle(2, 98, 103, 97, 99));

    let res1 = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BULLISH',
        top: { price: 100, candleTime: candles[1].openTime, candleIndex: 1 },
        bottom: { price: 80, candleTime: candles[0].openTime, candleIndex: 0 },
      },
    });
    assert.strictEqual(res1.structureBreakEvents?.length, 0, 'Wick above 100 must not break');

    // Candle 3: Close = 101 -> VALID BREAK
    candles.push(createCandle(3, 99, 102, 98, 101));

    let res2 = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BULLISH',
        top: { price: 100, candleTime: candles[1].openTime, candleIndex: 1 },
        bottom: { price: 80, candleTime: candles[0].openTime, candleIndex: 0 },
      },
    });
    assert.strictEqual(res2.structureBreakEvents?.length, 1, 'Body close at 101 must break 100');
    assert.strictEqual(res2.structureBreakEvents?.[0].brokenLevel, 100);
  });

  it('Test 5 (Section 36): One Event Per Break Test', () => {
    // Close below LL occurs once, and next 10 candles remain below old LL -> exactly ONE break event
    const candles: NormalizedMarketCandle[] = [];
    candles.push(createCandle(0, 95, 100, 90, 95)); // LH = 100
    candles.push(createCandle(1, 95, 96, 80, 82)); // LL = 80

    // Candle 2: Breaks below 80 -> Close = 78
    candles.push(createCandle(2, 82, 82, 77, 78));

    // Next 10 candles remain below 80
    for (let i = 3; i <= 12; i++) {
      candles.push(createCandle(i, 78, 79, 76, 77));
    }

    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });

    assert.strictEqual(
      res.structureBreakEvents?.length,
      1,
      'Must emit exactly one break event even when 10 subsequent candles remain below old LL'
    );
  });

  it('Test 6 (Section 19): Bearish to Bullish Reversal Test', () => {
    // Active bearish range: LH = 100, LL = 80
    const candles: NormalizedMarketCandle[] = [];
    candles.push(createCandle(0, 95, 100, 90, 95)); // LH = 100
    candles.push(createCandle(1, 95, 96, 80, 82)); // LL = 80

    // Candle 2: Wick above 100 (high 102), but close 98 -> NO REVERSAL
    candles.push(createCandle(2, 85, 102, 85, 98));

    let res1 = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });
    assert.strictEqual(res1.structureBreakEvents?.length, 0);

    // Candle 3: Body close above 100 -> Close 104 -> REVERSAL TO BULLISH
    candles.push(createCandle(3, 98, 105, 98, 104));

    let res2 = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });

    assert.strictEqual(res2.structureBreakEvents?.length, 1);
    assert.strictEqual(res2.structureBreakEvents?.[0].breakType, 'BEARISH_STRUCTURE_BROKEN');
    assert.strictEqual(res2.structureBreakEvents?.[0].brokenLevel, 100);
    assert.strictEqual(res2.activeRange?.direction, 'BULLISH');
  });

  it('Test 7: Dispatcher runs V5 engine when requested', () => {
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 95, 100, 90, 95),
      createCandle(1, 95, 96, 80, 82),
      createCandle(2, 82, 82, 77, 78),
    ];
    const res = structureEngine.detectStructure(candles, {
      algorithmVersion: ALGORITHM_VERSION_V5_REV4,
    });
    assert.strictEqual(res.algorithmVersion, ALGORITHM_VERSION_V5_REV4);
    assert.strictEqual(res.internalStructureIgnored, true);
  });

  // =========================================================================
  // DETERMINISTIC TEST MATRIX: SCENARIOS A - K
  // =========================================================================

  it('Scenario A: Bearish Range-Locked Inside Price Action', () => {
    // Range: LH = 100, LL = 80
    // 5 candles completely inside [80, 100]
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 95, 100, 92, 95),
      createCandle(1, 95, 96, 80, 83),
      createCandle(2, 83, 90, 82, 88),
      createCandle(3, 88, 97, 86, 94),
      createCandle(4, 94, 95, 84, 86),
      createCandle(5, 86, 89, 81, 85),
    ];
    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });

    assert.strictEqual(res.structureBreakEvents?.length, 0, 'No break events should occur inside range');
    assert.strictEqual(res.rejectedEvents?.length, 0, 'No wick rejections inside range');
    assert.strictEqual(res.structureState, StructureState.BEARISH);
    assert.strictEqual(res.activeRange?.top.price, 100);
    assert.strictEqual(res.activeRange?.bottom.price, 80);
    assert.strictEqual(res.activeRange?.top.type, StructurePointType.LH);
    assert.strictEqual(res.activeRange?.bottom.type, StructurePointType.LL);
  });

  it('Scenario B: Wick-Only Breach Below Active LL', () => {
    // Range: LH = 100, LL = 80
    // Candle 2: Wick drops to 78, but Close is 82 >= 80
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 95, 100, 92, 95),
      createCandle(1, 95, 96, 80, 83),
      createCandle(2, 83, 85, 78, 82),
    ];
    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });

    assert.strictEqual(res.structureBreakEvents?.length, 0, 'Wick breach must NOT trigger a break event');
    assert.strictEqual(res.rejectedEvents?.length, 1, 'Exactly one wick rejection must be recorded');
    assert.strictEqual(res.rejectedEvents?.[0].attemptedLevel, 80);
    assert.strictEqual(res.rejectedEvents?.[0].actualValue, 78);
    assert.strictEqual(res.rejectedEvents?.[0].rejectionType, 'REJECTED_INVALIDATION');
    assert.strictEqual(res.activeRange?.bottom.price, 80, 'LL anchor must remain unchanged');
  });

  it('Scenario C: Wick-Only Breach Above Active LH', () => {
    // Range: LH = 100, LL = 80
    // Candle 2: Wick reaches 103, but Close is 98 <= 100
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 95, 100, 92, 95),
      createCandle(1, 95, 96, 80, 83),
      createCandle(2, 85, 103, 85, 98),
    ];
    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });

    assert.strictEqual(res.structureBreakEvents?.length, 0, 'Wick breach must NOT trigger reversal');
    assert.strictEqual(res.rejectedEvents?.length, 1, 'Exactly one wick rejection must be recorded');
    assert.strictEqual(res.rejectedEvents?.[0].attemptedLevel, 100);
    assert.strictEqual(res.rejectedEvents?.[0].actualValue, 103);
    assert.strictEqual(res.structureState, StructureState.BEARISH, 'Structure must remain BEARISH');
    assert.strictEqual(res.activeRange?.top.price, 100);
  });

  it('Scenario D: Valid Body-Close Continuation Break Below Active LL', () => {
    // Range: LH = 100, LL = 80
    // Candle 2: Close = 76 < 80 -> Triggers expansion and continuation break
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 95, 100, 92, 95),
      createCandle(1, 95, 96, 80, 83),
      createCandle(2, 83, 83, 75, 76),
    ];
    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });

    assert.strictEqual(res.structureBreakEvents?.length, 1);
    assert.strictEqual(res.structureBreakEvents?.[0].breakType, 'BEARISH_CONTINUATION');
    assert.strictEqual(res.structureBreakEvents?.[0].brokenLevel, 80);
    assert.strictEqual(res.engineState?.phase, 'EXPANSION');
  });

  it('Scenario E: Bearish Expansion Pushing Lower Across Multiple Candles', () => {
    // Range: LH = 100, LL = 80
    // Candle 2: Close = 78 (enters expansion, low 77)
    // Candle 3: Low = 73, Close = 74
    // Candle 4: Low = 70, Close = 71
    // Candle 5: Bounce begins (Low = 72, Close = 76) -> completes expansion, confirms LL @ 70
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 95, 100, 92, 95),
      createCandle(1, 95, 96, 80, 83),
      createCandle(2, 83, 83, 77, 78),
      createCandle(3, 78, 79, 73, 74),
      createCandle(4, 74, 75, 70, 71),
      createCandle(5, 71, 77, 72, 76),
    ];
    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });

    assert.strictEqual(res.structureBreakEvents?.length, 1);
    assert.strictEqual(res.structureBreakEvents?.[0].brokenLevel, 80);
    const llPoints = res.points.filter((p) => p.type === StructurePointType.LL);
    assert.ok(llPoints.length >= 2, 'Should have initial LL and newly confirmed LL');
    const latestLL = llPoints[llPoints.length - 1];
    assert.strictEqual(latestLL.price, 70, 'Expansion lowest low 70 must be confirmed as new LL');
    assert.strictEqual(res.activeRange?.bottom.price, 70);
    assert.strictEqual(res.activeRange?.bottom.type, StructurePointType.LL);
    assert.strictEqual(res.activeRange?.top.type, StructurePointType.LH);
    assert.strictEqual(res.engineState?.phase, 'RANGE_LOCKED');
  });

  it('Scenario F: Valid Body-Close Reversal Break Above Active LH', () => {
    // Range: LH = 100, LL = 80
    // Candle 2: Reversal candle, body close = 105 > 100 (high 106)
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 95, 100, 92, 95),
      createCandle(1, 95, 96, 80, 83),
      createCandle(2, 85, 106, 84, 105),
    ];
    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 100, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 80, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });

    assert.strictEqual(res.structureBreakEvents?.length, 1);
    assert.strictEqual(res.structureBreakEvents?.[0].breakType, 'BEARISH_STRUCTURE_BROKEN');
    assert.strictEqual(res.structureBreakEvents?.[0].brokenLevel, 100);
    assert.strictEqual(res.structureState, StructureState.BULLISH);
    assert.strictEqual(res.activeRange?.direction, 'BULLISH');
    assert.strictEqual(res.activeRange?.top.type, StructurePointType.HH);
    assert.strictEqual(res.activeRange?.bottom.type, StructurePointType.HL);
    assert.strictEqual(res.activeRange?.top.price, 106);
    assert.ok(res.activeRange?.top.price > (res.activeRange?.bottom.price ?? 0));
  });

  it('Scenario G: Bullish Range-Locked Inside Price Action', () => {
    // Range: HH = 100, HL = 80
    // Candles inside [80, 100]
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 85, 88, 80, 85),
      createCandle(1, 85, 100, 84, 96),
      createCandle(2, 96, 98, 88, 92),
      createCandle(3, 92, 95, 83, 87),
    ];
    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BULLISH',
        top: { price: 100, candleTime: candles[1].openTime, candleIndex: 1 },
        bottom: { price: 80, candleTime: candles[0].openTime, candleIndex: 0 },
      },
    });

    assert.strictEqual(res.structureBreakEvents?.length, 0);
    assert.strictEqual(res.rejectedEvents?.length, 0);
    assert.strictEqual(res.structureState, StructureState.BULLISH);
    assert.strictEqual(res.activeRange?.top.type, StructurePointType.HH);
    assert.strictEqual(res.activeRange?.bottom.type, StructurePointType.HL);
  });

  it('Scenario H: Bullish Wick-Only Breach Above Active HH', () => {
    // Range: HH = 100, HL = 80
    // Candle 2: High = 104, Close = 97 <= 100
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 85, 88, 80, 85),
      createCandle(1, 85, 100, 84, 96),
      createCandle(2, 96, 104, 95, 97),
    ];
    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BULLISH',
        top: { price: 100, candleTime: candles[1].openTime, candleIndex: 1 },
        bottom: { price: 80, candleTime: candles[0].openTime, candleIndex: 0 },
      },
    });

    assert.strictEqual(res.structureBreakEvents?.length, 0);
    assert.strictEqual(res.rejectedEvents?.length, 1);
    assert.strictEqual(res.rejectedEvents?.[0].attemptedLevel, 100);
    assert.strictEqual(res.rejectedEvents?.[0].actualValue, 104);
    assert.strictEqual(res.activeRange?.top.price, 100);
  });

  it('Scenario I: Bullish Wick-Only Breach Below Active HL', () => {
    // Range: HH = 100, HL = 80
    // Candle 2: Low = 77, Close = 83 >= 80
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 85, 88, 80, 85),
      createCandle(1, 85, 100, 84, 96),
      createCandle(2, 96, 96, 77, 83),
    ];
    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BULLISH',
        top: { price: 100, candleTime: candles[1].openTime, candleIndex: 1 },
        bottom: { price: 80, candleTime: candles[0].openTime, candleIndex: 0 },
      },
    });

    assert.strictEqual(res.structureBreakEvents?.length, 0);
    assert.strictEqual(res.rejectedEvents?.length, 1);
    assert.strictEqual(res.rejectedEvents?.[0].attemptedLevel, 80);
    assert.strictEqual(res.rejectedEvents?.[0].actualValue, 77);
    assert.strictEqual(res.structureState, StructureState.BULLISH);
  });

  it('Scenario J: Valid Body-Close Bullish Continuation Break Above Active HH', () => {
    // Range: HH = 100, HL = 80
    // Candle 2: Retracement to 88 (low 87)
    // Candle 3: Close = 104 > 100 (high 105)
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 85, 88, 80, 85),
      createCandle(1, 85, 100, 84, 96),
      createCandle(2, 96, 96, 87, 88),
      createCandle(3, 88, 105, 88, 104),
    ];
    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BULLISH',
        top: { price: 100, candleTime: candles[1].openTime, candleIndex: 1 },
        bottom: { price: 80, candleTime: candles[0].openTime, candleIndex: 0 },
      },
    });

    assert.strictEqual(res.structureBreakEvents?.length, 1);
    assert.strictEqual(res.structureBreakEvents?.[0].breakType, 'BULLISH_CONTINUATION');
    assert.strictEqual(res.structureBreakEvents?.[0].brokenLevel, 100);
    assert.strictEqual(res.engineState?.phase, 'EXPANSION');
  });

  it('Scenario K: Same Price / Opposite Type Immutability Test', () => {
    // Verify an event confirmed as LL is NEVER converted to HL or reused with changed type
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 2510, 2513, 2505, 2508), // LH1 @ 2513
      createCandle(1, 2508, 2509, 2464.62, 2470), // LL1 @ 2464.62
      createCandle(2, 2470, 2475, 2468, 2472),
      createCandle(3, 2472, 2515, 2470, 2514), // Reversal break above 2513
    ];
    const res = detectStructureV5RangeLocked(candles, {
      manualStart: {
        direction: 'BEARISH',
        top: { price: 2513, candleTime: candles[0].openTime, candleIndex: 0 },
        bottom: { price: 2464.62, candleTime: candles[1].openTime, candleIndex: 1 },
      },
    });

    // 1. Initial LL point must have type LL
    const initialLL = res.points.find((p) => p.price === 2464.62);
    assert.ok(initialLL, 'Point at 2464.62 must exist');
    assert.strictEqual(initialLL.type, StructurePointType.LL, 'Anchor at 2464.62 must be LL');

    // 2. No point in points array with the initial LL ID should have type HL or LH
    const reusedPoints = res.points.filter((p) => p.id === initialLL.id);
    for (const rp of reusedPoints) {
      assert.strictEqual(rp.type, StructurePointType.LL, 'Immutable eventId must never mutate type');
    }

    // 3. Reversal created Bullish structure
    assert.strictEqual(res.structureState, StructureState.BULLISH);
    assert.strictEqual(res.activeRange?.top.type, StructurePointType.HH);
    assert.strictEqual(res.activeRange?.bottom.type, StructurePointType.HL);

    // 4. Invalidation break was above 2513, NEVER above 2464.62
    assert.strictEqual(res.structureBreakEvents?.[0].breakType, 'BEARISH_STRUCTURE_BROKEN');
    assert.strictEqual(res.structureBreakEvents?.[0].brokenLevel, 2513);
  });
});

