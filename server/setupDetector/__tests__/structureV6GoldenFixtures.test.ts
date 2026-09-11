import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectStructureV6FibQualifiedRange } from '../structureV6Engine';
import { NormalizedMarketCandle } from '../../marketData/mexcPublicMarketClient';

interface Fixture { name: string; symbol: string; seed: { direction: 'BULLISH' | 'BEARISH'; top: number; bottom: number }; ohlc: number[][]; expected: string[] }
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/structure-v6-golden.json', import.meta.url), 'utf8')) as Fixture[];

describe('V6 manually reviewed golden sequences', () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const candles: NormalizedMarketCandle[] = fixture.ohlc.map(([open, high, low, close], index) => {
        const openTimeUnix = Date.UTC(2026, 7, 1) + index * 300_000;
        return { symbol: fixture.symbol, timeframe: '5M', openTime: new Date(openTimeUnix).toISOString(), openTimeUnix, open, high, low, close, volume: 1, amount: 1, isClosed: true, source: 'MEXC_PUBLIC' };
      });
      const result = detectStructureV6FibQualifiedRange(candles, {
        initializationSearchCandles: 0,
        minimumRetracementCandles: 4,
        minimumRetracementFib: 0.382,
        manualStart: {
          direction: fixture.seed.direction,
          top: { price: fixture.seed.top, candleTime: candles[0].openTime, candleTimeUnix: candles[0].openTimeUnix, candleIndex: 0 },
          bottom: { price: fixture.seed.bottom, candleTime: candles[1].openTime, candleTimeUnix: candles[1].openTimeUnix, candleIndex: 1 },
        },
      });
      assert.deepEqual(result.points.map((point) => point.sequenceLabel), fixture.expected);
    });
  }
});
