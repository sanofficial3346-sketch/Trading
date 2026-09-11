import { Decimal } from 'decimal.js';
import {
  RawExchangeOrderRecord,
  RawExchangeFillRecord,
  FundingTransactionRecord,
  EquitySnapshotRecord,
  SyncJobRecord,
  TradingAccountRecord,
  TradeRecord,
  DailyPerformanceRecord,
  AccountType,
  SyncStatus,
  SyncType,
} from '../../src/db/types';
import { db } from '../../src/db/database';
import {
  getPrismaClient,
  checkDatabaseHealth,
  DatabaseHealth,
  Prisma,
} from './prisma';

export interface ITradingRepository {
  readonly isPersistent: boolean;
  getHealth(): Promise<DatabaseHealth>;
  ensureDefaultAccounts(): Promise<void>;

  // Raw orders (idempotent historical evidence)
  saveRawOrder(order: RawExchangeOrderRecord): Promise<'inserted' | 'skipped'>;
  saveRawOrders(orders: RawExchangeOrderRecord[]): Promise<{ inserted: number; skipped: number }>;
  getRawOrders(tradingAccountId?: string, symbol?: string, limit?: number): Promise<RawExchangeOrderRecord[]>;

  // Raw fills (idempotent execution evidence)
  saveRawFill(fill: RawExchangeFillRecord): Promise<'inserted' | 'skipped'>;
  saveRawFills(fills: RawExchangeFillRecord[]): Promise<{ inserted: number; skipped: number }>;
  getRawFills(tradingAccountId?: string, symbol?: string, limit?: number): Promise<RawExchangeFillRecord[]>;

  // Funding transactions
  saveFundingTransaction(funding: FundingTransactionRecord): Promise<'inserted' | 'skipped'>;
  getFundingTransactions(tradingAccountId?: string, symbol?: string, limit?: number): Promise<FundingTransactionRecord[]>;

  // Equity snapshots
  saveEquitySnapshot(snapshot: EquitySnapshotRecord): Promise<void>;
  getEquitySnapshots(tradingAccountId: string, limit?: number): Promise<EquitySnapshotRecord[]>;

  // Sync jobs
  createSyncJob(job: SyncJobRecord): Promise<void>;
  updateSyncJob(jobId: string, updates: Partial<SyncJobRecord>): Promise<void>;
  getSyncJobs(tradingAccountId?: string, limit?: number): Promise<SyncJobRecord[]>;
  getSyncJob(jobId: string): Promise<SyncJobRecord | null>;
  deleteSyncJob?(jobId: string): Promise<void>; // For testing cleanup

  // Account & Summary
  getTradingAccount(id?: string): Promise<TradingAccountRecord | null>;
  getTrades(filters?: any): Promise<TradeRecord[]>;
  getDailyPerformance(tradingAccountId?: string): Promise<DailyPerformanceRecord[]>;
  getCounts(): Promise<{
    rawOrders: number;
    rawFills: number;
    fundingTransactions: number;
    equitySnapshots: number;
  }>;
}

// -----------------------------------------------------------------------------
// POSTGRESQL PRISMA REPOSITORY IMPLEMENTATION
// -----------------------------------------------------------------------------

export class PrismaPostgresRepository implements ITradingRepository {
  public readonly isPersistent = true;

  public async getHealth(): Promise<DatabaseHealth> {
    return checkDatabaseHealth();
  }

  public async ensureDefaultAccounts(): Promise<void> {
    const prisma = getPrismaClient();

    // 1. Ensure Default User
    const defaultUserId = 'usr_trademate_main';
    await prisma.user.upsert({
      where: { email: 'trader@trademate.internal' },
      update: {},
      create: {
        id: defaultUserId,
        name: 'TradeMate Principal Trader',
        email: 'trader@trademate.internal',
      },
    });

    // 2. Ensure MEXC Exchange
    const defaultExchangeId = 'ex_mexc';
    await prisma.exchange.upsert({
      where: { code: 'MEXC' },
      update: {},
      create: {
        id: defaultExchangeId,
        name: 'MEXC Global (Contract API)',
        code: 'MEXC',
      },
    });

    // 3. Ensure Default Trading Account
    const defaultAccountId = 'acc_mexc_futures_01';
    await prisma.tradingAccount.upsert({
      where: { id: defaultAccountId },
      update: {},
      create: {
        id: defaultAccountId,
        userId: defaultUserId,
        exchangeId: defaultExchangeId,
        accountName: 'MEXC Futures Main',
        accountType: 'FUTURES',
        baseCurrency: 'USDT',
        isActive: true,
      },
    });
  }

  public async saveRawOrder(order: RawExchangeOrderRecord): Promise<'inserted' | 'skipped'> {
    const prisma = getPrismaClient();
    try {
      await prisma.rawExchangeOrder.create({
        data: {
          id: order.id,
          tradingAccountId: order.tradingAccountId,
          exchangeOrderId: order.exchangeOrderId,
          symbol: order.symbol,
          side: order.side,
          orderType: order.orderType,
          status: order.status,
          price: new Prisma.Decimal(order.price.toString()),
          quantity: new Prisma.Decimal(order.quantity.toString()),
          filledQuantity: new Prisma.Decimal(order.filledQuantity.toString()),
          averagePrice: order.averagePrice ? new Prisma.Decimal(order.averagePrice.toString()) : null,
          reduceOnly: order.reduceOnly,
          positionSide: order.positionSide,
          leverage: order.leverage,
          exchangeCreatedAt: new Date(order.exchangeCreatedAt),
          exchangeUpdatedAt: order.exchangeUpdatedAt ? new Date(order.exchangeUpdatedAt) : null,
          rawPayload: order.rawPayload as Prisma.InputJsonValue,
          syncedAt: new Date(order.syncedAt),
          createdAt: new Date(order.createdAt),
        },
      });
      return 'inserted';
    } catch (err: any) {
      // P2002 is Prisma's code for Unique constraint violation (compound [tradingAccountId, exchangeOrderId])
      if (err.code === 'P2002') {
        return 'skipped';
      }
      throw err;
    }
  }

  public async saveRawOrders(orders: RawExchangeOrderRecord[]): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0;
    let skipped = 0;

    // Process in batches to balance transaction throughput and lock overhead
    const BATCH_SIZE = 25;
    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
      const batch = orders.slice(i, i + BATCH_SIZE);
      for (const order of batch) {
        const res = await this.saveRawOrder(order);
        if (res === 'inserted') inserted++;
        else skipped++;
      }
    }

    return { inserted, skipped };
  }

  public async getRawOrders(tradingAccountId?: string, symbol?: string, limit = 100): Promise<RawExchangeOrderRecord[]> {
    const prisma = getPrismaClient();
    const whereClause: Prisma.RawExchangeOrderWhereInput = {};
    if (tradingAccountId) whereClause.tradingAccountId = tradingAccountId;
    if (symbol) whereClause.symbol = symbol;

    const rows = await prisma.rawExchangeOrder.findMany({
      where: whereClause,
      orderBy: { exchangeCreatedAt: 'desc' },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      tradingAccountId: r.tradingAccountId,
      exchangeOrderId: r.exchangeOrderId,
      symbol: r.symbol,
      side: r.side as any,
      orderType: r.orderType as any,
      status: r.status as any,
      price: new Decimal(r.price.toString()),
      quantity: new Decimal(r.quantity.toString()),
      filledQuantity: new Decimal(r.filledQuantity.toString()),
      averagePrice: r.averagePrice ? new Decimal(r.averagePrice.toString()) : null,
      reduceOnly: r.reduceOnly,
      positionSide: r.positionSide as any,
      leverage: r.leverage,
      exchangeCreatedAt: r.exchangeCreatedAt.toISOString(),
      exchangeUpdatedAt: r.exchangeUpdatedAt ? r.exchangeUpdatedAt.toISOString() : null,
      rawPayload: r.rawPayload as Record<string, any>,
      syncedAt: r.syncedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  public async saveRawFill(fill: RawExchangeFillRecord): Promise<'inserted' | 'skipped'> {
    const prisma = getPrismaClient();
    try {
      await prisma.rawExchangeFill.create({
        data: {
          id: fill.id,
          tradingAccountId: fill.tradingAccountId,
          exchangeFillId: fill.exchangeFillId,
          exchangeOrderId: fill.exchangeOrderId,
          symbol: fill.symbol,
          side: fill.side,
          price: new Prisma.Decimal(fill.price.toString()),
          quantity: new Prisma.Decimal(fill.quantity.toString()),
          quoteQuantity: fill.quoteQuantity ? new Prisma.Decimal(fill.quoteQuantity.toString()) : null,
          fee: new Prisma.Decimal(fill.fee.toString()),
          feeCurrency: fill.feeCurrency,
          realizedPnl: fill.realizedPnl ? new Prisma.Decimal(fill.realizedPnl.toString()) : null,
          positionSide: fill.positionSide,
          liquidityType: fill.liquidityType,
          exchangeTimestamp: new Date(fill.exchangeTimestamp),
          rawPayload: fill.rawPayload as Prisma.InputJsonValue,
          syncedAt: new Date(fill.syncedAt),
          createdAt: new Date(fill.createdAt),
        },
      });
      return 'inserted';
    } catch (err: any) {
      if (err.code === 'P2002') {
        return 'skipped';
      }
      throw err;
    }
  }

  public async saveRawFills(fills: RawExchangeFillRecord[]): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0;
    let skipped = 0;

    const BATCH_SIZE = 25;
    for (let i = 0; i < fills.length; i += BATCH_SIZE) {
      const batch = fills.slice(i, i + BATCH_SIZE);
      for (const fill of batch) {
        const res = await this.saveRawFill(fill);
        if (res === 'inserted') inserted++;
        else skipped++;
      }
    }

    return { inserted, skipped };
  }

  public async getRawFills(tradingAccountId?: string, symbol?: string, limit = 100): Promise<RawExchangeFillRecord[]> {
    const prisma = getPrismaClient();
    const whereClause: Prisma.RawExchangeFillWhereInput = {};
    if (tradingAccountId) whereClause.tradingAccountId = tradingAccountId;
    if (symbol) whereClause.symbol = symbol;

    const rows = await prisma.rawExchangeFill.findMany({
      where: whereClause,
      orderBy: { exchangeTimestamp: 'desc' },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      tradingAccountId: r.tradingAccountId,
      exchangeFillId: r.exchangeFillId,
      exchangeOrderId: r.exchangeOrderId,
      symbol: r.symbol,
      side: r.side as any,
      price: new Decimal(r.price.toString()),
      quantity: new Decimal(r.quantity.toString()),
      quoteQuantity: r.quoteQuantity ? new Decimal(r.quoteQuantity.toString()) : null,
      fee: new Decimal(r.fee.toString()),
      feeCurrency: r.feeCurrency,
      realizedPnl: r.realizedPnl ? new Decimal(r.realizedPnl.toString()) : null,
      positionSide: r.positionSide as any,
      liquidityType: r.liquidityType as any,
      exchangeTimestamp: r.exchangeTimestamp.toISOString(),
      rawPayload: r.rawPayload as Record<string, any>,
      syncedAt: r.syncedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  public async saveFundingTransaction(funding: FundingTransactionRecord): Promise<'inserted' | 'skipped'> {
    const prisma = getPrismaClient();
    try {
      await prisma.fundingTransaction.create({
        data: {
          id: funding.id,
          tradingAccountId: funding.tradingAccountId,
          externalId: funding.externalId,
          symbol: funding.symbol,
          amount: new Prisma.Decimal(funding.amount.toString()),
          currency: funding.currency,
          fundingRate: funding.fundingRate ? new Prisma.Decimal(funding.fundingRate.toString()) : null,
          exchangeTimestamp: new Date(funding.exchangeTimestamp),
          rawPayload: funding.rawPayload as Prisma.InputJsonValue,
          createdAt: new Date(funding.createdAt),
        },
      });
      return 'inserted';
    } catch (err: any) {
      if (err.code === 'P2002') return 'skipped';
      throw err;
    }
  }

  public async getFundingTransactions(
    tradingAccountId?: string,
    symbol?: string,
    limit = 100
  ): Promise<FundingTransactionRecord[]> {
    const prisma = getPrismaClient();
    const whereClause: Prisma.FundingTransactionWhereInput = {};
    if (tradingAccountId) whereClause.tradingAccountId = tradingAccountId;
    if (symbol) whereClause.symbol = symbol;

    const rows = await prisma.fundingTransaction.findMany({
      where: whereClause,
      orderBy: { exchangeTimestamp: 'desc' },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      tradingAccountId: r.tradingAccountId,
      externalId: r.externalId,
      symbol: r.symbol,
      amount: new Decimal(r.amount.toString()),
      currency: r.currency,
      fundingRate: r.fundingRate ? new Decimal(r.fundingRate.toString()) : null,
      exchangeTimestamp: r.exchangeTimestamp.toISOString(),
      rawPayload: r.rawPayload as Record<string, any>,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  public async saveEquitySnapshot(snapshot: EquitySnapshotRecord): Promise<void> {
    const prisma = getPrismaClient();
    await prisma.equitySnapshot.create({
      data: {
        id: snapshot.id,
        tradingAccountId: snapshot.tradingAccountId,
        timestamp: new Date(snapshot.timestamp),
        equity: new Prisma.Decimal(snapshot.equity.toString()),
        walletBalance: snapshot.walletBalance ? new Prisma.Decimal(snapshot.walletBalance.toString()) : null,
        availableBalance: snapshot.availableBalance ? new Prisma.Decimal(snapshot.availableBalance.toString()) : null,
        unrealizedPnl: snapshot.unrealizedPnl ? new Prisma.Decimal(snapshot.unrealizedPnl.toString()) : null,
        realizedPnlCumulative: snapshot.realizedPnlCumulative
          ? new Prisma.Decimal(snapshot.realizedPnlCumulative.toString())
          : null,
        source: snapshot.source, // 'API' | 'CALCULATED' | 'MOCK'
        createdAt: new Date(snapshot.createdAt),
      },
    });
  }

  public async getEquitySnapshots(tradingAccountId: string, limit = 100): Promise<EquitySnapshotRecord[]> {
    const prisma = getPrismaClient();
    const rows = await prisma.equitySnapshot.findMany({
      where: { tradingAccountId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      tradingAccountId: r.tradingAccountId,
      timestamp: r.timestamp.toISOString(),
      equity: new Decimal(r.equity.toString()),
      walletBalance: r.walletBalance ? new Decimal(r.walletBalance.toString()) : null,
      availableBalance: r.availableBalance ? new Decimal(r.availableBalance.toString()) : null,
      unrealizedPnl: r.unrealizedPnl ? new Decimal(r.unrealizedPnl.toString()) : null,
      realizedPnlCumulative: r.realizedPnlCumulative ? new Decimal(r.realizedPnlCumulative.toString()) : null,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  public async createSyncJob(job: SyncJobRecord): Promise<void> {
    const prisma = getPrismaClient();
    await prisma.syncJob.create({
      data: {
        id: job.id,
        tradingAccountId: job.tradingAccountId,
        syncType: job.syncType as any,
        status: job.status as any,
        startedAt: new Date(job.startedAt),
        completedAt: job.completedAt ? new Date(job.completedAt) : null,
        recordsReceived: job.recordsReceived,
        recordsInserted: job.recordsInserted,
        recordsSkipped: job.recordsSkipped,
        errorMessage: job.errorMessage,
        metadata: job.metadata as Prisma.InputJsonValue,
        createdAt: new Date(job.createdAt),
      },
    });
  }

  public async updateSyncJob(jobId: string, updates: Partial<SyncJobRecord>): Promise<void> {
    const prisma = getPrismaClient();
    const updateData: Prisma.SyncJobUpdateInput = {};

    if (updates.status) updateData.status = updates.status as any;
    if (updates.completedAt !== undefined) {
      updateData.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
    }
    if (updates.recordsReceived !== undefined) updateData.recordsReceived = updates.recordsReceived;
    if (updates.recordsInserted !== undefined) updateData.recordsInserted = updates.recordsInserted;
    if (updates.recordsSkipped !== undefined) updateData.recordsSkipped = updates.recordsSkipped;
    if (updates.errorMessage !== undefined) updateData.errorMessage = updates.errorMessage;
    if (updates.metadata) updateData.metadata = updates.metadata as Prisma.InputJsonValue;

    await prisma.syncJob.update({
      where: { id: jobId },
      data: updateData,
    });
  }

  public async getSyncJobs(tradingAccountId?: string, limit = 50): Promise<SyncJobRecord[]> {
    const prisma = getPrismaClient();
    const whereClause: Prisma.SyncJobWhereInput = {};
    if (tradingAccountId) whereClause.tradingAccountId = tradingAccountId;

    const rows = await prisma.syncJob.findMany({
      where: whereClause,
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      tradingAccountId: r.tradingAccountId,
      syncType: r.syncType as SyncType,
      status: r.status as SyncStatus,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      recordsReceived: r.recordsReceived,
      recordsInserted: r.recordsInserted,
      recordsSkipped: r.recordsSkipped,
      errorMessage: r.errorMessage,
      metadata: (r.metadata as Record<string, any>) || null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  public async getSyncJob(jobId: string): Promise<SyncJobRecord | null> {
    const prisma = getPrismaClient();
    const r = await prisma.syncJob.findUnique({
      where: { id: jobId },
    });
    if (!r) return null;

    return {
      id: r.id,
      tradingAccountId: r.tradingAccountId,
      syncType: r.syncType as SyncType,
      status: r.status as SyncStatus,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      recordsReceived: r.recordsReceived,
      recordsInserted: r.recordsInserted,
      recordsSkipped: r.recordsSkipped,
      errorMessage: r.errorMessage,
      metadata: (r.metadata as Record<string, any>) || null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  public async deleteSyncJob(jobId: string): Promise<void> {
    const prisma = getPrismaClient();
    await prisma.syncJob.delete({
      where: { id: jobId },
    });
  }

  public async getTradingAccount(id?: string): Promise<TradingAccountRecord | null> {
    const prisma = getPrismaClient();
    if (id) {
      const acc = await prisma.tradingAccount.findUnique({ where: { id } });
      if (!acc) return null;
      return {
        id: acc.id,
        userId: acc.userId,
        exchangeId: acc.exchangeId,
        accountName: acc.accountName,
        accountType: acc.accountType as AccountType,
        baseCurrency: acc.baseCurrency,
        externalAccountId: acc.externalAccountId,
        isActive: acc.isActive,
        createdAt: acc.createdAt.toISOString(),
        updatedAt: acc.updatedAt.toISOString(),
      };
    }

    const first = await prisma.tradingAccount.findFirst({
      where: { isActive: true },
    });
    if (!first) return null;
    return {
      id: first.id,
      userId: first.userId,
      exchangeId: first.exchangeId,
      accountName: first.accountName,
      accountType: first.accountType as AccountType,
      baseCurrency: first.baseCurrency,
      externalAccountId: first.externalAccountId,
      isActive: first.isActive,
      createdAt: first.createdAt.toISOString(),
      updatedAt: first.updatedAt.toISOString(),
    };
  }

  public async getTrades(filters?: any): Promise<TradeRecord[]> {
    const prisma = getPrismaClient();
    const whereClause: Prisma.TradeWhereInput = {};

    if (filters?.accountId) whereClause.tradingAccountId = filters.accountId;
    if (filters?.symbol) whereClause.symbol = filters.symbol;
    if (filters?.strategyId) whereClause.strategyId = filters.strategyId;
    if (filters?.session) whereClause.session = filters.session;
    if (filters?.direction) whereClause.direction = filters.direction;

    const rows = await prisma.trade.findMany({
      where: whereClause,
      orderBy: { openedAt: 'desc' },
      take: filters?.limit || 200,
    });

    return rows.map((t) => ({
      id: t.id,
      tradingAccountId: t.tradingAccountId,
      symbol: t.symbol,
      marketCategory: t.marketCategory as any,
      direction: t.direction as any,
      status: t.status as any,
      openedAt: t.openedAt.toISOString(),
      closedAt: t.closedAt ? t.closedAt.toISOString() : null,
      averageEntryPrice: new Decimal(t.averageEntryPrice.toString()),
      averageExitPrice: t.averageExitPrice ? new Decimal(t.averageExitPrice.toString()) : null,
      entryQuantity: new Decimal(t.entryQuantity.toString()),
      exitQuantity: t.exitQuantity ? new Decimal(t.exitQuantity.toString()) : null,
      grossPnl: t.grossPnl ? new Decimal(t.grossPnl.toString()) : null,
      netPnl: t.netPnl ? new Decimal(t.netPnl.toString()) : null,
      feesTotal: new Decimal(t.feesTotal.toString()),
      fundingTotal: new Decimal(t.fundingTotal.toString()),
      returnPercent: t.returnPercent ? new Decimal(t.returnPercent.toString()) : null,
      riskAmount: t.riskAmount ? new Decimal(t.riskAmount.toString()) : null,
      riskPercent: t.riskPercent ? new Decimal(t.riskPercent.toString()) : null,
      rMultiple: t.rMultiple ? new Decimal(t.rMultiple.toString()) : null,
      leverage: t.leverage,
      holdingSeconds: t.holdingSeconds,
      strategyId: t.strategyId,
      setupId: t.setupId,
      session: t.session,
      tradeNumberOfDay: t.tradeNumberOfDay,
      followedRules: t.followedRules,
      emotion: t.emotion,
      confidenceScore: t.confidenceScore,
      notes: t.notes,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
  }

  public async getDailyPerformance(tradingAccountId?: string): Promise<DailyPerformanceRecord[]> {
    const prisma = getPrismaClient();
    const whereClause: Prisma.DailyPerformanceWhereInput = {};
    if (tradingAccountId) whereClause.tradingAccountId = tradingAccountId;

    const rows = await prisma.dailyPerformance.findMany({
      where: whereClause,
      orderBy: { date: 'asc' },
    });

    return rows.map((d) => ({
      id: d.id,
      tradingAccountId: d.tradingAccountId,
      date: d.date,
      startingEquity: new Decimal(d.startingEquity.toString()),
      endingEquity: new Decimal(d.endingEquity.toString()),
      grossPnl: new Decimal(d.grossPnl.toString()),
      netPnl: new Decimal(d.netPnl.toString()),
      fees: new Decimal(d.fees.toString()),
      funding: new Decimal(d.funding.toString()),
      returnPercent: new Decimal(d.returnPercent.toString()),
      tradesCount: d.tradesCount,
      wins: d.wins,
      losses: d.losses,
      winRate: new Decimal(d.winRate.toString()),
      grossProfit: new Decimal(d.grossProfit.toString()),
      grossLoss: new Decimal(d.grossLoss.toString()),
      profitFactor: d.profitFactor ? new Decimal(d.profitFactor.toString()) : null,
      averageR: d.averageR ? new Decimal(d.averageR.toString()) : null,
      maxDrawdownPercent: d.maxDrawdownPercent ? new Decimal(d.maxDrawdownPercent.toString()) : null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }));
  }

  public async getCounts(): Promise<{
    rawOrders: number;
    rawFills: number;
    fundingTransactions: number;
    equitySnapshots: number;
  }> {
    const prisma = getPrismaClient();
    const [rawOrders, rawFills, fundingTransactions, equitySnapshots] = await Promise.all([
      prisma.rawExchangeOrder.count(),
      prisma.rawExchangeFill.count(),
      prisma.fundingTransaction.count(),
      prisma.equitySnapshot.count(),
    ]);

    return { rawOrders, rawFills, fundingTransactions, equitySnapshots };
  }
}

// -----------------------------------------------------------------------------
// IN-MEMORY REPOSITORY (DEVELOPMENT / MOCK MODE ONLY)
// -----------------------------------------------------------------------------

export class InMemoryRepository implements ITradingRepository {
  public readonly isPersistent = false;

  public async getHealth(): Promise<DatabaseHealth> {
    return {
      status: 'NOT_CONFIGURED',
      provider: 'In-Memory Development Store',
      persistent: false,
      message: 'Active in development mock mode. Connect Supabase/PostgreSQL for persistent operation.',
      tablesCount: 0,
    };
  }

  public async ensureDefaultAccounts(): Promise<void> {
    // Already populated by in-memory seed if present
  }

  public async saveRawOrder(order: RawExchangeOrderRecord): Promise<'inserted' | 'skipped'> {
    const key = `${order.tradingAccountId}:${order.exchangeOrderId}`;
    if (db.rawExchangeOrders.has(key)) {
      return 'skipped';
    }
    db.rawExchangeOrders.set(key, order);
    return 'inserted';
  }

  public async saveRawOrders(orders: RawExchangeOrderRecord[]): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0;
    let skipped = 0;
    for (const ord of orders) {
      const res = await this.saveRawOrder(ord);
      if (res === 'inserted') inserted++;
      else skipped++;
    }
    return { inserted, skipped };
  }

  public async getRawOrders(tradingAccountId?: string, symbol?: string, limit = 100): Promise<RawExchangeOrderRecord[]> {
    let list = Array.from(db.rawExchangeOrders.values());
    if (tradingAccountId) list = list.filter((o) => o.tradingAccountId === tradingAccountId);
    if (symbol) list = list.filter((o) => o.symbol === symbol);
    return list.slice(0, limit);
  }

  public async saveRawFill(fill: RawExchangeFillRecord): Promise<'inserted' | 'skipped'> {
    const key = `${fill.tradingAccountId}:${fill.exchangeFillId}`;
    if (db.rawExchangeFills.has(key)) {
      return 'skipped';
    }
    db.rawExchangeFills.set(key, fill);
    return 'inserted';
  }

  public async saveRawFills(fills: RawExchangeFillRecord[]): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0;
    let skipped = 0;
    for (const f of fills) {
      const res = await this.saveRawFill(f);
      if (res === 'inserted') inserted++;
      else skipped++;
    }
    return { inserted, skipped };
  }

  public async getRawFills(tradingAccountId?: string, symbol?: string, limit = 100): Promise<RawExchangeFillRecord[]> {
    let list = Array.from(db.rawExchangeFills.values());
    if (tradingAccountId) list = list.filter((f) => f.tradingAccountId === tradingAccountId);
    if (symbol) list = list.filter((f) => f.symbol === symbol);
    return list.slice(0, limit);
  }

  public async saveFundingTransaction(funding: FundingTransactionRecord): Promise<'inserted' | 'skipped'> {
    const key = funding.id;
    if (db.fundingTransactions.has(key)) {
      return 'skipped';
    }
    db.fundingTransactions.set(key, funding);
    return 'inserted';
  }

  public async getFundingTransactions(
    tradingAccountId?: string,
    symbol?: string,
    limit = 100
  ): Promise<FundingTransactionRecord[]> {
    let list = Array.from(db.fundingTransactions.values());
    if (tradingAccountId) list = list.filter((f) => f.tradingAccountId === tradingAccountId);
    if (symbol) list = list.filter((f) => f.symbol === symbol);
    return list.slice(0, limit);
  }

  public async saveEquitySnapshot(snapshot: EquitySnapshotRecord): Promise<void> {
    db.equitySnapshots.set(snapshot.id, snapshot);
  }

  public async getEquitySnapshots(tradingAccountId: string, limit = 100): Promise<EquitySnapshotRecord[]> {
    return Array.from(db.equitySnapshots.values())
      .filter((s) => s.tradingAccountId === tradingAccountId)
      .slice(0, limit);
  }

  public async createSyncJob(job: SyncJobRecord): Promise<void> {
    db.syncJobs.set(job.id, job);
  }

  public async updateSyncJob(jobId: string, updates: Partial<SyncJobRecord>): Promise<void> {
    const existing = db.syncJobs.get(jobId);
    if (existing) {
      db.syncJobs.set(jobId, { ...existing, ...updates });
    }
  }

  public async getSyncJobs(tradingAccountId?: string, limit = 50): Promise<SyncJobRecord[]> {
    let list = Array.from(db.syncJobs.values());
    if (tradingAccountId) list = list.filter((j) => j.tradingAccountId === tradingAccountId);
    return list.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, limit);
  }

  public async getSyncJob(jobId: string): Promise<SyncJobRecord | null> {
    return db.syncJobs.get(jobId) || null;
  }

  public async deleteSyncJob(jobId: string): Promise<void> {
    db.syncJobs.delete(jobId);
  }

  public async getTradingAccount(id?: string): Promise<TradingAccountRecord | null> {
    if (id) return db.tradingAccounts.get(id) || null;
    return Array.from(db.tradingAccounts.values())[0] || null;
  }

  public async getTrades(filters?: any): Promise<TradeRecord[]> {
    let list = Array.from(db.trades.values());
    if (filters?.accountId) list = list.filter((t) => t.tradingAccountId === filters.accountId);
    if (filters?.symbol) list = list.filter((t) => t.symbol.toLowerCase() === filters.symbol?.toLowerCase());
    if (filters?.strategyId) list = list.filter((t) => t.strategyId === filters.strategyId);
    if (filters?.session) list = list.filter((t) => t.session?.toLowerCase() === filters.session?.toLowerCase());
    if (filters?.direction) list = list.filter((t) => t.direction === filters.direction);
    return list;
  }

  public async getDailyPerformance(tradingAccountId?: string): Promise<DailyPerformanceRecord[]> {
    let list = Array.from(db.dailyPerformances.values());
    if (tradingAccountId) list = list.filter((d) => d.tradingAccountId === tradingAccountId);
    return list;
  }

  public async getCounts(): Promise<{
    rawOrders: number;
    rawFills: number;
    fundingTransactions: number;
    equitySnapshots: number;
  }> {
    return {
      rawOrders: db.rawExchangeOrders.size,
      rawFills: db.rawExchangeFills.size,
      fundingTransactions: db.fundingTransactions.size,
      equitySnapshots: db.equitySnapshots.size,
    };
  }
}

// -----------------------------------------------------------------------------
// REPOSITORY FACTORY
// -----------------------------------------------------------------------------

let activeRepository: ITradingRepository | null = null;

/**
 * Returns the active repository instance based on server environment.
 * If DATABASE_URL is configured, returns PrismaPostgresRepository.
 * In development without DATABASE_URL, returns InMemoryRepository strictly for mock exploration.
 *
 * Mandate: NEVER automatically fall back to in-memory storage when real MEXC credentials are configured.
 */
export function getTradingRepository(): ITradingRepository {
  if (activeRepository) {
    return activeRepository;
  }

  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl && dbUrl.length > 10) {
    activeRepository = new PrismaPostgresRepository();
  } else {
    activeRepository = new InMemoryRepository();
  }

  return activeRepository;
}

/**
 * Explicitly reset or inject repository (useful for testing)
 */
export function setTradingRepository(repo: ITradingRepository | null): void {
  activeRepository = repo;
}
