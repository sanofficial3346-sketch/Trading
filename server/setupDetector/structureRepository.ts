import { Decimal } from 'decimal.js';
import { db } from '../../src/db/database';
import { MarketStructurePointRecord } from '../../src/db/types';
import { getPrismaClientSafe, checkDatabaseHealth, Prisma } from '../db/prisma';
import { StructurePoint, StructurePointType, StructureStrength, StructureParameters } from './structureTypes';

export interface IStructureRepository {
  savePoints(points: StructurePoint[]): Promise<{ saved: number }>;
  getPoints(
    symbol: string,
    timeframe?: string,
    algorithmVersion?: string
  ): Promise<StructurePoint[]>;
}

export class StructureRepository implements IStructureRepository {
  /**
   * Idempotently saves detected structure points.
   * Unique constraint: symbol + timeframe + candleOpenTime + type + algorithmVersion
   */
  public async savePoints(points: StructurePoint[]): Promise<{ saved: number }> {
    if (points.length === 0) return { saved: 0 };

    let saved = 0;
    const prisma = getPrismaClientSafe();
    const health = await checkDatabaseHealth();
    const usePrisma = health.status === 'CONNECTED' && prisma !== null;

    if (usePrisma && prisma) {
      for (const pt of points) {
        const candleDate = new Date(pt.candleOpenTime);
        const priceDec = new Decimal(pt.price);

        try {
          await prisma.marketStructurePoint.upsert({
            where: {
              symbol_timeframe_candleOpenTime_type_algorithmVersion: {
                symbol: pt.symbol,
                timeframe: pt.timeframe,
                candleOpenTime: candleDate,
                type: pt.type,
                algorithmVersion: pt.algorithmVersion,
              },
            },
            update: {
              price: priceDec,
              strength: pt.strength,
              parameters: pt.parameters as unknown as Prisma.InputJsonValue,
              detectedAt: new Date(pt.detectedAt),
            },
            create: {
              symbol: pt.symbol,
              timeframe: pt.timeframe,
              candleOpenTime: candleDate,
              type: pt.type,
              price: priceDec,
              strength: pt.strength,
              algorithmVersion: pt.algorithmVersion,
              parameters: pt.parameters as unknown as Prisma.InputJsonValue,
              detectedAt: new Date(pt.detectedAt),
            },
          });
          saved++;
        } catch {
          this.saveToMemory(pt);
          saved++;
        }
      }
    } else {
      // Memory Store
      for (const pt of points) {
        this.saveToMemory(pt);
        saved++;
      }
    }

    return { saved };
  }

  private saveToMemory(pt: StructurePoint): void {
    const key = `${pt.symbol}:${pt.timeframe}:${pt.candleOpenTime}:${pt.type}:${pt.algorithmVersion}`;
    const existing = db.marketStructurePoints.get(key);

    const record: MarketStructurePointRecord = {
      id: existing?.id || pt.id,
      symbol: pt.symbol,
      timeframe: pt.timeframe,
      candleOpenTime: pt.candleOpenTime,
      type: pt.type as any,
      price: new Decimal(pt.price),
      strength: pt.strength as any,
      leftBars: pt.leftBars,
      rightBars: pt.rightBars,
      algorithmVersion: pt.algorithmVersion,
      parameters: pt.parameters as unknown as Record<string, unknown>,
      detectedAt: pt.detectedAt,
      createdAt: existing?.createdAt || pt.createdAt,
    };

    db.marketStructurePoints.set(key, record);
  }

  public async getPoints(
    symbol: string,
    timeframe: string = '5M',
    algorithmVersion: string = 'STRUCTURE_V1'
  ): Promise<StructurePoint[]> {
    const prisma = getPrismaClientSafe();
    const health = await checkDatabaseHealth();
    const usePrisma = health.status === 'CONNECTED' && prisma !== null;

    if (usePrisma && prisma) {
      try {
        const rows = await prisma.marketStructurePoint.findMany({
          where: { symbol, timeframe, algorithmVersion },
          orderBy: { candleOpenTime: 'asc' },
        });

        return rows.map((r) => {
          const params = (r.parameters as unknown as StructureParameters) || {
            pivotLeftBars: 2,
            pivotRightBars: 2,
            lookbackCandles: 350,
            equalityMode: 'STRICT',
          };
          return {
            id: r.id,
            symbol: r.symbol,
            timeframe: r.timeframe,
            candleOpenTime: r.candleOpenTime.toISOString(),
            candleOpenTimeUnix: r.candleOpenTime.getTime(),
            type: r.type as StructurePointType,
            price: Number(r.price.toString()),
            strength: (r.strength as StructureStrength) || StructureStrength.MINOR,
            leftBars: params.pivotLeftBars || 2,
            rightBars: params.pivotRightBars || 2,
            algorithmVersion: r.algorithmVersion,
            parameters: params,
            detectedAt: r.detectedAt.toISOString(),
            createdAt: r.createdAt.toISOString(),
          };
        });
      } catch {
        // Fallback to memory
      }
    }

    return Array.from(db.marketStructurePoints.values())
      .filter((p) => p.symbol === symbol && p.timeframe === timeframe && p.algorithmVersion === algorithmVersion)
      .sort((a, b) => new Date(a.candleOpenTime).getTime() - new Date(b.candleOpenTime).getTime())
      .map((p) => ({
        id: p.id,
        symbol: p.symbol,
        timeframe: p.timeframe,
        candleOpenTime: p.candleOpenTime,
        candleOpenTimeUnix: new Date(p.candleOpenTime).getTime(),
        type: p.type as StructurePointType,
        price: Number(p.price.toString()),
        strength: (p.strength as StructureStrength) || StructureStrength.MINOR,
        leftBars: p.leftBars,
        rightBars: p.rightBars,
        algorithmVersion: p.algorithmVersion,
        parameters: (p.parameters as unknown as StructureParameters) || {
          pivotLeftBars: p.leftBars,
          pivotRightBars: p.rightBars,
          lookbackCandles: 350,
          equalityMode: 'STRICT',
        },
        detectedAt: p.detectedAt,
        createdAt: p.createdAt,
      }));
  }
}

export const structureRepository = new StructureRepository();
