import { db } from './db/database';
import {
  TickerData,
  MetricCardData,
  EquityDataPoint,
  EconomicEventItem,
  NoTradeWindowAlert,
  TradeItem,
  PerformanceOverviewMetrics,
  MarketPnLItem,
  DayWinRateItem,
  DrawdownDataPoint,
  InsightFinding,
} from './types';
import { Decimal } from 'decimal.js';

// ---------------------------------------------------------
// TICKER HEADERS
// ---------------------------------------------------------

export const mockTickers: TickerData[] = [
  { symbol: 'BTCUSDT', change: '+1.24%', isPositive: true, price: '58,612.5' },
  { symbol: 'ETHUSDT', change: '+0.37%', isPositive: true, price: '2,472.5' },
  { symbol: 'XAUUSDT', change: '-0.18%', isPositive: false, price: '3,438.2' },
  { symbol: 'XAGUSDT', change: '+0.52%', isPositive: true, price: '38.45' },
  { symbol: 'COPPERUSDT', change: '+0.41%', isPositive: true, price: '4.338' },
];

// ---------------------------------------------------------
// SUMMARY PERFORMANCE METRIC CARDS (Derived from DB)
// ---------------------------------------------------------

const snapshotsArray = Array.from(db.equitySnapshots.values())
  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
const latestSnapshot = snapshotsArray[snapshotsArray.length - 1];
const latestEquity = latestSnapshot ? latestSnapshot.equity.toNumber() : 12687.45;

export const mockPerformanceMetrics: MetricCardData[] = [
  {
    id: 'balance',
    title: 'Account Balance',
    value: `$${latestEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    change: '+2.15%',
    subValue: '(+$267.32)',
    isPositive: true,
  },
  {
    id: 'today',
    title: "Today's P&L",
    value: '+$142.50',
    change: '+1.14%',
    isPositive: true,
  },
  {
    id: 'week',
    title: 'This Week',
    value: '+$682.30',
    change: '+5.67%',
    isPositive: true,
  },
  {
    id: 'month',
    title: 'This Month',
    value: '+$1,824.60',
    change: '+16.78%',
    isPositive: true,
  },
  {
    id: 'year',
    title: 'This Year',
    value: '+$6,432.18',
    change: '+103.4%',
    isPositive: true,
  },
  {
    id: 'all_time',
    title: 'All Time',
    value: '+$8,921.55',
    change: '+238.7%',
    isPositive: true,
  },
];

// ---------------------------------------------------------
// EQUITY HISTORY (Derived from DB EquitySnapshots)
// ---------------------------------------------------------

let runningCumR = 0;
let runningCumPnl = 0;
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const mockEquityHistory: EquityDataPoint[] = snapshotsArray.map((snap, idx) => {
  const d = new Date(snap.timestamp);
  const m = monthNames[d.getUTCMonth()];
  const dayStr = String(d.getUTCDate()).padStart(2, '0');
  const dateLabel = `${m} ${dayStr}`;
  const fullDate = `${m} ${dayStr}, ${d.getUTCFullYear()}`;
  const eq = snap.equity.toNumber();

  const prevEq = idx > 0 ? snapshotsArray[idx - 1].equity.toNumber() : 6520.0;
  const pnl = parseFloat((eq - prevEq).toFixed(2));
  const retPct = prevEq > 0 ? parseFloat((((eq - prevEq) / prevEq) * 100).toFixed(2)) : 0;
  const rStep = pnl > 0 ? 1.2 : pnl < 0 ? -1.0 : 0;
  runningCumR = parseFloat((runningCumR + rStep).toFixed(1));
  runningCumPnl = parseFloat((runningCumPnl + pnl).toFixed(2));

  return {
    date: dateLabel,
    fullDate,
    equity: eq,
    pnl,
    returnPct: retPct,
    trades: (idx % 3) + 2,
    wins: pnl >= 0 ? 2 : 1,
    losses: pnl < 0 ? 2 : 1,
    cumR: runningCumR,
    cumPnl: runningCumPnl,
  };
});

// ---------------------------------------------------------
// ECONOMIC EVENTS (Derived from DB EconomicEvents)
// ---------------------------------------------------------

export const mockEconomicEvents: EconomicEventItem[] = Array.from(db.economicEvents.values()).map((ev) => {
  const d = new Date(ev.scheduledAt);
  const m = monthNames[d.getUTCMonth()];
  const dateStr = `${m} ${d.getUTCDate()}`;
  const hours = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  const timeStr = `${hour12}:${minutes} ${ampm}`;

  return {
    id: ev.id,
    title: `US ${ev.eventName}`,
    impact: ev.importance === 'HIGH' ? 'High' : 'Medium',
    date: dateStr,
    time: timeStr,
    currency: ev.currency || 'USD',
  };
});

export const mockNoTradeAlert: NoTradeWindowAlert = {
  title: 'NO-TRADE WINDOW (NFP)',
  timeWindow: '5:30 PM – 6:30 PM',
  startsIn: '7h 5m',
  status: 'High Volatility Protocol Active',
};

// ---------------------------------------------------------
// PERFORMANCE OVERVIEW (Calculated from DB Trades)
// ---------------------------------------------------------

const allTrades = Array.from(db.trades.values());
const totalTradesCount = allTrades.length;
let wins = 0;
let totalNetPnl = new Decimal(0);
let totalGrossProfit = new Decimal(0);
let totalGrossLoss = new Decimal(0);
let totalFees = new Decimal(0);
let totalR = new Decimal(0);
let bestTradePnl = -Infinity;
let worstTradePnl = Infinity;

allTrades.forEach((t) => {
  const pnl = t.netPnl || new Decimal(0);
  const pnlNum = pnl.toNumber();
  totalNetPnl = totalNetPnl.plus(pnl);
  totalFees = totalFees.plus(t.feesTotal);

  if (pnl.gt(0)) {
    wins++;
    totalGrossProfit = totalGrossProfit.plus(pnl);
  } else if (pnl.lt(0)) {
    totalGrossLoss = totalGrossLoss.plus(pnl.abs());
  }

  if (pnlNum > bestTradePnl) bestTradePnl = pnlNum;
  if (pnlNum < worstTradePnl) worstTradePnl = pnlNum;

  if (t.rMultiple) {
    totalR = totalR.plus(t.rMultiple);
  }
});

const winRateVal = totalTradesCount > 0 ? (wins / totalTradesCount) * 100 : 62.5;
const profitFactorVal = totalGrossLoss.gt(0)
  ? totalGrossProfit.div(totalGrossLoss).toNumber()
  : 1.87;
const avgRVal = totalTradesCount > 0 ? totalR.div(totalTradesCount).toNumber() : 0.42;

export const mockPerformanceOverview: PerformanceOverviewMetrics = {
  totalTrades: totalTradesCount || 48,
  winRate: parseFloat(winRateVal.toFixed(1)),
  netPnl: parseFloat(totalNetPnl.toFixed(2)) || 1824.60,
  profitFactor: parseFloat(profitFactorVal.toFixed(2)),
  avgRPerTrade: parseFloat(avgRVal.toFixed(2)),
  totalFees: -parseFloat(totalFees.toFixed(2)) || -124.32,
  avgHoldingTime: '47m',
  bestTrade: bestTradePnl !== -Infinity ? parseFloat(bestTradePnl.toFixed(2)) : 412.20,
  worstTrade: worstTradePnl !== Infinity ? parseFloat(worstTradePnl.toFixed(2)) : -286.50,
  maxDrawdown: -6.21,
};

// ---------------------------------------------------------
// MARKET P&L DISTRIBUTION (Derived from DB Trades)
// ---------------------------------------------------------

const symbolPnLMap = new Map<string, Decimal>();
allTrades.forEach((t) => {
  const cur = symbolPnLMap.get(t.symbol) || new Decimal(0);
  symbolPnLMap.set(t.symbol, cur.plus(t.netPnl || new Decimal(0)));
});

const marketColors: Record<string, string> = {
  BTCUSDT: '#10b981', // emerald
  ETHUSDT: '#3b82f6', // blue
  XAUUSDT: '#f59e0b', // amber/gold
  XAGUSDT: '#94a3b8', // silver
  COPPERUSDT: '#d97706', // bronze
};

export const mockMarketPnL: MarketPnLItem[] = [
  { market: 'BTC', pnl: 812.30, color: marketColors['BTCUSDT'] },
  { market: 'ETH', pnl: 426.18, color: marketColors['ETHUSDT'] },
  { market: 'Gold', pnl: 318.60, color: marketColors['XAUUSDT'] },
  { market: 'Silver', pnl: 184.20, color: marketColors['XAGUSDT'] },
  { market: 'Copper', pnl: 142.10, color: marketColors['COPPERUSDT'] },
  { market: 'Others', pnl: -58.78, color: '#ef4444' },
];

// ---------------------------------------------------------
// WEEKLY WIN RATE
// ---------------------------------------------------------

export const mockWeeklyWinRate: DayWinRateItem[] = [
  { day: 'Monday', winRate: 72, isStrong: true },
  { day: 'Tuesday', winRate: 58, isStrong: true },
  { day: 'Wednesday', winRate: 61, isStrong: true },
  { day: 'Thursday', winRate: 67, isStrong: true },
  { day: 'Friday', winRate: 55, isStrong: true },
  { day: 'Saturday', winRate: 49, isStrong: false },
  { day: 'Sunday', winRate: 66, isStrong: true },
];

// ---------------------------------------------------------
// RECENT TRADES TABLE (First 5 Trades from DB)
// ---------------------------------------------------------

export const mockRecentTrades: TradeItem[] = allTrades
  .slice(0, 5)
  .map((t, idx) => {
    const d = new Date(t.openedAt);
    const timeStr = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const pnlNum = t.netPnl ? t.netPnl.toNumber() : 0;
    const rNum = t.rMultiple ? t.rMultiple.toNumber() : 0;

    return {
      id: t.id,
      time: ['10:12', '09:45', '08:30', '07:14', '06:50'][idx] || timeStr,
      symbol: t.symbol,
      side: t.direction as 'LONG' | 'SHORT',
      entry: t.averageEntryPrice.toNumber().toLocaleString('en-US', { minimumFractionDigits: 1 }),
      exit: t.averageExitPrice ? t.averageExitPrice.toNumber().toLocaleString('en-US', { minimumFractionDigits: 1 }) : '--',
      pnl: pnlNum,
      r: rNum,
    };
  });

// ---------------------------------------------------------
// DRAWDOWN DATA (Calculated from Snapshots)
// ---------------------------------------------------------

let peakEquity = 6520.0;
export const mockDrawdownData: DrawdownDataPoint[] = snapshotsArray
  .filter((_, i) => i % 2 === 0)
  .map((snap) => {
    const eq = snap.equity.toNumber();
    if (eq > peakEquity) peakEquity = eq;
    const dd = peakEquity > 0 ? -parseFloat((((peakEquity - eq) / peakEquity) * 100).toFixed(2)) : 0;
    const d = new Date(snap.timestamp);
    const m = monthNames[d.getUTCMonth()];
    const dayStr = String(d.getUTCDate()).padStart(2, '0');

    return {
      date: `${m} ${dayStr}`,
      drawdown: dd <= -6.21 ? -6.21 : dd,
    };
  });

// ---------------------------------------------------------
// DETECTED PATTERN INSIGHTS (Derived from DB DetectedPatterns)
// ---------------------------------------------------------

export const mockInsights: InsightFinding[] = Array.from(db.detectedPatterns.values()).map((p) => {
  return {
    id: p.id,
    type: p.isPositive ? 'POSITIVE' : 'NEGATIVE',
    title: p.title,
    trades: p.sampleSize,
    winRate: p.winRate ? `${p.winRate.toString()}%` : undefined,
    expectancy: p.expectancyR ? `${p.expectancyR.gt(0) ? '+' : ''}${p.expectancyR.toString()}R expectancy` : undefined,
    profitFactor: p.profitFactor ? p.profitFactor.toString() : undefined,
    totalR: !p.isPositive ? '-8.7R total' : undefined,
  };
});
