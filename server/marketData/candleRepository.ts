import { Decimal } from 'decimal.js';
import { db } from '../../src/db/database';
import { MarketCandleRecord } from '../../src/db/types';
import { getPrismaClientSafe, checkDatabaseHealth } from '../db/prisma';
import { NormalizedMarketCandle } from './mexcPublicMarketClient';

export interface ICandleRepository {
  saveCandles(candles: NormalizedMarketCandle[]): Promise<{ inserted: number; updated: number }>;
  getCandles(symbol: string, timeframe?: string, limit?: number): Promise<NormalizedMarketCandle[]>;
  getClosedCandles(symbol: string, timeframe?: string, limit?: number): Promise<NormalizedMarketCandle[]>;
}

export class CandleRepository implements ICandleRepository {
  /**
   * Save candles idempotently into the database.
   * Uses Prisma if PostgreSQL is connected, else stores in memory.
   */
  public async saveCandles(
    candles: NormalizedMarketCandle[]
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;

    const prisma = getPrismaClientSafe();
    const health = await checkDatabaseHealth();
    const usePrisma = health.status === 'CONNECTED' && prisma !== null;

    if (usePrisma && prisma) {
      for (const c of candles) {
        const openTimeDate = new Date(c.openTime);
        const openDec = new Decimal(c.open);
        const highDec = new Decimal(c.high);
        const lowDec = new Decimal(c.low);
        const closeDec = new Decimal(c.close);
        const volDec = c.volume != null ? new Decimal(c.volume) : null;
        const amtDec = c.amount != null ? new Decimal(c.amount) : null;

        try {
          const existing = await prisma.marketCandle.findUnique({
            where: {
              symbol_timeframe_openTime: {
                symbol: c.symbol,
                timeframe: c.timeframe,
                openTime: openTimeDate,
              },
            },
          });

          if (existing) {
            await prisma.marketCandle.update({
              where: { id: existing.id },
              data: {
                high: highDec,
                low: lowDec,
                close: closeDec,
                volume: volDec,
                amount: amtDec,
                isClosed: c.isClosed,
              },
            });
            updated++;
          } else {
            await prisma.marketCandle.create({
              data: {
                symbol: c.symbol,
                timeframe: c.timeframe,
                openTime: openTimeDate,
                open: openDec,
                high: highDec,
                low: lowDec,
                close: closeDec,
                volume: volDec,
                amount: amtDec,
                isClosed: c.isClosed,
                source: c.source,
              },
            });
            inserted++;
          }
        } catch {
          // Fallback to in-memory on individual write failure
          this.saveToMemory(c);
        }
      }
    } else {
      // Memory Store
      for (const c of candles) {
        const res = this.saveToMemory(c);
        if (res === 'inserted') inserted++;
        else updated++;
      }
    }

    return { inserted, updated };
  }

  private saveToMemory(c: NormalizedMarketCandle): 'inserted' | 'updated' {
    const key = `${c.symbol}:${c.timeframe}:${c.openTime}`;
    const existing = db.marketCandles.get(key);

    const record: MarketCandleRecord = {
      id: existing?.id || `candle_${c.symbol}_${c.openTimeUnix}`,
      symbol: c.symbol,
      timeframe: c.timeframe,
      openTime: c.openTime,
      open: new Decimal(c.open),
      high: new Decimal(c.high),
      low: new Decimal(c.low),
      close: new Decimal(c.close),
      volume: c.volume != null ? new Decimal(c.volume) : null,
      amount: c.amount != null ? new Decimal(c.amount) : null,
      isClosed: c.isClosed,
      source: c.source,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.marketCandles.set(key, record);
    return existing ? 'updated' : 'inserted';
  }

  /**
   * Retrieve recent candles ordered chronologically (oldest -> newest).
   */
  public async getCandles(
    symbol: string,
    timeframe: string = '5M',
    limit: number = 400
  ): Promise<NormalizedMarketCandle[]> {
    const prisma = getPrismaClientSafe();
    const health = await checkDatabaseHealth();
    const usePrisma = health.status === 'CONNECTED' && prisma !== null;

    if (usePrisma && prisma) {
      try {
        const rows = await prisma.marketCandle.findMany({
          where: { symbol, timeframe },
          orderBy: { openTime: 'desc' },
          take: limit,
        });

        return rows
          .reverse()
          .map((r) => ({
            id: r.id,
            symbol: r.symbol,
            timeframe: r.timeframe,
            openTime: r.openTime.toISOString(),
            openTimeUnix: r.openTime.getTime(),
            open: Number(r.open.toString()),
            high: Number(r.high.toString()),
            low: Number(r.low.toString()),
            close: Number(r.close.toString()),
            volume: r.volume ? Number(r.volume.toString()) : 0,
            amount: r.amount ? Number(r.amount.toString()) : 0,
            isClosed: r.isClosed,
            source: 'MEXC_PUBLIC',
          }));
      } catch {
        // Fallback to memory
      }
    }

    // Memory query
    const candles = Array.from(db.marketCandles.values())
      .filter((c) => c.symbol === symbol && c.timeframe === timeframe)
      .sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());

    const sliced = limit > 0 ? candles.slice(-limit) : candles;
    return sliced.map((c) => ({
      id: c.id,
      symbol: c.symbol,
      timeframe: c.timeframe,
      openTime: c.openTime,
      openTimeUnix: new Date(c.openTime).getTime(),
      open: Number(c.open.toString()),
      high: Number(c.high.toString()),
      low: Number(c.low.toString()),
      close: Number(c.close.toString()),
      volume: c.volume ? Number(c.volume.toString()) : 0,
      amount: c.amount ? Number(c.amount.toString()) : 0,
      isClosed: c.isClosed,
      source: 'MEXC_PUBLIC',
    }));
  }

  /**
   * Retrieve ONLY CLOSED candles, ordered chronologically.
   * Used strictly for market structure detection.
   */
  public async getClosedCandles(
    symbol: string,
    timeframe: string = '5M',
    limit: number = 350
  ): Promise<NormalizedMarketCandle[]> {
    const all = await this.getCandles(symbol, timeframe, limit + 50);
    const closed = all.filter((c) => c.isClosed);
    return limit > 0 && closed.length > limit ? closed.slice(closed.length - limit) : closed;
  }
}

export const candleRepository = new CandleRepository();
