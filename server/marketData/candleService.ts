import { mexcPublicMarketClient, NormalizedMarketCandle } from './mexcPublicMarketClient';
import { candleRepository } from './candleRepository';
import { CURRENT_ALGORITHM_VERSION, structureEngine } from '../setupDetector/structureEngine';

export interface SyncCandleResult {
  symbol: string;
  timeframe: string;
  totalCandles: number;
  closedCandlesCount: number;
  unclosedCandlePresent: boolean;
  inserted: number;
  updated: number;
  source: 'MEXC_PUBLIC';
  timestamp: string;
}

export class CandleService {
  private activePollingIntervals = new Map<string, NodeJS.Timeout>();
  private lastSyncTimes = new Map<string, string>();
  private readonly publicCandleTtlMs = 12_000;

  /**
   * Fetch and persist recent 5-minute candles for a symbol.
   * Typically fetches ~350-400 candles to populate the working window and allow safe boundary handling.
   */
  public async syncCandles(
    symbol: string,
    limit: number = 400
  ): Promise<SyncCandleResult> {
    const cleanSymbol = symbol.trim().toUpperCase();
    const candles = await mexcPublicMarketClient.fetchKlines(cleanSymbol, 'Min5', limit);

    if (candles.length === 0) {
      return {
        symbol: cleanSymbol,
        timeframe: '5M',
        totalCandles: 0,
        closedCandlesCount: 0,
        unclosedCandlePresent: false,
        inserted: 0,
        updated: 0,
        source: 'MEXC_PUBLIC',
        timestamp: new Date().toISOString(),
      };
    }

    const { inserted, updated } = await candleRepository.saveCandles(candles);
    const closedCount = candles.filter((c) => c.isClosed).length;
    const hasUnclosed = candles.some((c) => !c.isClosed);

    this.lastSyncTimes.set(cleanSymbol, new Date().toISOString());

    // Automatically trigger market structure detection for the updated symbol
    try {
      await structureEngine.detectAndSaveStructure(cleanSymbol, '5M', 350, {
        algorithmVersion: CURRENT_ALGORITHM_VERSION,
      });
    } catch (err) {
      console.warn(`[CandleService] Structure detection auto-run notice for ${cleanSymbol}:`, (err as Error).message);
    }

    return {
      symbol: cleanSymbol,
      timeframe: '5M',
      totalCandles: candles.length,
      closedCandlesCount: closedCount,
      unclosedCandlePresent: hasUnclosed,
      inserted,
      updated,
      source: 'MEXC_PUBLIC',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Retrieve cached/stored candles for display in Setup Lab chart.
   * If stored count is less than requested limit, automatically fetches sufficient history.
   */
  public async getDisplayCandles(
    symbol: string,
    limit: number = 400
  ): Promise<NormalizedMarketCandle[]> {
    const cleanSymbol = symbol.trim().toUpperCase();
    let stored = await candleRepository.getCandles(cleanSymbol, '5M', limit);

    // If no candles stored yet or stored count is less than requested limit (and under MEXC limit), fetch more history
    if (stored.length === 0 || (stored.length < limit && limit <= 2000)) {
      await this.syncCandles(cleanSymbol, Math.max(limit + 50, 400));
      stored = await candleRepository.getCandles(cleanSymbol, '5M', limit);
    }

    return stored;
  }

  public async refreshIfStale(symbol: string, limit: number = 400): Promise<void> {
    const cleanSymbol = symbol.trim().toUpperCase();
    const lastSync = this.lastSyncTimes.get(cleanSymbol);
    if (!lastSync || Date.now() - new Date(lastSync).getTime() >= this.publicCandleTtlMs) {
      await this.syncCandles(cleanSymbol, limit);
    }
  }

  public getLastSyncTime(symbol: string): string | null {
    return this.lastSyncTimes.get(symbol.trim().toUpperCase()) || null;
  }
}

export const candleService = new CandleService();
