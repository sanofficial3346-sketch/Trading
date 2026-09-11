import { NormalizedMarketCandle } from '../../marketData/mexcPublicMarketClient';
import { StructureParameters, StructurePoint, StructurePointType, StructureStrength } from '../structureTypes';

/** The sole optional legacy local-pivot implementation. It never emits HH/HL/LH/LL. */
export function detectLegacyPivots(candles: NormalizedMarketCandle[], params: StructureParameters): StructurePoint[] {
  const left = params.pivotLeftBars ?? 2;
  const right = params.pivotRightBars ?? 2;
  const points: StructurePoint[] = [];
  for (let i = left; i < candles.length - right; i++) {
    const candle = candles[i];
    const isHigh = candles.slice(i - left, i).every((c) => c.high < candle.high)
      && candles.slice(i + 1, i + right + 1).every((c) => c.high < candle.high);
    const isLow = candles.slice(i - left, i).every((c) => c.low > candle.low)
      && candles.slice(i + 1, i + right + 1).every((c) => c.low > candle.low);
    for (const type of [isHigh ? StructurePointType.SWING_HIGH : null, isLow ? StructurePointType.SWING_LOW : null]) {
      if (!type) continue;
      const id = `legacy_${type}_${candle.openTimeUnix}`;
      points.push({
        id,
        eventId: id,
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        candleOpenTime: candle.openTime,
        candleOpenTimeUnix: candle.openTimeUnix,
        candleIndex: i,
        type,
        price: type === StructurePointType.SWING_HIGH ? candle.high : candle.low,
        strength: StructureStrength.MINOR,
        algorithmVersion: 'LEGACY_PIVOT_V1',
        detectedAt: candle.openTime,
        createdAt: candle.openTime,
      });
    }
  }
  return points;
}
