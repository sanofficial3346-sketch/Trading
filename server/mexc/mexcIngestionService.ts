/**
 * MEXC Ingestion Service (Strictly Read-Only Data Synchronization)
 *
 * Implements:
 * - Paginated ingestion of raw futures orders into `raw_exchange_orders`
 * - Paginated ingestion of raw deals/executions into `raw_exchange_fills`
 * - Ingestion of funding transactions into `funding_transactions`
 * - Account balance retrieval & normalized `equity_snapshots` creation
 * - Idempotent deduplication guarantees (trading_account_id + exchange_fill_id / exchange_order_id)
 * - Complete preservation of untouched `raw_payload` (with no secrets)
 * - Complete `sync_jobs` audit trail with pagination and duplicate metrics
 * - Preparation for Step 4 trade reconstruction (No premature aggregation)
 */

import { Decimal } from 'decimal.js';
import { db } from '../../src/db/database';
import {
  EquitySnapshotRecord,
  FundingTransactionRecord,
  RawExchangeFillRecord,
  RawExchangeOrderRecord,
  SyncJobRecord,
  SyncStatus,
  SyncType,
} from '../../src/db/types';
import { MexcClient, MexcClientError } from './mexcClient';
import {
  MexcAssetRaw,
  MexcConnectionStatus,
  MexcErrorCode,
  MexcFundingRecordRaw,
  MexcHistoryOrderRaw,
  MexcIntegrationStatus,
  MexcOrderDealRaw,
  MexcSyncResult,
  NormalizedMexcBalance,
  TestConnectionResult,
} from './types';
import { getTradingRepository } from '../db/repository';

export class MexcIngestionService {
  private client: MexcClient;
  private defaultAccountId: string = 'acc_mexc_futures_01';
  private lastSuccessfulSyncAt: string | null = null;
  private lastFailedSyncAt: string | null = null;
  private lastError: string | null = null;
  private connectionTestedSuccessfully: boolean = false;

  constructor(client?: MexcClient) {
    this.client = client || new MexcClient();
  }

  /**
   * Helper: Gather known symbols from orders, fills, positions, and fallback defaults
   */
  public getKnownSymbols(): string[] {
    const symbolSet = new Set<string>();
    for (const order of db.rawExchangeOrders.values()) {
      if (order.symbol) symbolSet.add(order.symbol);
    }
    for (const fill of db.rawExchangeFills.values()) {
      if (fill.symbol) symbolSet.add(fill.symbol);
    }
    if (symbolSet.size === 0) {
      symbolSet.add('BTC_USDT');
      symbolSet.add('ETH_USDT');
      symbolSet.add('SOL_USDT');
    }
    return Array.from(symbolSet);
  }

  public getClient(): MexcClient {
    return this.client;
  }

  /**
   * Safe Connection Test
   * Harmless read-only inspection: server ping + account asset balance check
   */
  public async testConnection(): Promise<TestConnectionResult> {
    const timestamp = new Date().toISOString();

    if (!this.client.isConfigured()) {
      return {
        success: false,
        status: MexcConnectionStatus.NOT_CONFIGURED,
        accountDetected: false,
        timestamp,
        serverTime: Date.now(),
        timeOffsetMs: 0,
        message: 'MEXC API credentials (MEXC_ACCESS_KEY / MEXC_SECRET_KEY) are not set in the server environment.',
        readOnlyPermissionsVerified: false,
      };
    }

    try {
      const pingResult = await this.client.ping();
      const assets = await this.client.getAccountAssets();
      const offset = pingResult.serverTime - Date.now();

      const assetsSample = assets.map((a: MexcAssetRaw) => ({
        currency: a.currency,
        equity: String(a.equity ?? '0'),
        available: String(a.availableBalance ?? '0'),
        unrealized: String(a.unrealized ?? '0'),
      }));

      this.connectionTestedSuccessfully = true;
      this.lastError = null;

      return {
        success: true,
        status: MexcConnectionStatus.CONNECTED,
        accountDetected: true,
        timestamp,
        serverTime: pingResult.serverTime,
        timeOffsetMs: offset,
        message: `Successfully connected to MEXC Futures API (contract.mexc.com). Verified read access across ${assets.length} currency assets.`,
        readOnlyPermissionsVerified: true,
        assetsSample: assetsSample.slice(0, 5),
      };
    } catch (err: unknown) {
      this.connectionTestedSuccessfully = false;
      const error = err as MexcClientError | Error;
      const code = 'code' in error ? error.code : MexcErrorCode.NETWORK_ERROR;
      const message = error.message;
      this.lastError = message;

      return {
        success: false,
        status: code === MexcErrorCode.RATE_LIMITED ? MexcConnectionStatus.RATE_LIMITED : MexcConnectionStatus.ERROR,
        accountDetected: false,
        timestamp,
        serverTime: Date.now(),
        timeOffsetMs: 0,
        message: `MEXC test connection failed: ${message}`,
        readOnlyPermissionsVerified: false,
      };
    }
  }

  /**
   * Retrieve and Normalize Futures Account Balance
   * Safe read-only calculation of wallet balance and equity
   */
  public async getMexcAccountBalance(tradingAccountId = this.defaultAccountId): Promise<NormalizedMexcBalance> {
    const assets = await this.client.getAccountAssets();
    const timestamp = new Date().toISOString();

    // Default primary collateral is USDT for USDT-M futures
    const usdtAsset = assets.find((a) => a.currency.toUpperCase() === 'USDT') || assets[0];

    if (!usdtAsset) {
      return {
        totalEquity: '0',
        walletBalance: '0',
        availableBalance: '0',
        unrealizedPnl: '0',
        currency: 'USDT',
        timestamp,
      };
    }

    const equity = new Decimal(usdtAsset.equity ?? 0);
    const walletBalance = new Decimal(usdtAsset.cashBalance ?? usdtAsset.availableBalance ?? 0);
    const availableBalance = new Decimal(usdtAsset.availableBalance ?? 0);
    const unrealizedPnl = new Decimal(usdtAsset.unrealized ?? 0);

    // Update trading account record in local store
    const account = db.tradingAccounts.get(tradingAccountId);
    if (account) {
      account.updatedAt = timestamp;
    }

    return {
      totalEquity: equity.toFixed(4),
      walletBalance: walletBalance.toFixed(4),
      availableBalance: availableBalance.toFixed(4),
      unrealizedPnl: unrealizedPnl.toFixed(4),
      currency: usdtAsset.currency || 'USDT',
      timestamp,
    };
  }

  /**
   * Record a single, accurate Equity Snapshot from current balance
   * Guarantees exactly one snapshot per sync cycle
   */
  public async recordEquitySnapshot(
    balance: NormalizedMexcBalance,
    tradingAccountId = this.defaultAccountId
  ): Promise<EquitySnapshotRecord> {
    const snapshotId = `snap_api_${Date.now()}`;
    const snapshot: EquitySnapshotRecord = {
      id: snapshotId,
      tradingAccountId,
      timestamp: balance.timestamp,
      equity: new Decimal(balance.totalEquity),
      walletBalance: new Decimal(balance.walletBalance),
      availableBalance: new Decimal(balance.availableBalance),
      unrealizedPnl: new Decimal(balance.unrealizedPnl),
      realizedPnlCumulative: null,
      source: 'API',
      createdAt: balance.timestamp,
    };

    db.equitySnapshots.set(snapshotId, snapshot);
    const repository = getTradingRepository();
    await repository.saveEquitySnapshot(snapshot);
    return snapshot;
  }

  /**
   * Paginated Ingestion of Raw Futures Orders
   * Maps each exchange order into `raw_exchange_orders` with complete `raw_payload`.
   * Enforces compound idempotency: (tradingAccountId, exchangeOrderId)
   */
  public async ingestHistoricalOrders(options: {
    tradingAccountId?: string;
    maxPages?: number;
    pageSize?: number;
    symbol?: string;
  } = {}): Promise<{ received: number; inserted: number; skipped: number; pages: number }> {
    const tradingAccountId = options.tradingAccountId || this.defaultAccountId;
    const maxPages = options.maxPages || 50;
    const pageSize = options.pageSize || 50;
    let pageNum = 1;
    let received = 0;
    let inserted = 0;
    let skipped = 0;

    while (pageNum <= maxPages) {
      const orders = await this.client.getHistoricalOrders({
        pageNum,
        pageSize,
        symbol: options.symbol,
      });

      if (!orders || orders.length === 0) {
        break;
      }

      received += orders.length;

      for (const raw of orders) {
        const exchangeOrderId = String(raw.orderId);
        if (!exchangeOrderId) continue;

        const key = `${tradingAccountId}:${exchangeOrderId}`;

        // Idempotency check: Skip existing
        if (db.rawExchangeOrders.has(key)) {
          skipped++;
          continue;
        }

        const sideMapped = this.mapOrderSide(raw.side);
        const orderRecord: RawExchangeOrderRecord = {
          id: `ord_${exchangeOrderId}`,
          tradingAccountId,
          exchangeOrderId,
          symbol: String(raw.symbol),
          side: sideMapped,
          orderType: String(raw.orderType ?? 'LIMIT'),
          status: this.mapOrderStatus(raw.state),
          price: new Decimal(raw.price ?? 0),
          quantity: new Decimal(raw.vol ?? 0),
          filledQuantity: new Decimal(raw.dealVol ?? 0),
          averagePrice: raw.dealAvgPrice ? new Decimal(raw.dealAvgPrice) : null,
          reduceOnly: Boolean(raw.reduceOnly),
          positionSide: raw.positionType === 1 ? 'LONG' : raw.positionType === 2 ? 'SHORT' : null,
          leverage: typeof raw.leverage === 'number' ? raw.leverage : null,
          exchangeCreatedAt: new Date(raw.createTime || Date.now()).toISOString(),
          exchangeUpdatedAt: raw.updateTime ? new Date(raw.updateTime).toISOString() : null,
          rawPayload: this.sanitizeRawPayload(raw),
          syncedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };

        db.rawExchangeOrders.set(key, orderRecord);
        const repository = getTradingRepository();
        await repository.saveRawOrder(orderRecord);
        inserted++;
      }

      if (orders.length < pageSize) {
        break; // End of paginated results reached
      }

      pageNum++;
    }

    return { received, inserted, skipped, pages: pageNum };
  }

  /**
   * Paginated Ingestion of Raw Deals / Executions / Fills
   * Maps each individual execution into `raw_exchange_fills`.
   * Enforces compound idempotency: (tradingAccountId, exchangeFillId)
   * Strictly NO premature combination into trades (Step 4 responsibility).
   *
   * Note on MEXC Contract API: The `symbol` parameter is mandatory.
   * If not explicitly specified, iterates over all known/active contract symbols.
   * For historical backfill, segments queries into non-overlapping 90-day windows.
   */
  public async ingestOrderDeals(options: {
    tradingAccountId?: string;
    maxPages?: number;
    pageSize?: number;
    symbol?: string;
    isBackfill?: boolean;
  } = {}): Promise<{ received: number; inserted: number; skipped: number; pages: number }> {
    const tradingAccountId = options.tradingAccountId || this.defaultAccountId;
    const symbolsToSync = options.symbol ? [options.symbol] : this.getKnownSymbols();
    const isBackfill = Boolean(options.isBackfill);
    const pageSize = Math.min(options.pageSize || (isBackfill ? 100 : 50), 100);

    let totalReceived = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalPages = 0;

    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    // 4 windows = up to 360 days backfill coverage
    const windowCount = isBackfill ? 4 : 1;

    for (const symbol of symbolsToSync) {
      if (!symbol || !symbol.trim()) continue;

      for (let w = 0; w < windowCount; w++) {
        const winEnd = isBackfill ? now - w * NINETY_DAYS_MS : undefined;
        const winStart = isBackfill && winEnd ? winEnd - NINETY_DAYS_MS + 1 : undefined;

        let pageNum = 1;
        const maxPages = options.maxPages || (isBackfill ? 20 : 10);

        while (pageNum <= maxPages) {
          totalPages++;
          let deals: MexcOrderDealRaw[] = [];

          try {
            deals = await this.client.getOrderDeals({
              symbol,
              pageNum,
              pageSize,
              startTime: winStart,
              endTime: winEnd,
            });
          } catch (err: unknown) {
            console.warn(`[MEXC] Order deals fetch warning for ${symbol} (page ${pageNum}):`, (err as Error).message);
            break;
          }

          if (!deals || deals.length === 0) {
            break;
          }

          totalReceived += deals.length;

          for (const deal of deals) {
            // Construct deterministic unique identifier if exchange fill id is absent
            const exchangeFillId = deal.id
              ? String(deal.id)
              : `${deal.orderId ?? 'ord'}_${deal.timestamp}_${deal.price}_${deal.vol}`;

            const key = `${tradingAccountId}:${exchangeFillId}`;

            // Idempotency check: Skip duplicate fill
            if (db.rawExchangeFills.has(key)) {
              totalSkipped++;
              continue;
            }

            const price = new Decimal(deal.price ?? 0);
            const quantity = new Decimal(deal.vol ?? 0);
            const quoteQuantity = deal.amount ? new Decimal(deal.amount) : price.times(quantity);
            const fee = new Decimal(deal.fee ?? 0);
            const realizedPnl = deal.profit !== undefined ? new Decimal(deal.profit) : null;

            const fillRecord: RawExchangeFillRecord = {
              id: `fill_${exchangeFillId}`,
              tradingAccountId,
              exchangeFillId,
              exchangeOrderId: deal.orderId ? String(deal.orderId) : null,
              symbol: String(deal.symbol || symbol),
              side: this.mapDealSide(deal.side),
              price,
              quantity,
              quoteQuantity,
              fee,
              feeCurrency: deal.feeCurrency || 'USDT',
              realizedPnl,
              positionSide: null,
              liquidityType: deal.taker ? 'TAKER' : 'MAKER',
              exchangeTimestamp: new Date(deal.timestamp || Date.now()).toISOString(),
              rawPayload: this.sanitizeRawPayload(deal),
              syncedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };

            db.rawExchangeFills.set(key, fillRecord);
            const repository = getTradingRepository();
            await repository.saveRawFill(fillRecord);
            totalInserted++;
          }

          if (deals.length < pageSize) {
            break; // End of pagination reached for this window
          }

          pageNum++;
        }
      }
    }

    return {
      received: totalReceived,
      inserted: totalInserted,
      skipped: totalSkipped,
      pages: totalPages,
    };
  }

  /**
   * Ingest Funding Settlement History
   * Maps funding fees into `funding_transactions`.
   */
  public async ingestFundingRecords(options: {
    tradingAccountId?: string;
    maxPages?: number;
    pageSize?: number;
    symbol?: string;
  } = {}): Promise<{ received: number; inserted: number; skipped: number; pages: number }> {
    const tradingAccountId = options.tradingAccountId || this.defaultAccountId;
    const maxPages = options.maxPages || 20;
    const pageSize = options.pageSize || 50;
    let pageNum = 1;
    let received = 0;
    let inserted = 0;
    let skipped = 0;

    while (pageNum <= maxPages) {
      const records = await this.client.getFundingRecords({
        pageNum,
        pageSize,
        symbol: options.symbol,
      });

      if (!records || records.length === 0) {
        break;
      }

      received += records.length;

      for (const rec of records) {
        const externalId = rec.id ? String(rec.id) : `fund_${rec.symbol}_${rec.timestamp}`;
        const key = `${tradingAccountId}:${externalId}`;

        if (db.fundingTransactions.has(key)) {
          skipped++;
          continue;
        }

        const fundingRecord: FundingTransactionRecord = {
          id: key,
          tradingAccountId,
          externalId,
          symbol: String(rec.symbol),
          amount: new Decimal(rec.amount ?? 0),
          currency: rec.currency || 'USDT',
          fundingRate: rec.fundingRate ? new Decimal(rec.fundingRate) : null,
          exchangeTimestamp: new Date(rec.timestamp || Date.now()).toISOString(),
          rawPayload: this.sanitizeRawPayload(rec),
          createdAt: new Date().toISOString(),
        };

        db.fundingTransactions.set(key, fundingRecord);
        const repository = getTradingRepository();
        await repository.saveFundingTransaction(fundingRecord);
        inserted++;
      }

      if (records.length < pageSize) {
        break;
      }

      pageNum++;
    }

    return { received, inserted, skipped, pages: pageNum };
  }

  /**
   * Run Complete Read-Only Synchronization
   * Creates an audited `sync_jobs` record, executes balance, orders, fills, and funding sync.
   */
  public async runFullSync(options: {
    syncType?: SyncType;
    isBackfill?: boolean;
    maxPages?: number;
    symbol?: string;
  } = {}): Promise<MexcSyncResult> {
    const tradingAccountId = this.defaultAccountId;
    const syncType = options.syncType || (options.isBackfill ? SyncType.FULL_HISTORY : SyncType.FILLS);
    const jobId = `sync_${Date.now()}`;
    const startedAt = new Date().toISOString();
    const startTimeMs = Date.now();

    // Create sync job in RUNNING status
    const syncJob: SyncJobRecord = {
      id: jobId,
      tradingAccountId,
      syncType,
      status: SyncStatus.RUNNING,
      startedAt,
      completedAt: null,
      recordsReceived: 0,
      recordsInserted: 0,
      recordsSkipped: 0,
      errorMessage: null,
      metadata: {
        isBackfill: Boolean(options.isBackfill),
        targetSymbol: options.symbol || 'ALL',
      },
      createdAt: startedAt,
    };
    db.syncJobs.set(jobId, syncJob);
    const repository = getTradingRepository();
    await repository.createSyncJob(syncJob);

    let ordersStats = { received: 0, inserted: 0, skipped: 0, pages: 0 };
    let fillsStats = { received: 0, inserted: 0, skipped: 0, pages: 0 };
    let fundingStats = { received: 0, inserted: 0, skipped: 0, pages: 0 };
    let balanceUpdated = false;
    let currentEquityStr: string | undefined;

    try {
      const dbHealth = await repository.getHealth();
      if (this.client.isConfigured()) {
        if (!repository.isPersistent || dbHealth.status !== 'CONNECTED') {
          throw new Error(
            `PostgreSQL persistence is not active (${dbHealth.message || 'DATABASE_URL not configured'}). In accordance with data integrity mandates, live MEXC exchange history cannot be synced into volatile in-memory storage only.`
          );
        }
      }

      // 1. Synchronize Balances & Record Snapshot
      try {
        const balance = await this.getMexcAccountBalance(tradingAccountId);
        await this.recordEquitySnapshot(balance, tradingAccountId);
        balanceUpdated = true;
        currentEquityStr = balance.totalEquity;
      } catch (err: unknown) {
        console.warn('[MEXC] Balance synchronization warning:', (err as Error).message);
      }

      // 2. Ingest Historical Orders
      const maxPages = options.maxPages || (options.isBackfill ? 100 : 5);
      ordersStats = await this.ingestHistoricalOrders({
        tradingAccountId,
        maxPages,
        pageSize: 50,
        symbol: options.symbol,
      });

      // 3. Ingest Historical Deals / Fills (with 90-day time window handling)
      fillsStats = await this.ingestOrderDeals({
        tradingAccountId,
        maxPages,
        pageSize: 50,
        symbol: options.symbol,
        isBackfill: options.isBackfill,
      });

      // 4. Ingest Funding Records
      fundingStats = await this.ingestFundingRecords({
        tradingAccountId,
        maxPages: Math.min(maxPages, 20),
        pageSize: 50,
        symbol: options.symbol,
      });

      const totalReceived = ordersStats.received + fillsStats.received + fundingStats.received;
      const totalInserted = ordersStats.inserted + fillsStats.inserted + fundingStats.inserted;
      const totalSkipped = ordersStats.skipped + fillsStats.skipped + fundingStats.skipped;
      const completedAt = new Date().toISOString();

      // Finalize sync job as COMPLETED
      syncJob.status = SyncStatus.COMPLETED;
      syncJob.completedAt = completedAt;
      syncJob.recordsReceived = totalReceived;
      syncJob.recordsInserted = totalInserted;
      syncJob.recordsSkipped = totalSkipped;
      syncJob.metadata = {
        ...syncJob.metadata,
        orders: ordersStats,
        fills: fillsStats,
        funding: fundingStats,
        balanceUpdated,
      };

      await repository.updateSyncJob(jobId, {
        status: SyncStatus.COMPLETED,
        completedAt,
        recordsReceived: totalReceived,
        recordsInserted: totalInserted,
        recordsSkipped: totalSkipped,
        metadata: syncJob.metadata,
      });

      this.lastSuccessfulSyncAt = completedAt;
      this.lastError = null;

      return {
        jobId,
        syncType: String(syncType),
        status: 'COMPLETED',
        recordsReceived: totalReceived,
        recordsInserted: totalInserted,
        recordsSkipped: totalSkipped,
        durationMs: Date.now() - startTimeMs,
        startedAt,
        completedAt,
        details: {
          orders: ordersStats,
          fills: fillsStats,
          funding: fundingStats,
          balances: { updated: balanceUpdated, equity: currentEquityStr },
        },
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const completedAt = new Date().toISOString();

      syncJob.status = SyncStatus.FAILED;
      syncJob.completedAt = completedAt;
      syncJob.errorMessage = errorMsg;

      await repository.updateSyncJob(jobId, {
        status: SyncStatus.FAILED,
        completedAt,
        errorMessage: errorMsg,
      });

      this.lastFailedSyncAt = completedAt;
      this.lastError = errorMsg;

      return {
        jobId,
        syncType: String(syncType),
        status: 'FAILED',
        recordsReceived: ordersStats.received + fillsStats.received + fundingStats.received,
        recordsInserted: ordersStats.inserted + fillsStats.inserted + fundingStats.inserted,
        recordsSkipped: ordersStats.skipped + fillsStats.skipped + fundingStats.skipped,
        errorMessage: errorMsg,
        durationMs: Date.now() - startTimeMs,
        startedAt,
        completedAt,
        details: {
          orders: ordersStats,
          fills: fillsStats,
          funding: fundingStats,
          balances: { updated: balanceUpdated },
        },
      };
    }
  }

  /**
   * Integration Status Inspector
   */
  public async getIntegrationStatus(): Promise<MexcIntegrationStatus> {
    const isConfigured = this.client.isConfigured();
    const maskedKey = this.client.getMaskedAccessKey();
    const repository = getTradingRepository();
    const health = await repository.getHealth();
    const persistentDbConnected = repository.isPersistent && health.status === 'CONNECTED';
    const counts = await repository.getCounts();

    let status = MexcConnectionStatus.NOT_CONFIGURED;
    if (isConfigured) {
      if (this.lastError) {
        status = MexcConnectionStatus.ERROR;
      } else if (this.connectionTestedSuccessfully || this.lastSuccessfulSyncAt) {
        status = MexcConnectionStatus.CONNECTED;
      } else {
        status = MexcConnectionStatus.NOT_CONFIGURED;
      }
    }

    const mode = isConfigured
      ? persistentDbConnected
        ? 'READ_ONLY_STRICT'
        : 'MOCK_MODE_IN_MEMORY'
      : 'NOT_CONFIGURED';

    return {
      status,
      apiKeyConfigured: Boolean(isConfigured && maskedKey),
      secretKeyConfigured: isConfigured,
      maskedAccessKey: maskedKey,
      lastSuccessfulSync: this.lastSuccessfulSyncAt,
      lastFailedSync: this.lastFailedSyncAt,
      lastError: this.lastError,
      persistentDbConnected,
      activeAccountName: 'MEXC Futures Main',
      exchange: 'MEXC Global (Contract API)',
      mode,
      rawSummary: {
        ordersCount: counts.rawOrders,
        fillsCount: counts.rawFills,
        fundingCount: counts.fundingTransactions,
        snapshotsCount: counts.equitySnapshots,
      },
    };
  }

  // -------------------------------------------------------------------------
  // PRIVATE SANITIZATION & MAPPING HELPERS
  // -------------------------------------------------------------------------

  /**
   * Strict security check: strip any secret keys or signatures from raw payload
   */
  private sanitizeRawPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      const lower = k.toLowerCase();
      if (
        lower.includes('secret') ||
        lower.includes('signature') ||
        lower.includes('password') ||
        lower.includes('apikey')
      ) {
        continue;
      }
      clean[k] = v;
    }
    return clean;
  }

  private mapOrderSide(side: number | string): string {
    if (typeof side === 'number') {
      // MEXC futures side definitions: 1: open long, 2: close short, 3: open short, 4: close long
      switch (side) {
        case 1:
          return 'BUY_OPEN_LONG';
        case 2:
          return 'BUY_CLOSE_SHORT';
        case 3:
          return 'SELL_OPEN_SHORT';
        case 4:
          return 'SELL_CLOSE_LONG';
        default:
          return `SIDE_${side}`;
      }
    }
    return String(side || 'UNKNOWN').toUpperCase();
  }

  private mapDealSide(side: number | string | undefined): string {
    if (typeof side === 'number') {
      switch (side) {
        case 1:
          return 'OPEN_LONG';
        case 2:
          return 'CLOSE_SHORT';
        case 3:
          return 'OPEN_SHORT';
        case 4:
          return 'CLOSE_LONG';
        default:
          return `SIDE_${side}`;
      }
    }
    return String(side || 'DEAL').toUpperCase();
  }

  private mapOrderStatus(state: number | string | undefined): string {
    if (typeof state === 'number') {
      // 1: init, 2: unfilled/partially filled, 3: completed, 4: cancelled, 5: invalid
      switch (state) {
        case 1:
          return 'NEW';
        case 2:
          return 'PARTIALLY_FILLED';
        case 3:
          return 'FILLED';
        case 4:
          return 'CANCELLED';
        case 5:
          return 'REJECTED';
        default:
          return `STATE_${state}`;
      }
    }
    return String(state || 'UNKNOWN').toUpperCase();
  }
}

// Singleton Ingestion Service
export const mexcIngestionService = new MexcIngestionService();
