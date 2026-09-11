import { Decimal } from 'decimal.js';
import {
  AccountType,
  MarketCategory,
  Direction,
  TradeStatus,
  FillRole,
  EventImportance,
  NoTradeWindowStatus,
  ViolationType,
  PatternType,
  SyncType,
  SyncStatus,
  UserRecord,
  ExchangeRecord,
  TradingAccountRecord,
  RawExchangeOrderRecord,
  RawExchangeFillRecord,
  FundingTransactionRecord,
  BalanceTransactionRecord,
  TradeRecord,
  TradeFillRecord,
  StrategyRecord,
  TradeSetupRecord,
  TradeJournalEntryRecord,
  EquitySnapshotRecord,
  DailyPerformanceRecord,
  EconomicEventRecord,
  EconomicEventRuleRecord,
  NoTradeWindowRecord,
  TradeRuleViolationRecord,
  DetectedPatternRecord,
  SyncJobRecord,
  MarketCandleRecord,
  MarketStructurePointRecord,
} from './types';

export class TradeMateDatabase {
  public users = new Map<string, UserRecord>();
  public exchanges = new Map<string, ExchangeRecord>();
  public tradingAccounts = new Map<string, TradingAccountRecord>();
  public rawExchangeOrders = new Map<string, RawExchangeOrderRecord>();
  public rawExchangeFills = new Map<string, RawExchangeFillRecord>();
  public fundingTransactions = new Map<string, FundingTransactionRecord>();
  public balanceTransactions = new Map<string, BalanceTransactionRecord>();
  public strategies = new Map<string, StrategyRecord>();
  public tradeSetups = new Map<string, TradeSetupRecord>();
  public trades = new Map<string, TradeRecord>();
  public tradeFills = new Map<string, TradeFillRecord>();
  public tradeJournalEntries = new Map<string, TradeJournalEntryRecord>();
  public equitySnapshots = new Map<string, EquitySnapshotRecord>();
  public dailyPerformances = new Map<string, DailyPerformanceRecord>();
  public economicEvents = new Map<string, EconomicEventRecord>();
  public economicEventRules = new Map<string, EconomicEventRuleRecord>();
  public noTradeWindows = new Map<string, NoTradeWindowRecord>();
  public tradeRuleViolations = new Map<string, TradeRuleViolationRecord>();
  public detectedPatterns = new Map<string, DetectedPatternRecord>();
  public syncJobs = new Map<string, SyncJobRecord>();
  public marketCandles = new Map<string, MarketCandleRecord>();
  public marketStructurePoints = new Map<string, MarketStructurePointRecord>();
  public structureAuditLabels = new Map<string, any>();

  private isSeeded = false;

  constructor() {
    this.seed();
  }

  // ---------------------------------------------------------
  // IMMUTABLE INSERTION GUARDS & REPOSITORY METHODS
  // ---------------------------------------------------------

  public insertRawOrder(order: RawExchangeOrderRecord): void {
    const key = `${order.tradingAccountId}:${order.exchangeOrderId}`;
    if (this.rawExchangeOrders.has(key)) {
      // Raw exchange orders are immutable historical evidence
      return;
    }
    this.rawExchangeOrders.set(key, order);
  }

  public insertRawFill(fill: RawExchangeFillRecord): void {
    const key = `${fill.tradingAccountId}:${fill.exchangeFillId}`;
    if (this.rawExchangeFills.has(key)) {
      // Raw exchange fills are immutable historical evidence
      return;
    }
    this.rawExchangeFills.set(key, fill);
  }

  public insertTrade(trade: TradeRecord): void {
    this.trades.set(trade.id, trade);
  }

  public insertTradeFill(tradeFill: TradeFillRecord): void {
    this.tradeFills.set(tradeFill.id, tradeFill);
  }

  // ---------------------------------------------------------
  // SEED INITIALIZATION
  // ---------------------------------------------------------

  public seed(): void {
    if (this.isSeeded) return;
    this.isSeeded = true;

    // 1. User
    const userId = 'usr_trader_01';
    this.users.set(userId, {
      id: userId,
      name: 'Trader',
      email: 'trader@trademate.io',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // 2. Exchange
    const exchangeId = 'exch_mexc_01';
    this.exchanges.set(exchangeId, {
      id: exchangeId,
      name: 'MEXC Global',
      code: 'mexc',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    // 3. Trading Account
    const accountId = 'acc_mexc_futures_01';
    this.tradingAccounts.set(accountId, {
      id: accountId,
      userId,
      exchangeId,
      accountName: 'Personal MEXC',
      accountType: AccountType.FUTURES,
      baseCurrency: 'USDT',
      externalAccountId: 'mexc_sub_99214',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });

    // 4. Strategies
    const strategiesData = [
      { id: 'strat_crt', name: 'CRT', desc: 'Candle Range Theory high-timeframe context' },
      { id: 'strat_venom', name: 'Venom', desc: 'Momentum expansion and trend-continuation scalps' },
      { id: 'strat_smc', name: 'SMC', desc: 'Smart Money order blocks, fair value gaps & liquidity sweeps' },
      { id: 'strat_breakout', name: 'Breakout', desc: 'Key support/resistance volatility breakouts' },
      { id: 'strat_reversal', name: 'Reversal', desc: 'Failed auction exhaustion and mean reversion' },
    ];

    strategiesData.forEach((s) => {
      this.strategies.set(s.id, {
        id: s.id,
        userId,
        name: s.name,
        description: s.desc,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });

    // 5. Mock Setups
    const setupsData = [
      { id: 'setup_crt_h4', stratId: 'strat_crt', name: 'H4 Expansion' },
      { id: 'setup_venom_scalp', stratId: 'strat_venom', name: '15m Micro Sweep' },
      { id: 'setup_smc_ob', stratId: 'strat_smc', name: 'M15 Orderblock Mitigation' },
      { id: 'setup_bo_range', stratId: 'strat_breakout', name: 'Daily Range Breakout' },
      { id: 'setup_rev_exhaust', stratId: 'strat_reversal', name: 'Liquidity Grab Exhaustion' },
    ];

    setupsData.forEach((st) => {
      this.tradeSetups.set(st.id, {
        id: st.id,
        strategyId: st.stratId,
        name: st.name,
        description: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });

    // 6. Generate 50 closed trades across symbols
    const symbolsConfig: {
      symbol: string;
      category: MarketCategory;
      basePrice: number;
      qtyBase: number;
    }[] = [
      { symbol: 'BTCUSDT', category: MarketCategory.CRYPTO, basePrice: 63500, qtyBase: 0.15 },
      { symbol: 'ETHUSDT', category: MarketCategory.CRYPTO, basePrice: 3450, qtyBase: 2.5 },
      { symbol: 'XAUUSDT', category: MarketCategory.GOLD, basePrice: 2510, qtyBase: 5 },
      { symbol: 'XAGUSDT', category: MarketCategory.SILVER, basePrice: 28.5, qtyBase: 200 },
      { symbol: 'COPPERUSDT', category: MarketCategory.COPPER, basePrice: 4.15, qtyBase: 1500 },
    ];

    const sessions = ['London', 'New York', 'Asian'];
    const emotions = ['Disciplined', 'Patient', 'Focused', 'Confident'];

    // 50 realistic historical trade definitions over the last 30 days
    const now = new Date('2026-09-06T10:00:00.000Z').getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const startMs = now - thirtyDaysMs;

    // Seed 50 trades with predetermined win/loss pattern ensuring realistic total P&L (~$1,824.60 net in 30d)
    const outcomes: { isWin: boolean; r: number }[] = [
      { isWin: true, r: 2.1 },
      { isWin: true, r: 1.5 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 2.8 },
      { isWin: true, r: 1.2 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 1.9 },
      { isWin: false, r: -0.8 },
      { isWin: true, r: 3.1 },
      { isWin: true, r: 1.4 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 2.2 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 1.7 },
      { isWin: true, r: 2.0 },
      { isWin: false, r: -0.9 },
      { isWin: true, r: 1.8 },
      { isWin: true, r: 2.5 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 1.6 },
      { isWin: true, r: 2.4 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 1.3 },
      { isWin: false, r: -0.7 },
      { isWin: true, r: 2.9 },
      { isWin: true, r: 1.8 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 2.0 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 1.5 },
      { isWin: true, r: 2.2 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 1.6 },
      { isWin: true, r: 2.7 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 1.4 },
      { isWin: false, r: -0.8 },
      { isWin: true, r: 2.3 },
      { isWin: true, r: 1.9 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 1.7 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 2.1 },
      { isWin: true, r: 1.8 },
      { isWin: false, r: -0.9 },
      { isWin: true, r: 2.6 },
      { isWin: true, r: 1.5 },
      { isWin: false, r: -1.0 },
      { isWin: true, r: 2.4 },
      { isWin: true, r: 1.9 },
    ];

    outcomes.forEach((outcome, idx) => {
      const tradeNumber = idx + 1;
      const tradeId = `trd_2026_${String(tradeNumber).padStart(4, '0')}`;
      const symConfig = symbolsConfig[idx % symbolsConfig.length];
      const direction = idx % 3 === 0 ? Direction.SHORT : Direction.LONG;
      const strat = strategiesData[idx % strategiesData.length];
      const session = sessions[idx % sessions.length];

      // Time spread evenly across the last 30 days
      const tradeOpenMs = startMs + Math.floor((thirtyDaysMs / 50) * idx) + (idx * 3600000);
      const durationSeconds = 1800 + ((idx * 739) % 18000); // 30 mins to 5.5 hours
      const tradeCloseMs = tradeOpenMs + durationSeconds * 1000;

      const openIso = new Date(tradeOpenMs).toISOString();
      const closeIso = new Date(tradeCloseMs).toISOString();

      const priceVariation = 1 + (((idx * 17) % 20) - 10) * 0.005;
      const entryPriceVal = symConfig.basePrice * priceVariation;
      const riskAmountVal = 100.0; // 1R = $100
      const netPnlVal = outcome.r * riskAmountVal;
      const feesVal = 3.5 + ((idx * 7) % 6);
      const fundingVal = ((idx % 4) === 0 ? 0.85 : 0.0);
      const grossPnlVal = netPnlVal + feesVal + fundingVal;

      // Price movement direction
      const priceDeltaPct = (grossPnlVal / (entryPriceVal * symConfig.qtyBase));
      const exitPriceVal = direction === Direction.LONG
        ? entryPriceVal * (1 + priceDeltaPct)
        : entryPriceVal * (1 - priceDeltaPct);

      const entryPrice = new Decimal(entryPriceVal.toFixed(symConfig.basePrice > 100 ? 2 : 4));
      const exitPrice = new Decimal(exitPriceVal.toFixed(symConfig.basePrice > 100 ? 2 : 4));
      const quantity = new Decimal(symConfig.qtyBase);
      const grossPnl = new Decimal(grossPnlVal.toFixed(2));
      const netPnl = new Decimal(netPnlVal.toFixed(2));
      const feesTotal = new Decimal(feesVal.toFixed(2));
      const fundingTotal = new Decimal(fundingVal.toFixed(2));
      const rMultiple = new Decimal(outcome.r.toFixed(2));
      const returnPercent = new Decimal((netPnlVal / 1000).toFixed(4)); // relative to margin

      // Processed Trade
      const tradeRecord: TradeRecord = {
        id: tradeId,
        tradingAccountId: accountId,
        symbol: symConfig.symbol,
        marketCategory: symConfig.category,
        direction,
        status: TradeStatus.CLOSED,
        openedAt: openIso,
        closedAt: closeIso,
        averageEntryPrice: entryPrice,
        averageExitPrice: exitPrice,
        entryQuantity: quantity,
        exitQuantity: quantity,
        grossPnl,
        netPnl,
        feesTotal,
        fundingTotal,
        returnPercent,
        riskAmount: new Decimal(riskAmountVal),
        riskPercent: new Decimal(0.01),
        rMultiple,
        leverage: 10,
        holdingSeconds: durationSeconds,
        strategyId: strat.id,
        setupId: setupsData[idx % setupsData.length].id,
        session,
        tradeNumberOfDay: (idx % 3) + 1,
        followedRules: true,
        emotion: emotions[idx % emotions.length],
        confidenceScore: 8 + (idx % 3),
        notes: `Execution of ${strat.name} during ${session} session. Clean execution.`,
        createdAt: openIso,
        updatedAt: closeIso,
      };

      this.trades.set(tradeId, tradeRecord);

      // Create matching immutable raw orders and fills
      const rawOrderIdEntry = `ord_entry_${tradeId}`;
      const rawOrderIdExit = `ord_exit_${tradeId}`;
      const rawFillIdEntry = `fill_entry_${tradeId}`;
      const rawFillIdExit = `fill_exit_${tradeId}`;

      // Raw Entry Order
      this.insertRawOrder({
        id: `row_${rawOrderIdEntry}`,
        tradingAccountId: accountId,
        exchangeOrderId: rawOrderIdEntry,
        symbol: symConfig.symbol,
        side: direction === Direction.LONG ? 'BUY' : 'SELL',
        orderType: 'LIMIT',
        status: 'FILLED',
        price: entryPrice,
        quantity,
        filledQuantity: quantity,
        averagePrice: entryPrice,
        reduceOnly: false,
        positionSide: direction === Direction.LONG ? 'LONG' : 'SHORT',
        leverage: 10,
        exchangeCreatedAt: openIso,
        exchangeUpdatedAt: openIso,
        rawPayload: { mexc_order_id: rawOrderIdEntry, origQty: quantity.toString() },
        syncedAt: openIso,
        createdAt: openIso,
      });

      // Raw Entry Fill (Immutable)
      this.insertRawFill({
        id: `rf_${rawFillIdEntry}`,
        tradingAccountId: accountId,
        exchangeFillId: rawFillIdEntry,
        exchangeOrderId: rawOrderIdEntry,
        symbol: symConfig.symbol,
        side: direction === Direction.LONG ? 'BUY' : 'SELL',
        price: entryPrice,
        quantity,
        quoteQuantity: entryPrice.mul(quantity),
        fee: feesTotal.div(2),
        feeCurrency: 'USDT',
        realizedPnl: new Decimal(0),
        positionSide: direction === Direction.LONG ? 'LONG' : 'SHORT',
        liquidityType: 'MAKER',
        exchangeTimestamp: openIso,
        rawPayload: { mexc_fill_id: rawFillIdEntry, role: 'ENTRY' },
        syncedAt: openIso,
        createdAt: openIso,
      });

      // TradeFill link (ENTRY)
      this.insertTradeFill({
        id: `tf_ent_${tradeId}`,
        tradeId,
        rawExchangeFillId: `rf_${rawFillIdEntry}`,
        fillRole: FillRole.ENTRY,
        quantityAllocated: quantity,
        createdAt: openIso,
      });

      // Raw Exit Order
      this.insertRawOrder({
        id: `row_${rawOrderIdExit}`,
        tradingAccountId: accountId,
        exchangeOrderId: rawOrderIdExit,
        symbol: symConfig.symbol,
        side: direction === Direction.LONG ? 'SELL' : 'BUY',
        orderType: 'LIMIT',
        status: 'FILLED',
        price: exitPrice,
        quantity,
        filledQuantity: quantity,
        averagePrice: exitPrice,
        reduceOnly: true,
        positionSide: direction === Direction.LONG ? 'LONG' : 'SHORT',
        leverage: 10,
        exchangeCreatedAt: closeIso,
        exchangeUpdatedAt: closeIso,
        rawPayload: { mexc_order_id: rawOrderIdExit, origQty: quantity.toString() },
        syncedAt: closeIso,
        createdAt: closeIso,
      });

      // Raw Exit Fill (Immutable)
      this.insertRawFill({
        id: `rf_${rawFillIdExit}`,
        tradingAccountId: accountId,
        exchangeFillId: rawFillIdExit,
        exchangeOrderId: rawOrderIdExit,
        symbol: symConfig.symbol,
        side: direction === Direction.LONG ? 'SELL' : 'BUY',
        price: exitPrice,
        quantity,
        quoteQuantity: exitPrice.mul(quantity),
        fee: feesTotal.div(2),
        feeCurrency: 'USDT',
        realizedPnl: netPnl,
        positionSide: direction === Direction.LONG ? 'LONG' : 'SHORT',
        liquidityType: 'TAKER',
        exchangeTimestamp: closeIso,
        rawPayload: { mexc_fill_id: rawFillIdExit, role: 'EXIT' },
        syncedAt: closeIso,
        createdAt: closeIso,
      });

      // TradeFill link (EXIT)
      this.insertTradeFill({
        id: `tf_ext_${tradeId}`,
        tradeId,
        rawExchangeFillId: `rf_${rawFillIdExit}`,
        fillRole: FillRole.EXIT,
        quantityAllocated: quantity,
        createdAt: closeIso,
      });

      // Trade Journal Entry
      this.tradeJournalEntries.set(`jnl_${tradeId}`, {
        id: `jnl_${tradeId}`,
        tradeId,
        preTradeNotes: `Planned setup aligned with ${strat.name}. Risk set to 1.0% ($100).`,
        postTradeNotes: outcome.isWin
          ? `Target hit as expected with clean follow-through.`
          : `Invalidation touched. Cut according to risk rules.`,
        entryReason: `M15 order flow alignment with higher timeframe structure.`,
        exitReason: outcome.isWin ? `Take-profit limit triggered.` : `Stop-loss triggered.`,
        mistakeCategory: outcome.isWin ? null : 'None - Normal Loss',
        emotionBefore: 'Disciplined',
        emotionAfter: outcome.isWin ? 'Satisfied' : 'Neutral',
        ruleFollowed: true,
        confidenceScore: 9,
        createdAt: closeIso,
        updatedAt: closeIso,
      });
    });

    // 7. Funding Transactions (Sample)
    const fundingSymbols = ['BTCUSDT', 'ETHUSDT', 'XAUUSDT'];
    for (let i = 0; i < 6; i++) {
      const fId = `fnd_${i + 1}`;
      const fTime = new Date(startMs + i * 5 * 24 * 3600000).toISOString();
      this.fundingTransactions.set(fId, {
        id: fId,
        tradingAccountId: accountId,
        externalId: `mexc_fnd_${1000 + i}`,
        symbol: fundingSymbols[i % fundingSymbols.length],
        amount: new Decimal((i % 2 === 0 ? -1.25 : -0.85)),
        currency: 'USDT',
        fundingRate: new Decimal(0.0001),
        exchangeTimestamp: fTime,
        rawPayload: { rate: '0.0001', period: '8h' },
        createdAt: fTime,
      });
    }

    // 8. Balance Transactions (Initial deposit + rebates)
    this.balanceTransactions.set('bal_dep_01', {
      id: 'bal_dep_01',
      tradingAccountId: accountId,
      externalId: 'dep_tx_001',
      transactionType: 'DEPOSIT',
      asset: 'USDT',
      amount: new Decimal(6500.0),
      exchangeTimestamp: '2026-01-01T00:00:00.000Z',
      rawPayload: { source: 'TRC20_WALLET', status: 'CONFIRMED' },
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    // 9. 30 Days of Equity Snapshots & Daily Performance
    let currentEquity = new Decimal(10862.85);
    const dayMs = 24 * 60 * 60 * 1000;

    for (let d = 0; d < 30; d++) {
      const dayTimestamp = startMs + d * dayMs;
      const dateStr = new Date(dayTimestamp).toISOString().split('T')[0];
      const dateIso = new Date(dayTimestamp).toISOString();

      // Predetermined daily net pnl curve to peak at $12,687.45
      const dayTradeCount = (d % 4 === 0) ? 0 : ((d % 3) + 1);
      const dayNetPnl = (d % 5 === 2)
        ? new Decimal(-65.40)
        : (d % 4 === 0)
        ? new Decimal(0)
        : new Decimal(82.50 + ((d * 11) % 45));

      const startEq = currentEquity;
      currentEquity = currentEquity.plus(dayNetPnl);

      // Equity Snapshot
      const snapId = `eq_snap_${d + 1}`;
      this.equitySnapshots.set(snapId, {
        id: snapId,
        tradingAccountId: accountId,
        timestamp: dateIso,
        equity: currentEquity,
        walletBalance: currentEquity,
        availableBalance: currentEquity.mul(0.85),
        unrealizedPnl: new Decimal(0),
        realizedPnlCumulative: currentEquity.minus(6500),
        source: 'CALCULATED',
        createdAt: dateIso,
      });

      // Daily Performance
      const wins = dayNetPnl.gt(0) ? dayTradeCount : 0;
      const losses = dayNetPnl.lt(0) ? dayTradeCount : 0;
      const winRate = dayTradeCount > 0 ? new Decimal((wins / dayTradeCount) * 100) : new Decimal(0);

      this.dailyPerformances.set(`${accountId}:${dateStr}`, {
        id: `dp_${d + 1}`,
        tradingAccountId: accountId,
        date: dateStr,
        startingEquity: startEq,
        endingEquity: currentEquity,
        grossPnl: dayNetPnl.plus(3.5 * dayTradeCount),
        netPnl: dayNetPnl,
        fees: new Decimal(3.5 * dayTradeCount),
        funding: new Decimal(0),
        returnPercent: startEq.gt(0) ? dayNetPnl.div(startEq).mul(100) : new Decimal(0),
        tradesCount: dayTradeCount,
        wins,
        losses,
        winRate,
        grossProfit: dayNetPnl.gt(0) ? dayNetPnl : new Decimal(0),
        grossLoss: dayNetPnl.lt(0) ? dayNetPnl.abs() : new Decimal(0),
        profitFactor: new Decimal(2.14),
        averageR: new Decimal(0.58),
        maxDrawdownPercent: new Decimal(6.21),
        createdAt: dateIso,
        updatedAt: dateIso,
      });
    }

    // 10. Economic Events & Rules
    const economicEventsData: Omit<EconomicEventRecord, 'id' | 'createdAt' | 'updatedAt'>[] = [
      {
        externalEventId: 'ff_us_cpi_01',
        source: 'FOREX_FACTORY',
        country: 'USD',
        currency: 'USD',
        eventName: 'Core CPI m/m',
        category: 'Inflation',
        importance: EventImportance.HIGH,
        scheduledAt: '2026-09-08T12:30:00.000Z',
        forecast: '0.3%',
        previous: '0.2%',
        unit: '%',
        rawPayload: { impact: 'High', consensus: '0.3%' },
      },
      {
        externalEventId: 'ff_us_cpi_02',
        source: 'FOREX_FACTORY',
        country: 'USD',
        currency: 'USD',
        eventName: 'CPI y/y',
        category: 'Inflation',
        importance: EventImportance.HIGH,
        scheduledAt: '2026-09-08T12:30:00.000Z',
        forecast: '2.9%',
        previous: '3.0%',
        unit: '%',
        rawPayload: { impact: 'High', consensus: '2.9%' },
      },
      {
        externalEventId: 'ff_us_nfp_01',
        source: 'FOREX_FACTORY',
        country: 'USD',
        currency: 'USD',
        eventName: 'Non-Farm Employment Change',
        category: 'Labor',
        importance: EventImportance.HIGH,
        scheduledAt: '2026-09-11T12:30:00.000Z',
        forecast: '165K',
        previous: '142K',
        unit: 'K',
        rawPayload: { impact: 'High', consensus: '165K' },
      },
      {
        externalEventId: 'ff_us_fomc_01',
        source: 'FOREX_FACTORY',
        country: 'USD',
        currency: 'USD',
        eventName: 'Federal Funds Rate / FOMC',
        category: 'Central Bank',
        importance: EventImportance.HIGH,
        scheduledAt: '2026-09-17T18:00:00.000Z',
        forecast: '5.25%',
        previous: '5.50%',
        unit: '%',
        rawPayload: { impact: 'High', consensus: '5.25%' },
      },
    ];

    economicEventsData.forEach((ev, i) => {
      const evId = `eco_ev_${i + 1}`;
      this.economicEvents.set(evId, {
        id: evId,
        ...ev,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      });
    });

    // 11. Economic Event Rules (No-Trade Windows)
    const mockRules = [
      { pattern: 'CPI', minutesBefore: 30, minutesAfter: 30 },
      { pattern: 'Non-Farm Payrolls', minutesBefore: 30, minutesAfter: 30 },
      { pattern: 'FOMC', minutesBefore: 30, minutesAfter: 30 },
    ];

    mockRules.forEach((rule, idx) => {
      const ruleId = `rule_${idx + 1}`;
      this.economicEventRules.set(ruleId, {
        id: ruleId,
        userId,
        eventNamePattern: rule.pattern,
        importanceFilter: EventImportance.HIGH,
        minutesBefore: rule.minutesBefore,
        minutesAfter: rule.minutesAfter,
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });

    // 12. No-Trade Windows linked to events
    let windowCounter = 1;
    this.economicEvents.forEach((ev) => {
      const eventTime = new Date(ev.scheduledAt).getTime();
      const startsAt = new Date(eventTime - 30 * 60 * 1000).toISOString();
      const endsAt = new Date(eventTime + 30 * 60 * 1000).toISOString();
      const winId = `ntw_${windowCounter++}`;
      this.noTradeWindows.set(winId, {
        id: winId,
        economicEventId: ev.id,
        ruleId: 'rule_1',
        startsAt,
        endsAt,
        status: NoTradeWindowStatus.UPCOMING,
        createdAt: '2026-09-01T00:00:00.000Z',
      });
    });

    // 13. Detected Patterns (Algorithmic Insights)
    const patternsData: Omit<DetectedPatternRecord, 'id' | 'detectedAt'>[] = [
      {
        tradingAccountId: accountId,
        patternType: PatternType.SESSION,
        title: 'New York Session Edge',
        description: 'New York session breakout executions outperform London session by 24% higher win rate with +0.72R average expectancy.',
        sampleSize: 28,
        winRate: new Decimal(71.4),
        expectancyR: new Decimal(0.72),
        profitFactor: new Decimal(2.68),
        netPnl: new Decimal(1420.50),
        confidenceScore: 9,
        isPositive: true,
      },
      {
        tradingAccountId: accountId,
        patternType: PatternType.STRATEGY,
        title: 'Venom Scalp Consistency',
        description: 'Venom strategy demonstrates lowest average drawdown (-1.8%) and highest trade profit factor across volatile sessions.',
        sampleSize: 16,
        winRate: new Decimal(68.8),
        expectancyR: new Decimal(0.64),
        profitFactor: new Decimal(2.95),
        netPnl: new Decimal(890.20),
        confidenceScore: 9,
        isPositive: true,
      },
      {
        tradingAccountId: accountId,
        patternType: PatternType.HOLDING_TIME,
        title: 'Holding Time Degradation',
        description: 'Trades held beyond 4 hours suffer a 42% decrease in expectancy, frequently turning winning positions into breakeven or stop-outs.',
        sampleSize: 12,
        winRate: new Decimal(33.3),
        expectancyR: new Decimal(-0.38),
        profitFactor: new Decimal(0.82),
        netPnl: new Decimal(-310.40),
        confidenceScore: 8,
        isPositive: false,
      },
      {
        tradingAccountId: accountId,
        patternType: PatternType.DAY_OF_WEEK,
        title: 'Wednesday & Thursday Outperformance',
        description: 'Mid-week expansion days produce 75% of cumulative monthly net gains, whereas Mondays show lower follow-through.',
        sampleSize: 34,
        winRate: new Decimal(73.5),
        expectancyR: new Decimal(0.81),
        profitFactor: new Decimal(3.10),
        netPnl: new Decimal(1380.00),
        confidenceScore: 9,
        isPositive: true,
      },
    ];

    patternsData.forEach((pat, idx) => {
      const patId = `pat_${idx + 1}`;
      this.detectedPatterns.set(patId, {
        id: patId,
        ...pat,
        detectedAt: '2026-09-06T08:00:00.000Z',
      });
    });

    // 14. Sync Jobs
    this.syncJobs.set('sync_job_01', {
      id: 'sync_job_01',
      tradingAccountId: accountId,
      syncType: SyncType.FULL_HISTORY,
      status: SyncStatus.COMPLETED,
      startedAt: '2026-09-06T09:30:00.000Z',
      completedAt: '2026-09-06T09:30:04.000Z',
      recordsReceived: 100,
      recordsInserted: 100,
      recordsSkipped: 0,
      errorMessage: null,
      metadata: { source: 'LOCAL_RECONSTRUCTION' },
      createdAt: '2026-09-06T09:30:00.000Z',
    });
  }
}

// Singleton database instance
export const db = new TradeMateDatabase();
