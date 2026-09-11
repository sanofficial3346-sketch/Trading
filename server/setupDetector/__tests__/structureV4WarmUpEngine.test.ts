import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NormalizedMarketCandle } from '../../marketData/mexcPublicMarketClient';
import { structureEngine } from '../structureEngine';
import { StructurePointType, StructureState } from '../structureTypes';

describe('V4 Stateful Locked Cycle Engine with Warm-Up Initialization', () => {
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

  it('Test 1: Does NOT assume market starts bullish - detects bearish start when LH -> LL occurs', () => {
    // Generate candles where a bearish cycle forms:
    // Peak High at 200 (LH candidate), then drop to 120 (LL candidate), then bounce over 5 bars to 160 (qualified retracement)
    const candles: NormalizedMarketCandle[] = [];
    
    // Bar 0: Peak High at 200
    candles.push(createCandle(0, 190, 200, 188, 195));
    // Bars 1..4: drop down to 120
    candles.push(createCandle(1, 195, 196, 175, 178));
    candles.push(createCandle(2, 178, 180, 155, 158));
    candles.push(createCandle(3, 158, 160, 135, 138));
    candles.push(createCandle(4, 138, 140, 120, 122)); // low at 120

    // Bars 5..9: bounce up from 120 to 160 (fib target for 200->120 is 120 + 0.382*80 = 150.56)
    candles.push(createCandle(5, 122, 135, 122, 132));
    candles.push(createCandle(6, 132, 145, 130, 142));
    candles.push(createCandle(7, 142, 155, 140, 152));
    candles.push(createCandle(8, 152, 162, 150, 160)); // high at 162 (> 150.56)
    candles.push(createCandle(9, 160, 162, 158, 160)); // 5th bar of bounce

    // Bars 10..15: continuation
    for (let i = 10; i <= 15; i++) {
      candles.push(createCandle(i, 160, 162, 158, 159));
    }

    const result = structureEngine.detectStructure(candles, {
      algorithmVersion: 'STRUCTURE_V4_WARMUP_LOCKED',
      analysisCandles: 20,
      warmUpCandles: 0,
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
    });

    // The engine should detect BEARISH structure
    assert.strictEqual(result.structureState, StructureState.BEARISH, `State should be BEARISH, got: ${result.structureState}`);
    assert.ok(result.lastConfirmedLH, 'Should have confirmed LH');
    assert.ok(result.lastConfirmedLL, 'Should have confirmed LL');
  });

  it('Test 2: Warm-Up window discovers valid initial trend without labelling warm-up noise', () => {
    // 50 warm-up candles + 50 analysis candles = 100 total
    const candles: NormalizedMarketCandle[] = [];
    
    // Warm-up has a clear Bullish trend:
    // Low 100 -> High 200 -> Retrace to 140 (HL) -> Break above 200 to 250 (HH)
    candles.push(createCandle(0, 100, 105, 100, 102));
    candles.push(createCandle(1, 102, 150, 102, 148));
    candles.push(createCandle(2, 148, 200, 145, 195)); // high 200

    // Retrace over 5 bars to 140:
    candles.push(createCandle(3, 195, 196, 175, 178));
    candles.push(createCandle(4, 178, 180, 160, 162));
    candles.push(createCandle(5, 162, 164, 150, 152));
    candles.push(createCandle(6, 152, 154, 140, 142)); // low 140 (HL candidate)
    candles.push(createCandle(7, 142, 145, 140, 144));

    // Break above 200:
    candles.push(createCandle(8, 144, 170, 144, 168));
    candles.push(createCandle(9, 168, 210, 165, 208)); // break above 200
    candles.push(createCandle(10, 208, 250, 205, 245)); // high 250

    // Retrace over 5 bars to 190 (qualified HL: (250 - 190)/150 = 40% >= 38.2%):
    candles.push(createCandle(11, 245, 246, 230, 232));
    candles.push(createCandle(12, 232, 234, 220, 222));
    candles.push(createCandle(13, 222, 224, 205, 208));
    candles.push(createCandle(14, 208, 210, 190, 195)); // low 190 (Fib 40%)
    candles.push(createCandle(15, 195, 200, 190, 198));

    // Pad with steady consolidation up to candle 60:
    for (let i = 16; i < 60; i++) {
      candles.push(createCandle(i, 204, 210, 202, 206));
    }

    const result = structureEngine.detectStructure(candles, {
      algorithmVersion: 'STRUCTURE_V4_WARMUP_LOCKED',
      analysisCandles: 40,
      warmUpCandles: 20,
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
    });

    // Verification:
    assert.ok(result.initialization, 'Initialization metadata should exist');
    assert.strictEqual(result.initialization?.usedWarmUp, true, 'Should indicate warm-up was used');
    assert.strictEqual(result.initialization?.initialTrend, StructureState.BULLISH, 'Initial trend should be BULLISH');
    
    // Structure points inside the visible analysis range should have sequence numbers
    const visiblePoints = result.points.filter((p) => (p.candleIndex ?? 0) >= 20);
    for (const pt of visiblePoints) {
      assert.ok(pt.sequenceLabel, `Point ${pt.id} should have a sequenceLabel`);
    }
  });

  it('Test 3: Does NOT manufacture structure when market is noisy without qualified retracements', () => {
    // 60 candles of flat noise between 100 and 102
    const candles: NormalizedMarketCandle[] = [];
    for (let i = 0; i < 60; i++) {
      candles.push(createCandle(i, 100.5, 101.5, 100.0, 101.0));
    }

    const result = structureEngine.detectStructure(candles, {
      algorithmVersion: 'STRUCTURE_V4_WARMUP_LOCKED',
      analysisCandles: 40,
      warmUpCandles: 20,
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
    });

    // No structure should be manufactured
    assert.strictEqual(result.structureState, StructureState.UNDEFINED);
    assert.strictEqual(result.points.length, 0);
  });

  it('Test 4: Bearish Warm-Up initialization discovers LH -> LL sequence and sets initial state to BEARISH', () => {
    // 20 warm-up candles + 40 analysis candles = 60 total
    const candles: NormalizedMarketCandle[] = [];
    
    // Warm-up has a clear Bearish trend:
    // High 250 -> Low 150 -> Retrace to 200 (LH: (200-150)/100 = 50% >= 38.2%) -> Breakdown below 150 to 100 (LL) -> Bounce to 130
    candles.push(createCandle(0, 240, 250, 238, 245)); // High 250
    candles.push(createCandle(1, 245, 246, 220, 222));
    candles.push(createCandle(2, 222, 224, 195, 198));
    candles.push(createCandle(3, 198, 200, 170, 172));
    candles.push(createCandle(4, 172, 174, 150, 152)); // Low 150
    candles.push(createCandle(5, 152, 165, 150, 162));
    candles.push(createCandle(6, 162, 175, 160, 172));
    candles.push(createCandle(7, 172, 185, 170, 182));
    candles.push(createCandle(8, 182, 195, 180, 192));
    candles.push(createCandle(9, 192, 205, 190, 200)); // High 205 (LH, retraced > 38.2% of 250-150)
    
    // Breakdown below 150 to 100:
    candles.push(createCandle(10, 200, 202, 170, 172));
    candles.push(createCandle(11, 172, 174, 140, 142)); // breaks 150
    candles.push(createCandle(12, 142, 145, 120, 122));
    candles.push(createCandle(13, 122, 125, 100, 102)); // Low 100 (LL)

    // Bounce from 100 to 140 over 5 bars:
    candles.push(createCandle(14, 102, 115, 102, 112));
    candles.push(createCandle(15, 112, 125, 110, 122));
    candles.push(createCandle(16, 122, 135, 120, 132));
    candles.push(createCandle(17, 132, 142, 130, 140)); // High 142 ((142-100)/(205-100) = 40% >= 38.2%)
    candles.push(createCandle(18, 140, 142, 136, 138));

    // Pad candles 19 to 60 with steady price action:
    for (let i = 19; i < 60; i++) {
      candles.push(createCandle(i, 138, 140, 136, 138));
    }

    const result = structureEngine.detectStructure(candles, {
      algorithmVersion: 'STRUCTURE_V4_WARMUP_LOCKED',
      analysisCandles: 40,
      warmUpCandles: 20,
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
    });

    assert.ok(result.initialization, 'Initialization metadata must exist');
    assert.strictEqual(result.initialization?.usedWarmUp, true);
    assert.strictEqual(result.initialization?.initialTrend, StructureState.BEARISH);
    assert.ok(result.lastConfirmedLH, 'Must have confirmed LH anchor');
    assert.ok(result.lastConfirmedLL, 'Must have confirmed LL anchor');
  });

  it('Test 5: Strict body close rule - wick beyond anchor does not invalidate; body close required', () => {
    // Bullish state: HL=100, HH=200.
    // Candle tests wick below 100 (low 95), but closes at 105.
    // Result: Structure should NOT be broken.
    const candles: NormalizedMarketCandle[] = [];
    
    // Build initial bullish base:
    candles.push(createCandle(0, 100, 110, 100, 105)); // HL candidate at 100
    candles.push(createCandle(1, 105, 150, 104, 148));
    candles.push(createCandle(2, 148, 200, 145, 195)); // HH candidate at 200
    // Retrace over 5 bars to 140:
    candles.push(createCandle(3, 195, 196, 175, 178));
    candles.push(createCandle(4, 178, 180, 160, 162));
    candles.push(createCandle(5, 162, 164, 150, 152));
    candles.push(createCandle(6, 152, 154, 140, 142)); // low 140 (HL2 candidate)
    candles.push(createCandle(7, 142, 145, 140, 144));
    // Push above 200:
    candles.push(createCandle(8, 144, 180, 144, 178));
    candles.push(createCandle(9, 178, 220, 175, 218)); // closes above 200 -> locks HL at 140

    // Next candle: Wick dips to 135 (below 140), but closes at 145:
    candles.push(createCandle(10, 218, 219, 135, 145));

    const result = structureEngine.detectStructure(candles, {
      algorithmVersion: 'STRUCTURE_V4_WARMUP_LOCKED',
      analysisCandles: 20,
      warmUpCandles: 0,
      minimumRetracementCandles: 4,
      minimumRetracementFib: 0.382,
    });

    // Structure must still be BULLISH, NOT broken!
    assert.strictEqual(
      result.structureState,
      StructureState.BULLISH,
      `State should remain BULLISH after wick dip without body close, but got: ${result.structureState}`
    );
  });

  it('Test 6: Structure points guarantee strictly unique IDs across transitions', () => {
    // Generate synthetic oscillating candles that trigger trend reversals
    const candles: NormalizedMarketCandle[] = [];
    let price = 100;
    for (let i = 0; i < 60; i++) {
      const delta = Math.sin(i / 3) * 15;
      const open = price;
      const close = price + delta;
      const high = Math.max(open, close) + 3;
      const low = Math.min(open, close) - 3;
      candles.push(createCandle(i, open, high, low, close));
      price = close;
    }

    const result = structureEngine.detectStructure(candles, {
      algorithmVersion: 'STRUCTURE_V4_WARMUP_LOCKED',
      analysisCandles: 60,
      warmUpCandles: 15,
      minimumRetracementCandles: 2,
      minimumRetracementFib: 0.382,
    });

    const pointIds = result.points.map((p) => p.id);
    const uniqueIds = new Set(pointIds);
    assert.strictEqual(
      pointIds.length,
      uniqueIds.size,
      `Detected duplicate structure point IDs: ${pointIds.filter((id, index) => pointIds.indexOf(id) !== index).join(', ')}`
    );
  });
});
