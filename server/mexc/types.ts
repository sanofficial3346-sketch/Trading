/**
 * MEXC Futures API Integration Types & Error Enums
 * TradeMate Institutional Trading Analytics Engine
 */

export enum MexcErrorCode {
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  INVALID_API_KEY = 'INVALID_API_KEY',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  CLOCK_SKEW = 'CLOCK_SKEW',
  RATE_LIMITED = 'RATE_LIMITED',
  MEXC_UNAVAILABLE = 'MEXC_UNAVAILABLE',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  DATABASE_ERROR = 'DATABASE_ERROR',
}

export enum MexcConnectionStatus {
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  SYNCING = 'SYNCING',
  RATE_LIMITED = 'RATE_LIMITED',
  ERROR = 'ERROR',
}

export interface MexcApiResponse<T = unknown> {
  success?: boolean;
  code: number;
  data: T;
  message?: string;
}

export interface MexcAssetRaw {
  currency: string;
  positionMargin: number | string;
  availableBalance: number | string;
  cashBalance: number | string;
  frozenBalance: number | string;
  equity: number | string;
  unrealized: number | string;
  bonus?: number | string;
}

export interface MexcHistoryOrderRaw {
  orderId: string;
  symbol: string;
  side: number; // 1: open long, 2: close short, 3: open short, 4: close long
  orderType: number | string;
  price: number | string;
  vol: number | string;
  dealAvgPrice: number | string;
  dealVol: number | string;
  state: number; // 1: init, 2: unfilled/partially filled, 3: completed, 4: cancelled, 5: invalid
  createTime: number;
  updateTime?: number;
  leverage?: number;
  positionType?: number;
  reduceOnly?: boolean;
  [key: string]: unknown;
}

export interface MexcOrderDealRaw {
  id: string | number;
  symbol: string;
  orderId?: string;
  side?: number | string;
  price: number | string;
  vol: number | string;
  amount?: number | string;
  fee: number | string;
  feeCurrency?: string;
  profit?: number | string;
  timestamp: number;
  taker?: boolean;
  [key: string]: unknown;
}

export interface MexcFundingRecordRaw {
  id?: string | number;
  symbol: string;
  positionType?: number;
  fundingRate?: number | string;
  amount: number | string;
  currency?: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface MexcPositionRaw {
  positionId?: string | number;
  symbol: string;
  holdVol: number | string;
  positionType: number; // 1: long, 2: short
  openAvgPrice: number | string;
  closeAvgPrice?: number | string;
  liquidatePrice?: number | string;
  oim?: number | string;
  im?: number | string;
  holdFee?: number | string;
  realised?: number | string;
  unrealised?: number | string;
  leverage?: number;
  createTime?: number;
  updateTime?: number;
  state?: number;
  [key: string]: unknown;
}

export interface NormalizedMexcBalance {
  totalEquity: string;
  walletBalance: string;
  availableBalance: string;
  unrealizedPnl: string;
  currency: string;
  timestamp: string;
}

export interface TestConnectionResult {
  success: boolean;
  status: MexcConnectionStatus;
  accountDetected: boolean;
  timestamp: string;
  serverTime: number;
  timeOffsetMs: number;
  message: string;
  readOnlyPermissionsVerified: boolean;
  assetsSample?: Array<{
    currency: string;
    equity: string;
    available: string;
    unrealized: string;
  }>;
}

export interface MexcSyncResult {
  jobId: string;
  syncType: string;
  status: 'COMPLETED' | 'FAILED';
  recordsReceived: number;
  recordsInserted: number;
  recordsSkipped: number;
  errorMessage?: string | null;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  details?: {
    orders: { received: number; inserted: number; skipped: number };
    fills: { received: number; inserted: number; skipped: number };
    funding: { received: number; inserted: number; skipped: number };
    balances: { updated: boolean; equity?: string };
  };
}

export interface MexcIntegrationStatus {
  status: MexcConnectionStatus;
  apiKeyConfigured: boolean;
  secretKeyConfigured: boolean;
  maskedAccessKey?: string | null;
  lastSuccessfulSync?: string | null;
  lastFailedSync?: string | null;
  lastError?: string | null;
  persistentDbConnected: boolean;
  activeAccountName: string;
  exchange: string;
  mode: 'READ_ONLY_STRICT' | 'MOCK_MODE_IN_MEMORY' | 'NOT_CONFIGURED';
  rawSummary: {
    ordersCount: number;
    fillsCount: number;
    fundingCount: number;
    snapshotsCount: number;
  };
}
