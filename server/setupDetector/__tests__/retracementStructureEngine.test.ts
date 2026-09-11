import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NormalizedMarketCandle } from '../../marketData/mexcPublicMarketClient';
import { structureEngine } from '../structureEngine';
import { StructurePointType, StructureState } from '../structureTypes';

describe('Deterministic Retracement-Qualified Structure Engine (V2)', () => {
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
      symbol: 'BTC_USDT',
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

  // Base seed: Bullish with confirmed HL at 100 and confirmed HH at 200
  const bullishSeed = {
    state: StructureState.BULLISH,
    confirmedHL: { price: 100, candleIndex: 0 },
    confirmedHH: { price: 200, candleIndex: 1 },
  };

  // Base seed: Bearish with confirmed LH at 200 and confirmed LL at 100
  const bearishSeed = {
    state: StructureState.BEARISH,
    confirmedLH: { price: 200, candleIndex: 0 },
    confirmedLL: { price: 100, candleIndex: 1 },
  };

  it('Test A: High formed but retracement only 2 candles -> Expected: NO valid HH', () => {
    // Starting HL=100, HH=200. Range=100. Fib 0.382 level = 220 - 0.382 * 120 = 174.16
    // Bar 2: Closes above 200 at 210, peak high 220 (Candidate HH eligible)
    // Bar 3: drops to low 160 (depth reaches 0.382, but distance is only 1 bar: 3 - 2 = 1 bar)
    // Bar 4: low 165 (distance is still 1 bar to lowest point: 3 - 2 = 1 bar)
    // Total retracement bars to lowest point = 1 bar (< 4).
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 100, 105, 100, 104),
      createCandle(1, 104, 200, 104, 195),
      createCandle(2, 195, 220, 195, 210), // Candidate HH formed at 220
      createCandle(3, 210, 212, 160, 170), // Bar 1 of retracement: lowest low is 160
      createCandle(4, 170, 175, 165, 172), // Bar 2: low 165 > 160, lowest low remains at bar 3 (1 bar after candidate)
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bullishSeed,
    });

    // Should NOT have confirmed a new valid HH
    const confirmedNewHH = result.points.filter((p) => p.type === StructurePointType.HH && p.price === 220);
    assert.strictEqual(confirmedNewHH.length, 0);

    // Active provisional candidate HH should exist
    assert.ok(result.activeRetracement);
    assert.strictEqual(result.activeRetracement.candidatePrice, 220);
    assert.strictEqual(result.activeRetracement.isCandleCountQualified, false);
  });

  it('Test B: Retracement 5 candles but only reaches 0.25 Fib -> Expected: NO valid HH', () => {
    // HL=100, HH=200. Range from HL(100) to candidate HH(220) = 120.
    // 0.382 Fib price level = 220 - 0.382 * 120 = 174.16.
    // Retracement only drops to low 190 (depth = (220 - 190)/120 = 0.25 < 0.382).
    // But it has 5 candles.
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 100, 105, 100, 104),
      createCandle(1, 104, 200, 104, 195),
      createCandle(2, 195, 220, 195, 210), // Candidate HH at 220
      createCandle(3, 210, 215, 205, 208),
      createCandle(4, 208, 210, 200, 202),
      createCandle(5, 202, 205, 195, 198),
      createCandle(6, 198, 200, 192, 194),
      createCandle(7, 194, 195, 190, 191), // 5 candles after candidate (7 - 2 = 5), low 190 (depth 0.25)
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bullishSeed,
    });

    const confirmedNewHH = result.points.filter((p) => p.type === StructurePointType.HH && p.price === 220);
    assert.strictEqual(confirmedNewHH.length, 0);

    assert.ok(result.activeRetracement);
    assert.strictEqual(result.activeRetracement.isCandleCountQualified, true); // 5 >= 4
    assert.strictEqual(result.activeRetracement.isFibDepthQualified, false); // 0.25 < 0.382
    assert.strictEqual(result.activeRetracement.isFullyQualified, false);
  });

  it('Test C: Retracement 4 candles and reaches 0.382 Fib -> Expected: valid HH/HL', () => {
    // HL=100, HH=200. Candidate HH at 220 (range = 120).
    // Fib 0.382 level = 220 - 45.84 = 174.16.
    // Retracement drops below 174.16 at candle 6 (4 candles after candidate: 6 - 2 = 4).
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 100, 105, 100, 104),
      createCandle(1, 104, 200, 104, 195),
      createCandle(2, 195, 220, 195, 210), // Candidate HH at 220
      createCandle(3, 210, 215, 200, 205), // bar 1
      createCandle(4, 205, 208, 190, 195), // bar 2
      createCandle(5, 195, 198, 180, 182), // bar 3
      createCandle(6, 182, 185, 170, 172), // bar 4: low 170 <= 174.16 (touches 0.382!)
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bullishSeed,
    });

    // Valid HH and HL confirmed!
    const validHH = result.points.find((p) => p.type === StructurePointType.HH && p.price === 220);
    assert.ok(validHH, 'Expected valid HH at 220');

    const validHL = result.points.find((p) => p.type === StructurePointType.HL && p.price === 170);
    assert.ok(validHL, 'Expected valid HL at 170');

    // Candidate should now be cleared
    assert.strictEqual(result.activeRetracement, null);
    assert.strictEqual(result.structureState, StructureState.BULLISH);
  });

  it('Test D: Wick exceeds previous HH but close remains below -> Expected: NO HH break / no candidate HH', () => {
    // Prev HH is 200.
    // Candle 2: High is 205 (wicks above 200), but CLOSE is 198 (below 200).
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 100, 105, 100, 104),
      createCandle(1, 104, 200, 104, 195),
      createCandle(2, 195, 205, 190, 198), // Wick above 200, but close 198 <= 200!
      createCandle(3, 198, 199, 185, 188),
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bullishSeed,
    });

    // No candidate HH should have been created!
    assert.strictEqual(result.activeRetracement, null);
    const candidateEvents = result.eventLogs.filter((e) => e.eventType === 'CANDIDATE_CREATED');
    assert.strictEqual(candidateEvents.length, 0);
  });

  it('Test E: Close exceeds previous HH -> Expected: candidate HH allowed', () => {
    // Candle 2: Close is 205 (> 200).
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 100, 105, 100, 104),
      createCandle(1, 104, 200, 104, 195),
      createCandle(2, 195, 215, 192, 205), // Close 205 > 200!
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bullishSeed,
    });

    // Candidate HH allowed and tracked
    assert.ok(result.activeRetracement);
    assert.strictEqual(result.activeRetracement.candidatePrice, 215);
    assert.strictEqual(result.activeRetracement.candidateType, StructurePointType.PROVISIONAL_HH);
  });

  it('Test F: Wick breaks previous HL but close remains above -> Expected: bullish structure remains', () => {
    // Prev HL is 100.
    // Candle 2: Low is 95 (wicks below 100), but CLOSE is 105 (above 100).
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 100, 105, 100, 104),
      createCandle(1, 104, 200, 104, 195),
      createCandle(2, 195, 196, 95, 105), // Wick to 95 < 100, but close 105 > 100!
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bullishSeed,
    });

    // Bullish structure MUST remain
    assert.strictEqual(result.structureState, StructureState.BULLISH);
  });

  it('Test G: Close breaks previous HL -> Expected: BULLISH_STRUCTURE_BROKEN', () => {
    // Candle 2: CLOSE is 95 (< 100).
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 100, 105, 100, 104),
      createCandle(1, 104, 200, 104, 195),
      createCandle(2, 104, 104, 90, 95), // Close 95 < 100!
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bullishSeed,
    });

    // State MUST become BULLISH_STRUCTURE_BROKEN
    assert.strictEqual(result.structureState, StructureState.BULLISH_STRUCTURE_BROKEN);
  });

  it('Test H: Bullish structure break without LL/LH confirmation -> Expected: NOT yet bearish', () => {
    // Break occurred, followed by 1 or 2 small bars without qualified upward retracement
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 100, 105, 100, 104),
      createCandle(1, 104, 200, 104, 195),
      createCandle(2, 104, 104, 90, 95), // Breakdown close 95 < 100
      createCandle(3, 95, 98, 92, 94),
      createCandle(4, 94, 96, 91, 93),
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bullishSeed,
    });

    // MUST be in transitional state, NOT confirmed BEARISH yet!
    assert.strictEqual(result.structureState, StructureState.BULLISH_STRUCTURE_BROKEN);
    assert.notStrictEqual(result.structureState, StructureState.BEARISH);
  });

  it('Test I: Structure break + qualifying retracement + LL/LH sequence -> Expected: BEARISH', () => {
    // Prev HL = 100, Prev HH = 200.
    // Candle 2: Breaks HL, drops to candidate LL at 80 (range from HH 200 to LL 80 = 120).
    // Fib 0.382 target = 80 + 0.382 * 120 = 125.84.
    // Upward retracement:
    // Candle 3: high 100 (1 bar)
    // Candle 4: high 110 (2 bars)
    // Candle 5: high 120 (3 bars)
    // Candle 6: high 130 (4 bars: 6 - 2 = 4 bars, high 130 >= 125.84). Retracement qualifies!
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 100, 105, 100, 104),
      createCandle(1, 104, 200, 104, 195),
      createCandle(2, 104, 104, 80, 85), // Breakdown close 85 < 100, LL formed at 80
      createCandle(3, 85, 100, 82, 95),  // Retrace bar 1
      createCandle(4, 95, 110, 92, 105), // Retrace bar 2
      createCandle(5, 105, 120, 102, 115), // Retrace bar 3
      createCandle(6, 115, 130, 112, 125), // Retrace bar 4: high 130 >= 125.84!
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bullishSeed,
    });

    // Valid LL and LH confirmed, and state is BEARISH
    const validLL = result.points.find((p) => p.type === StructurePointType.LL && p.price === 80);
    assert.ok(validLL, 'Expected valid LL at 80');

    const validLH = result.points.find((p) => p.type === StructurePointType.LH && p.price === 130);
    assert.ok(validLH, 'Expected valid LH at 130');

    assert.strictEqual(result.structureState, StructureState.BEARISH);
  });

  // Mirror Bearish Tests
  it('Bearish Mirror Test A: Low formed but retracement only 2 candles -> Expected: NO valid LL', () => {
    // LH=200, LL=100. Candle 2 breaks LL to 80. Retraces only 2 candles.
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 200, 200, 195, 196),
      createCandle(1, 196, 196, 100, 105),
      createCandle(2, 105, 105, 80, 90), // Candidate LL at 80
      createCandle(3, 90, 140, 88, 130), // Retracement bar 1: highest high is 140
      createCandle(4, 130, 135, 125, 128), // Bar 2: high 135 < 140, highest high remains bar 3 (1 bar after candidate)
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bearishSeed,
    });

    const confirmedNewLL = result.points.filter((p) => p.type === StructurePointType.LL && p.price === 80);
    assert.strictEqual(confirmedNewLL.length, 0);
  });

  it('Bearish Mirror Test D: Wick breaks previous LL but close remains above -> Expected: NO LL break', () => {
    // Prev LL is 100. Candle 2 wicks to 95, but close is 102 (> 100).
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 200, 200, 195, 196),
      createCandle(1, 196, 196, 100, 105),
      createCandle(2, 105, 106, 95, 102), // Wick to 95, close 102 > 100!
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bearishSeed,
    });

    assert.strictEqual(result.activeRetracement, null);
  });

  it('Bearish Mirror Test G: Close breaks previous LH -> Expected: BEARISH_STRUCTURE_BROKEN', () => {
    // Prev LH is 200. Candle 2 closes at 205 (> 200).
    const candles: NormalizedMarketCandle[] = [
      createCandle(0, 200, 200, 195, 196),
      createCandle(1, 196, 196, 100, 105),
      createCandle(2, 105, 210, 104, 205), // Close 205 > 200!
    ];

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
      initialSeed: bearishSeed,
    });

    assert.strictEqual(result.structureState, StructureState.BEARISH_STRUCTURE_BROKEN);
  });
});
