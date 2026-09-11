import { Decimal } from 'decimal.js';

// ---------------------------------------------------------
// ENUMS (matching Prisma schema)
// ---------------------------------------------------------

export enum AccountType {
  SPOT = 'SPOT',
  FUTURES = 'FUTURES',
  MARGIN = 'MARGIN',
}

export enum MarketCategory {
  CRYPTO = 'CRYPTO',
  GOLD = 'GOLD',
  SILVER = 'SILVER',
  COPPER = 'COPPER',
  OTHER = 'OTHER',
}

export enum Direction {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum TradeStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum FillRole {
  ENTRY = 'ENTRY',
  EXIT = 'EXIT',
  FEE = 'FEE',
  OTHER = 'OTHER',
}

export enum EventImportance {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum NoTradeWindowStatus {
  UPCOMING = 'UPCOMING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
}

export enum ViolationType {
  NEWS_BLACKOUT_ENTRY = 'NEWS_BLACKOUT_ENTRY',
  ENTERED_AFTER_MAX_DAILY_LOSSES = 'ENTERED_AFTER_MAX_DAILY_LOSSES',
  OVER_RISK_LIMIT = 'OVER_RISK_LIMIT',
  REVENGE_TRADING_DETECTED = 'REVENGE_TRADING_DETECTED',
  OTHER = 'OTHER',
}

export enum PeriodType {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
  ALL_TIME = 'ALL_TIME',
}

export enum PatternType {
  SESSION = 'SESSION',
  TIME_OF_DAY = 'TIME_OF_DAY',
  DAY_OF_WEEK = 'DAY_OF_WEEK',
  SYMBOL = 'SYMBOL',
  MARKET_CATEGORY = 'MARKET_CATEGORY',
  DIRECTION = 'DIRECTION',
  HOLDING_TIME = 'HOLDING_TIME',
  AFTER_LOSS = 'AFTER_LOSS',
  AFTER_WIN = 'AFTER_WIN',
  CONSECUTIVE_LOSS = 'CONSECUTIVE_LOSS',
  STRATEGY = 'STRATEGY',
  NEWS_EVENT = 'NEWS_EVENT',
  RISK_SIZE = 'RISK_SIZE',
}

export enum SyncType {
  ORDERS = 'ORDERS',
  FILLS = 'FILLS',
  BALANCES = 'BALANCES',
  FUNDING = 'FUNDING',
  FULL_HISTORY = 'FULL_HISTORY',
}

export enum SyncStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum AttachmentType {
  PRE_TRADE_SCREENSHOT = 'PRE_TRADE_SCREENSHOT',
  POST_TRADE_SCREENSHOT = 'POST_TRADE_SCREENSHOT',
  OTHER = 'OTHER',
}

// ---------------------------------------------------------
// RELATIONAL MODEL INTERFACES
// ---------------------------------------------------------

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  createdAt: string; // ISO 8601 UTC
  updatedAt: string;
}

export interface ExchangeRecord {
  id: string;
  name: string;
  code: string;
  createdAt: string;
}

export interface TradingAccountRecord {
  id: string;
  userId: string;
  exchangeId: string;
  accountName: string;
  accountType: AccountType;
  baseCurrency: string;
  externalAccountId?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RawExchangeOrderRecord {
  id: string;
  tradingAccountId: string;
  exchangeOrderId: string;
  symbol: string;
  side: string;
  orderType: string;
  status: string;
  price: Decimal;
  quantity: Decimal;
  filledQuantity: Decimal;
  averagePrice?: Decimal | null;
  reduceOnly: boolean;
  positionSide?: string | null;
  leverage?: number | null;
  exchangeCreatedAt: string;
  exchangeUpdatedAt?: string | null;
  rawPayload: Record<string, unknown>;
  syncedAt: string;
  createdAt: string;
}

export interface RawExchangeFillRecord {
  id: string;
  tradingAccountId: string;
  exchangeFillId: string;
  exchangeOrderId?: string | null;
  symbol: string;
  side: string;
  price: Decimal;
  quantity: Decimal;
  quoteQuantity?: Decimal | null;
  fee: Decimal;
  feeCurrency?: string | null;
  realizedPnl?: Decimal | null;
  positionSide?: string | null;
  liquidityType?: string | null;
  exchangeTimestamp: string;
  rawPayload: Record<string, unknown>;
  syncedAt: string;
  createdAt: string;
}

export interface FundingTransactionRecord {
  id: string;
  tradingAccountId: string;
  externalId?: string | null;
  symbol: string;
  amount: Decimal;
  currency: string;
  fundingRate?: Decimal | null;
  exchangeTimestamp: string;
  rawPayload: Record<string, unknown>;
  createdAt: string;
}

export interface BalanceTransactionRecord {
  id: string;
  tradingAccountId: string;
  externalId?: string | null;
  transactionType: string;
  asset: string;
  amount: Decimal;
  exchangeTimestamp: string;
  rawPayload: Record<string, unknown>;
  createdAt: string;
}

export interface TradeRecord {
  id: string;
  tradingAccountId: string;
  symbol: string;
  marketCategory: MarketCategory;
  direction: Direction;
  status: TradeStatus;
  openedAt: string;
  closedAt?: string | null;
  averageEntryPrice: Decimal;
  averageExitPrice?: Decimal | null;
  entryQuantity: Decimal;
  exitQuantity?: Decimal | null;
  grossPnl?: Decimal | null;
  netPnl?: Decimal | null;
  feesTotal: Decimal;
  fundingTotal: Decimal;
  returnPercent?: Decimal | null;
  riskAmount?: Decimal | null;
  riskPercent?: Decimal | null;
  rMultiple?: Decimal | null;
  leverage?: number | null;
  holdingSeconds?: number | null;
  strategyId?: string | null;
  setupId?: string | null;
  session?: string | null;
  tradeNumberOfDay?: number | null;
  followedRules?: boolean | null;
  emotion?: string | null;
  confidenceScore?: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradeFillRecord {
  id: string;
  tradeId: string;
  rawExchangeFillId: string;
  fillRole: FillRole;
  quantityAllocated: Decimal;
  createdAt: string;
}

export interface StrategyRecord {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TradeSetupRecord {
  id: string;
  strategyId?: string | null;
  name: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradeJournalEntryRecord {
  id: string;
  tradeId: string;
  preTradeNotes?: string | null;
  postTradeNotes?: string | null;
  entryReason?: string | null;
  exitReason?: string | null;
  mistakeCategory?: string | null;
  emotionBefore?: string | null;
  emotionAfter?: string | null;
  ruleFollowed?: boolean | null;
  confidenceScore?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradeAttachmentRecord {
  id: string;
  tradeId: string;
  attachmentType: AttachmentType;
  fileUrl: string;
  caption?: string | null;
  createdAt: string;
}

export interface EquitySnapshotRecord {
  id: string;
  tradingAccountId: string;
  timestamp: string;
  equity: Decimal;
  walletBalance?: Decimal | null;
  availableBalance?: Decimal | null;
  unrealizedPnl?: Decimal | null;
  realizedPnlCumulative?: Decimal | null;
  source: string;
  createdAt: string;
}

export interface DailyPerformanceRecord {
  id: string;
  tradingAccountId: string;
  date: string; // YYYY-MM-DD
  startingEquity: Decimal;
  endingEquity: Decimal;
  grossPnl: Decimal;
  netPnl: Decimal;
  fees: Decimal;
  funding: Decimal;
  returnPercent: Decimal;
  tradesCount: number;
  wins: number;
  losses: number;
  winRate: Decimal;
  grossProfit: Decimal;
  grossLoss: Decimal;
  profitFactor?: Decimal | null;
  averageR?: Decimal | null;
  maxDrawdownPercent?: Decimal | null;
  createdAt: string;
  updatedAt: string;
}

export interface EconomicEventRecord {
  id: string;
  externalEventId?: string | null;
  source: string;
  country: string;
  currency?: string | null;
  eventName: string;
  category?: string | null;
  importance: EventImportance;
  scheduledAt: string;
  actual?: string | null;
  forecast?: string | null;
  previous?: string | null;
  unit?: string | null;
  rawPayload?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface EconomicEventRuleRecord {
  id: string;
  userId: string;
  eventNamePattern: string;
  importanceFilter?: EventImportance | null;
  minutesBefore: number;
  minutesAfter: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NoTradeWindowRecord {
  id: string;
  economicEventId: string;
  ruleId: string;
  startsAt: string;
  endsAt: string;
  status: NoTradeWindowStatus;
  createdAt: string;
}

export interface TradeRuleViolationRecord {
  id: string;
  tradeId: string;
  violationType: ViolationType;
  economicEventId?: string | null;
  description: string;
  severity: string;
  detectedAt: string;
  createdAt: string;
}

export interface AnalyticsSnapshotRecord {
  id: string;
  tradingAccountId: string;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  metrics: Record<string, unknown>;
  calculatedAt: string;
}

export interface DetectedPatternRecord {
  id: string;
  tradingAccountId: string;
  patternType: PatternType;
  title: string;
  description: string;
  sampleSize: number;
  winRate?: Decimal | null;
  expectancyR?: Decimal | null;
  profitFactor?: Decimal | null;
  netPnl?: Decimal | null;
  confidenceScore?: number | null;
  isPositive: boolean;
  periodStart?: string | null;
  periodEnd?: string | null;
  metadata?: Record<string, unknown> | null;
  detectedAt: string;
}

export interface SyncJobRecord {
  id: string;
  tradingAccountId: string;
  syncType: SyncType;
  status: SyncStatus;
  startedAt: string;
  completedAt?: string | null;
  recordsReceived: number;
  recordsInserted: number;
  recordsSkipped: number;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ImportBatchRecord {
  id: string;
  tradingAccountId: string;
  source: string;
  fileName?: string | null;
  status: SyncStatus;
  recordsTotal: number;
  recordsSuccess: number;
  recordsFailed: number;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------
// PUBLIC MARKET CANDLES & MARKET STRUCTURE MODELS
// ---------------------------------------------------------

export enum StructurePointType {
  SWING_HIGH = 'SWING_HIGH',
  SWING_LOW = 'SWING_LOW',
}

export enum StructureStrength {
  MINOR = 'MINOR',
  INTERMEDIATE = 'INTERMEDIATE',
  MAJOR = 'MAJOR',
}

export interface MarketCandleRecord {
  id: string;
  symbol: string;
  timeframe: string; // '5M'
  openTime: string; // ISO 8601 UTC
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
  volume?: Decimal | null;
  amount?: Decimal | null;
  isClosed: boolean;
  source: string; // 'MEXC_PUBLIC'
  createdAt: string;
  updatedAt: string;
}

export interface MarketStructurePointRecord {
  id: string;
  symbol: string;
  timeframe: string;
  candleOpenTime: string; // ISO 8601 UTC
  type: StructurePointType;
  price: Decimal;
  strength?: StructureStrength | null;
  leftBars: number;
  rightBars: number;
  algorithmVersion: string; // e.g. 'STRUCTURE_V1'
  parameters?: Record<string, unknown> | null;
  detectedAt: string;
  createdAt: string;
}
