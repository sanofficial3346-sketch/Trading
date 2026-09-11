# TradeMate Database Architecture & Data Modeling Specification (Step 2)

TradeMate is a personal trading analytics platform engineered around an institutional-grade relational schema. This document specifies the architectural foundation established in **Step 2**, separating raw exchange audit trails from derived analytics models, detailing reconstruction pipelines, idempotency guarantees, and preparation for live MEXC integration.

---

## 1. Core Architectural Principle: Raw vs. Processed Data Separation

Exchange APIs are untrusted external data sources prone to API rate limits, schema evolutions, and partial order fills. TradeMate enforces strict isolation:

```
┌────────────────────────────────────────────────────────┐
│                   MEXC Global / APIs                   │
└───────────────────────────┬────────────────────────────┘
                            │ (Raw Payloads & Webhooks)
                            ▼
┌────────────────────────────────────────────────────────┐
│               IMMUTABLE RAW EXCHANGE LAYER             │
│  - raw_exchange_orders                                 │
│  - raw_exchange_fills                                  │
│  - funding_transactions                                │
│  - balance_transactions                                │
└───────────────────────────┬────────────────────────────┘
                            │ (Reconstruction & Normalization Engine)
                            ▼
┌────────────────────────────────────────────────────────┐
│            PROCESSED TRADEMATE DOMAIN LAYER            │
│  - trades (reconstructed lifecycle)                   │
│  - trade_fills (allocation mapping with FillRole)      │
│  - strategies & trade_setups                           │
│  - trade_journal_entries & trade_attachments           │
└───────────────────────────┬────────────────────────────┘
                            │ (Time-Series & Analytics Crunching)
                            ▼
┌────────────────────────────────────────────────────────┐
│            ANALYTICS & COMPLIANCE DATA LAYER           │
│  - equity_snapshots (mark-to-market curve)             │
│  - daily_performance (aggregated daily metrics)        │
│  - economic_events & no_trade_windows                  │
│  - trade_rule_violations & detected_patterns           │
└────────────────────────────────────────────────────────┘
```

### Why Raw Data Remains Immutable
1. **Auditing & Reconciliation**: If a trade reconstruction bug is found or a user retroactively changes their position classification rules, raw fills and order responses are never altered. Trades can be recomputed deterministically from the raw logs without re-querying the exchange.
2. **Multi-Leg & Partial Fill Handling**: An order of 1.0 BTC may execute as 4 separate fills over 15 minutes at varying prices with maker/taker fee tiers. The raw fills capture the reality; the processed trade aggregates them into a volume-weighted average entry price ($VWAP$).
3. **Account Integrity**: Exchange timestamps, order IDs, fill IDs, and raw JSON payloads are preserved exactly as delivered.

---

## 2. PostgreSQL Relational Schema & Enums

The schema is defined using **Prisma ORM** (`prisma/schema.prisma`) and raw PostgreSQL DDL (`prisma/migrations/20260906000000_init/migration.sql`).

### Key Enumerated Types
- `AccountType`: `SPOT`, `FUTURES`, `MARGIN`
- `MarketCategory`: `CRYPTO`, `GOLD`, `SILVER`, `COPPER`, `OTHER`
- `Direction`: `LONG`, `SHORT`
- `TradeStatus`: `OPEN`, `CLOSED`
- `FillRole`: `ENTRY`, `EXIT`, `FEE`, `OTHER`
- `EventImportance`: `LOW`, `MEDIUM`, `HIGH`
- `NoTradeWindowStatus`: `UPCOMING`, `ACTIVE`, `COMPLETED`
- `ViolationType`: `NEWS_BLACKOUT_ENTRY`, `ENTERED_AFTER_MAX_DAILY_LOSSES`, `OVER_RISK_LIMIT`, `REVENGE_TRADING_DETECTED`, `OTHER`
- `PeriodType`: `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`, `ALL_TIME`
- `PatternType`: `SESSION`, `TIME_OF_DAY`, `DAY_OF_WEEK`, `SYMBOL`, `MARKET_CATEGORY`, `DIRECTION`, `HOLDING_TIME`, `AFTER_LOSS`, `AFTER_WIN`, `CONSECUTIVE_LOSS`, `STRATEGY`, `NEWS_EVENT`, `RISK_SIZE`
- `SyncType`: `ORDERS`, `FILLS`, `BALANCES`, `FUNDING`, `FULL_HISTORY`
- `SyncStatus`: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`

---

## 3. How Raw Fills Map Into Processed Trades

A single trade in TradeMate represents a complete trading decision from position open to final liquidation.

### The Mapping Pipeline
1. **Raw Fill Ingestion**:
   - As fills arrive, they are inserted into `raw_exchange_fills` with a compound unique key `(trading_account_id, exchange_fill_id)`.
2. **Trade Association via `trade_fills`**:
   - Each entry in `trade_fills` references a `trade_id`, a `raw_exchange_fill_id`, a `fill_role` (`ENTRY` vs `EXIT`), and `quantity_allocated`.
   - This many-to-many relationship cleanly supports:
     - Scaling in (multiple `ENTRY` fills).
     - Partial take-profits (multiple `EXIT` fills).
     - Position flipping (a single large market order closing a position and opening an opposite one is split across two trades).
3. **Volume-Weighted Average Price ($VWAP$)**:
   $$\text{Avg Entry Price} = \frac{\sum (\text{fill\_price}_i \times \text{fill\_quantity}_i)}{\sum \text{fill\_quantity}_i}$$
4. **Financial Reconciliation**:
   - Gross P&L: $(\text{Exit Price} - \text{Entry Price}) \times \text{Quantity}$ (for Longs)
   - Net P&L: $\text{Gross P\&L} - \text{Total Fees} - \text{Total Funding}$
   - Realized $R$-multiple: $\frac{\text{Net P\&L}}{\text{Risk Amount}}$

---

## 4. Equity Snapshots & Balance Reconstruction

To construct the equity curve and drawdown metrics accurately:

1. **Daily & Periodic Mark-to-Market**:
   - `equity_snapshots` records periodic snapshots containing:
     - `timestamp` (UTC)
     - `equity` (Total account net worth)
     - `wallet_balance` (Cash collateral)
     - `unrealized_pnl` (Floating mark-to-market P&L)
     - `realized_pnl_cumulative` (Running realized returns)
2. **Balance Reconciliation Formula**:
   $$\text{Equity}_t = \text{Initial Deposit} + \sum \text{Net Realized P\&L} + \sum \text{Deposits/Withdrawals} + \text{Unrealized P\&L}_t$$
3. **Drawdown Calculation**:
   - Let $H_t = \max_{s \le t}(\text{Equity}_s)$ be the High Water Mark up to time $t$.
   - The drawdown percentage is:
     $$\text{Drawdown}_t = \frac{\text{Equity}_t - H_t}{H_t} \times 100\%$$
   - Maximum Drawdown ($MDD$) is $\min_t(\text{Drawdown}_t)$.

---

## 5. Deterministic Analytics Engine

TradeMate rejects random approximations in favor of mathematical determinism:

1. **Win Rate**:
   $$\text{Win Rate} = \frac{\text{Count of trades where Net P\&L} > 0}{\text{Total closed trades}} \times 100\%$$
2. **Profit Factor**:
   $$\text{Profit Factor} = \frac{\sum \text{Gross Winning Trades}}{\sum |\text{Gross Losing Trades}|}$$
3. **Expectancy ($E_R$)**:
   $$E_R = (\text{Win Rate} \times \text{Avg Win } R) - (\text{Loss Rate} \times \text{Avg Loss } R)$$
4. **Pattern Detection Models (`detected_patterns`)**:
   - Session breakdown: comparing London (08:00–16:00 UTC), New York (13:00–21:00 UTC), and Asian (00:00–08:00 UTC) session stats.
   - Day-of-week edge: identifying positive cluster days (Wednesday/Thursday) versus low-liquidity days.
   - Post-loss psychology: measuring win rate degradation on trades executed within 15 minutes after a losing trade.

---

## 6. Economic Events & Automated No-Trade Blackout Windows

To prevent catastrophic slippage during macroeconomic shocks:

1. **Event Ingestion**:
   - High-impact events (`importance = HIGH`) such as CPI, Core CPI, Non-Farm Payrolls (NFP), and FOMC are recorded in `economic_events`.
2. **Rule Enforcement (`economic_event_rules`)**:
   - Users establish rules specifying `minutes_before` and `minutes_after` (default: 30 minutes before and 30 minutes after high-impact news).
3. **Blackout Window Generation (`no_trade_windows`)**:
   - A window is calculated automatically:
     - `starts_at` = $\text{Event Timestamp} - \text{minutes\_before}$
     - `ends_at` = $\text{Event Timestamp} + \text{minutes\_after}$
4. **Violation Detection (`trade_rule_violations`)**:
   - Any trade whose `opened_at` falls between `starts_at` and `ends_at` is flagged as a `NEWS_BLACKOUT_ENTRY` violation with a `CRITICAL` or `HIGH` severity level.

---

## 7. Safe MEXC Integration Roadmap & Idempotency

When MEXC live API integration is connected in subsequent steps, the data pipeline follows these safeguards:

1. **Natural Unique Keys for Deduplication**:
   - Fills: `@@unique([trading_account_id, exchange_fill_id])`
   - Orders: `@@unique([trading_account_id, exchange_order_id])`
   - Daily Performance: `@@unique([trading_account_id, date])`
2. **Upsert Semantics**:
   - Fills that already exist in the database are discarded or skipped without throwing errors (`records_skipped++`).
3. **Sync Tracking via `sync_jobs`**:
   - Every polling run or historical backfill creates a `sync_job` record capturing:
     - `sync_type`: `FILLS`, `ORDERS`, `BALANCES`, `FUNDING`, `FULL_HISTORY`
     - `status`: `PENDING` -> `RUNNING` -> `COMPLETED` / `FAILED`
     - Counts: `records_received`, `records_inserted`, `records_skipped`
     - Error traces for debugging.
4. **Rate Limiting & Pagination Guard**:
   - MEXC cursor-based pagination uses `startTime` and `endTime` windows of 7 days per batch to respect exchange API limits.

---

## 8. Service & Repository Layer Abstraction

All UI components communicate exclusively with the data access layer in `src/services/tradingDataService.ts`, which interacts with the underlying database storage.

```typescript
// Example consumer usage in UI
import {
  getTradingAccount,
  getTrades,
  getEquitySnapshots,
  getDashboardSummaryMetrics,
  getMarketPnLSummary,
  getDetectedPatterns
} from '../services/tradingDataService';
```

This ensures that swapping from the high-fidelity in-memory relational store to a live PostgreSQL / Supabase server in cloud deployment requires **zero modifications to UI components**.
