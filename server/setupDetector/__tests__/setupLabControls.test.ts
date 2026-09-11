import test from 'node:test';
import assert from 'node:assert';
import { structureEngine } from '../structureEngine';
import { mexcPublicMarketClient, NormalizedMarketCandle } from '../../marketData/mexcPublicMarketClient';
import { StructurePointType } from '../structureTypes';

test('Setup Lab Controls & Directory Improvements', async (t) => {
  await t.test('Contract directory loads and normalizes contract metadata properly', async () => {
    const dir = await mexcPublicMarketClient.getContractDirectory(false);
    assert.ok(dir.length > 0, 'Directory should not be empty');

    const btc = dir.find((d) => d.rawSymbol === 'BTC_USDT');
    assert.ok(btc, 'BTC_USDT must exist in contract directory');
    assert.strictEqual(btc.baseAsset, 'BTC');
    assert.strictEqual(btc.quoteAsset, 'USDT');
    assert.strictEqual(btc.isTradable, true);
    assert.strictEqual(btc.contractType, 'PERPETUAL');

    // Check Gold and Silver contracts
    const xau = dir.find((d) => d.rawSymbol === 'XAU_USDT');
    assert.ok(xau, 'XAU_USDT (Gold) contract must exist');
    assert.strictEqual(xau.baseAsset, 'XAU');
    assert.strictEqual(xau.quoteAsset, 'USDT');
  });

  await t.test('Contract directory returns cached directory when within TTL', async () => {
    const dir1 = await mexcPublicMarketClient.getContractDirectory(false);
    const dir2 = await mexcPublicMarketClient.getContractDirectory(false);
    assert.strictEqual(dir1, dir2, 'Consecutive calls should return the cached instance');
  });

  await t.test('Structure engine dynamic lookback adjusts window correctly', () => {
    const candles: NormalizedMarketCandle[] = [];
    const now = Date.now();

    // Create 1200 closed candles
    for (let i = 0; i < 1200; i++) {
      candles.push({
        symbol: 'BTC_USDT',
        timeframe: '5M',
        openTime: new Date(now - (1200 - i) * 300000).toISOString(),
        openTimeUnix: now - (1200 - i) * 300000,
        open: 50000 + Math.sin(i / 10) * 100,
        high: 50000 + Math.sin(i / 10) * 100 + 20,
        low: 50000 + Math.sin(i / 10) * 100 - 20,
        close: 50000 + Math.sin(i / 10) * 100 + 5,
        volume: 10,
        amount: 500000,
        isClosed: true,
        source: 'MEXC_PUBLIC',
      });
    }

    // Add 1 forming unclosed candle
    candles.push({
      symbol: 'BTC_USDT',
      timeframe: '5M',
      openTime: new Date(now).toISOString(),
      openTimeUnix: now,
      open: 50000,
      high: 50050,
      low: 49950,
      close: 50010,
      volume: 2,
      amount: 100000,
      isClosed: false,
      source: 'MEXC_PUBLIC',
    });

    // Test lookback = 100
    const res100 = structureEngine.detectStructure(candles, {
      pivotLeftBars: 2,
      pivotRightBars: 2,
      lookbackCandles: 100,
      equalityMode: 'STRICT',
    });
    assert.strictEqual(res100.closedCandlesEvaluated, 100);
    assert.strictEqual(res100.unclosedCandleExcluded, true);

    // Test lookback = 500
    const res500 = structureEngine.detectStructure(candles, {
      pivotLeftBars: 2,
      pivotRightBars: 2,
      lookbackCandles: 500,
      equalityMode: 'STRICT',
    });
    assert.strictEqual(res500.closedCandlesEvaluated, 500);
    assert.strictEqual(res500.unclosedCandleExcluded, true);

    // Test lookback = 1000
    const res1000 = structureEngine.detectStructure(candles, {
      pivotLeftBars: 2,
      pivotRightBars: 2,
      lookbackCandles: 1000,
      equalityMode: 'STRICT',
    });
    assert.strictEqual(res1000.closedCandlesEvaluated, 1000);
    assert.strictEqual(res1000.unclosedCandleExcluded, true);
  });
});
