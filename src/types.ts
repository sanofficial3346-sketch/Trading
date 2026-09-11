export type PageId =
  | 'dashboard'
  | 'equity'
  | 'trades'
  | 'analytics'
  | 'insights'
  | 'strategies'
  | 'setup-lab'
  | 'economic-calendar'
  | 'risk-management'
  | 'settings';

export type PeriodFilter = '1D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';

export type EquityTabType = 'Equity' | 'Cumulative P&L' | 'Cumulative R';

export interface TickerData {
  symbol: string;
  change: string;
  isPositive: boolean;
  price?: string;
}

export interface MetricCardData {
  id: string;
  title: string;
  value: string;
  change: string;
  subValue?: string;
  isPositive: boolean;
}

export interface EquityDataPoint {
  date: string;
  fullDate: string;
  equity: number;
  pnl: number;
  returnPct: number;
  trades: number;
  wins: number;
  losses: number;
  cumR: number;
  cumPnl: number;
}

export interface EconomicEventItem {
  id: string;
  title: string;
  impact: 'High' | 'Medium' | 'Low';
  date: string;
  time: string;
  currency?: string;
}

export interface NoTradeWindowAlert {
  title: string;
  timeWindow: string;
  startsIn: string;
  status: string;
}

export interface TradeItem {
  id: string;
  time: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entry: number | string;
  exit: number | string;
  pnl: number;
  r: number;
}

export interface PerformanceOverviewMetrics {
  totalTrades: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  avgRPerTrade: number;
  totalFees: number;
  avgHoldingTime: string;
  bestTrade: number;
  worstTrade: number;
  maxDrawdown: number;
}

export interface MarketPnLItem {
  market: string;
  pnl: number;
  color: string;
}

export interface DayWinRateItem {
  day: string;
  winRate: number;
  isStrong: boolean;
}

export interface DrawdownDataPoint {
  date: string;
  drawdown: number; // e.g. -2.15, -6.21
}

export interface InsightFinding {
  id: string;
  type: 'POSITIVE' | 'NEGATIVE';
  title: string;
  trades: number;
  winRate?: string;
  expectancy?: string;
  profitFactor?: string;
  totalR?: string;
}
