-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('SPOT', 'FUTURES', 'MARGIN');
CREATE TYPE "MarketCategory" AS ENUM ('CRYPTO', 'GOLD', 'SILVER', 'COPPER', 'OTHER');
CREATE TYPE "Direction" AS ENUM ('LONG', 'SHORT');
CREATE TYPE "TradeStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "FillRole" AS ENUM ('ENTRY', 'EXIT', 'FEE', 'OTHER');
CREATE TYPE "EventImportance" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "NoTradeWindowStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED');
CREATE TYPE "ViolationType" AS ENUM ('NEWS_BLACKOUT_ENTRY', 'ENTERED_AFTER_MAX_DAILY_LOSSES', 'OVER_RISK_LIMIT', 'REVENGE_TRADING_DETECTED', 'OTHER');
CREATE TYPE "PeriodType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'ALL_TIME');
CREATE TYPE "PatternType" AS ENUM ('SESSION', 'TIME_OF_DAY', 'DAY_OF_WEEK', 'SYMBOL', 'MARKET_CATEGORY', 'DIRECTION', 'HOLDING_TIME', 'AFTER_LOSS', 'AFTER_WIN', 'CONSECUTIVE_LOSS', 'STRATEGY', 'NEWS_EVENT', 'RISK_SIZE');
CREATE TYPE "SyncType" AS ENUM ('ORDERS', 'FILLS', 'BALANCES', 'FUNDING', 'FULL_HISTORY');
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "AttachmentType" AS ENUM ('PRE_TRADE_SCREENSHOT', 'POST_TRADE_SCREENSHOT', 'OTHER');

-- CreateTable users
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable exchanges
CREATE TABLE "exchanges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL UNIQUE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable trading_accounts
CREATE TABLE "trading_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "exchange_id" TEXT NOT NULL REFERENCES "exchanges"("id") ON DELETE RESTRICT,
    "account_name" TEXT NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "base_currency" TEXT NOT NULL DEFAULT 'USDT',
    "external_account_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "trading_accounts_user_id_idx" ON "trading_accounts"("user_id");
CREATE INDEX "trading_accounts_exchange_id_idx" ON "trading_accounts"("exchange_id");

-- CreateTable raw_exchange_orders
CREATE TABLE "raw_exchange_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trading_account_id" TEXT NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
    "exchange_order_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "order_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "price" DECIMAL(18,8) NOT NULL CHECK ("price" >= 0),
    "quantity" DECIMAL(18,8) NOT NULL CHECK ("quantity" >= 0),
    "filled_quantity" DECIMAL(18,8) NOT NULL CHECK ("filled_quantity" >= 0),
    "average_price" DECIMAL(18,8),
    "reduce_only" BOOLEAN NOT NULL DEFAULT false,
    "position_side" TEXT,
    "leverage" INTEGER,
    "exchange_created_at" TIMESTAMP(3) NOT NULL,
    "exchange_updated_at" TIMESTAMP(3),
    "raw_payload" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "raw_exchange_orders_account_order_uniq" UNIQUE ("trading_account_id", "exchange_order_id")
);
CREATE INDEX "raw_exchange_orders_account_symbol_idx" ON "raw_exchange_orders"("trading_account_id", "symbol");

-- CreateTable raw_exchange_fills
CREATE TABLE "raw_exchange_fills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trading_account_id" TEXT NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
    "exchange_fill_id" TEXT NOT NULL,
    "exchange_order_id" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "price" DECIMAL(18,8) NOT NULL CHECK ("price" >= 0),
    "quantity" DECIMAL(18,8) NOT NULL CHECK ("quantity" >= 0),
    "quote_quantity" DECIMAL(18,8),
    "fee" DECIMAL(18,8) NOT NULL DEFAULT 0 CHECK ("fee" >= 0),
    "fee_currency" TEXT,
    "realized_pnl" DECIMAL(18,8),
    "position_side" TEXT,
    "liquidity_type" TEXT,
    "exchange_timestamp" TIMESTAMP(3) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "raw_exchange_fills_account_fill_uniq" UNIQUE ("trading_account_id", "exchange_fill_id")
);
CREATE INDEX "raw_exchange_fills_account_idx" ON "raw_exchange_fills"("trading_account_id");
CREATE INDEX "raw_exchange_fills_symbol_idx" ON "raw_exchange_fills"("symbol");
CREATE INDEX "raw_exchange_fills_timestamp_idx" ON "raw_exchange_fills"("exchange_timestamp");

-- CreateTable funding_transactions
CREATE TABLE "funding_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trading_account_id" TEXT NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
    "external_id" TEXT,
    "symbol" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "funding_rate" DECIMAL(12,8),
    "exchange_timestamp" TIMESTAMP(3) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "funding_transactions_symbol_idx" ON "funding_transactions"("trading_account_id", "symbol");
CREATE INDEX "funding_transactions_timestamp_idx" ON "funding_transactions"("exchange_timestamp");

-- CreateTable balance_transactions
CREATE TABLE "balance_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trading_account_id" TEXT NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
    "external_id" TEXT,
    "transaction_type" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "exchange_timestamp" TIMESTAMP(3) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "balance_transactions_asset_idx" ON "balance_transactions"("trading_account_id", "asset");
CREATE INDEX "balance_transactions_timestamp_idx" ON "balance_transactions"("exchange_timestamp");

-- CreateTable strategies
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "strategies_user_id_idx" ON "strategies"("user_id");

-- CreateTable trade_setups
CREATE TABLE "trade_setups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "strategy_id" TEXT REFERENCES "strategies"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable trades
CREATE TABLE "trades" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trading_account_id" TEXT NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
    "symbol" TEXT NOT NULL,
    "market_category" "MarketCategory" NOT NULL,
    "direction" "Direction" NOT NULL,
    "status" "TradeStatus" NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "average_entry_price" DECIMAL(18,8) NOT NULL CHECK ("average_entry_price" > 0),
    "average_exit_price" DECIMAL(18,8),
    "entry_quantity" DECIMAL(18,8) NOT NULL CHECK ("entry_quantity" > 0),
    "exit_quantity" DECIMAL(18,8),
    "gross_pnl" DECIMAL(18,8),
    "net_pnl" DECIMAL(18,8),
    "fees_total" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "funding_total" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "return_percent" DECIMAL(8,4),
    "risk_amount" DECIMAL(18,8) CHECK ("risk_amount" >= 0),
    "risk_percent" DECIMAL(6,4) CHECK ("risk_percent" >= 0),
    "r_multiple" DECIMAL(8,4),
    "leverage" INTEGER,
    "holding_seconds" INTEGER,
    "strategy_id" TEXT REFERENCES "strategies"("id") ON DELETE SET NULL,
    "setup_id" TEXT REFERENCES "trade_setups"("id") ON DELETE SET NULL,
    "session" TEXT,
    "trade_number_of_day" INTEGER,
    "followed_rules" BOOLEAN,
    "emotion" TEXT,
    "confidence_score" INTEGER CHECK ("confidence_score" >= 1 AND "confidence_score" <= 10),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "trades_account_idx" ON "trades"("trading_account_id");
CREATE INDEX "trades_symbol_idx" ON "trades"("symbol");
CREATE INDEX "trades_opened_at_idx" ON "trades"("opened_at");
CREATE INDEX "trades_closed_at_idx" ON "trades"("closed_at");
CREATE INDEX "trades_strategy_idx" ON "trades"("strategy_id");
CREATE INDEX "trades_direction_idx" ON "trades"("direction");
CREATE INDEX "trades_session_idx" ON "trades"("session");

-- CreateTable trade_fills
CREATE TABLE "trade_fills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trade_id" TEXT NOT NULL REFERENCES "trades"("id") ON DELETE CASCADE,
    "raw_exchange_fill_id" TEXT NOT NULL REFERENCES "raw_exchange_fills"("id") ON DELETE RESTRICT,
    "fill_role" "FillRole" NOT NULL,
    "quantity_allocated" DECIMAL(18,8) NOT NULL CHECK ("quantity_allocated" > 0),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "trade_fills_trade_idx" ON "trade_fills"("trade_id");
CREATE INDEX "trade_fills_raw_fill_idx" ON "trade_fills"("raw_exchange_fill_id");

-- CreateTable trade_journal_entries
CREATE TABLE "trade_journal_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trade_id" TEXT NOT NULL UNIQUE REFERENCES "trades"("id") ON DELETE CASCADE,
    "pre_trade_notes" TEXT,
    "post_trade_notes" TEXT,
    "entry_reason" TEXT,
    "exit_reason" TEXT,
    "mistake_category" TEXT,
    "emotion_before" TEXT,
    "emotion_after" TEXT,
    "rule_followed" BOOLEAN,
    "confidence_score" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable trade_attachments
CREATE TABLE "trade_attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trade_id" TEXT NOT NULL REFERENCES "trades"("id") ON DELETE CASCADE,
    "attachment_type" "AttachmentType" NOT NULL,
    "file_url" TEXT NOT NULL,
    "caption" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "trade_attachments_trade_idx" ON "trade_attachments"("trade_id");

-- CreateTable equity_snapshots
CREATE TABLE "equity_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trading_account_id" TEXT NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "equity" DECIMAL(18,8) NOT NULL CHECK ("equity" >= 0),
    "wallet_balance" DECIMAL(18,8),
    "available_balance" DECIMAL(18,8),
    "unrealized_pnl" DECIMAL(18,8),
    "realized_pnl_cumulative" DECIMAL(18,8),
    "source" TEXT NOT NULL DEFAULT 'CALCULATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "equity_snapshots_account_timestamp_idx" ON "equity_snapshots"("trading_account_id", "timestamp");

-- CreateTable daily_performance
CREATE TABLE "daily_performance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trading_account_id" TEXT NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
    "date" VARCHAR(10) NOT NULL,
    "starting_equity" DECIMAL(18,8) NOT NULL,
    "ending_equity" DECIMAL(18,8) NOT NULL,
    "gross_pnl" DECIMAL(18,8) NOT NULL,
    "net_pnl" DECIMAL(18,8) NOT NULL,
    "fees" DECIMAL(18,8) NOT NULL,
    "funding" DECIMAL(18,8) NOT NULL,
    "return_percent" DECIMAL(8,4) NOT NULL,
    "trades_count" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "win_rate" DECIMAL(6,2) NOT NULL CHECK ("win_rate" >= 0 AND "win_rate" <= 100),
    "gross_profit" DECIMAL(18,8) NOT NULL,
    "gross_loss" DECIMAL(18,8) NOT NULL,
    "profit_factor" DECIMAL(8,4),
    "average_r" DECIMAL(8,4),
    "max_drawdown_percent" DECIMAL(6,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_performance_account_date_uniq" UNIQUE ("trading_account_id", "date")
);
CREATE INDEX "daily_performance_account_idx" ON "daily_performance"("trading_account_id");

-- CreateTable economic_events
CREATE TABLE "economic_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "external_event_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'FOREX_FACTORY',
    "country" TEXT NOT NULL,
    "currency" TEXT,
    "event_name" TEXT NOT NULL,
    "category" TEXT,
    "importance" "EventImportance" NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "actual" TEXT,
    "forecast" TEXT,
    "previous" TEXT,
    "unit" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "economic_events_scheduled_at_idx" ON "economic_events"("scheduled_at");
CREATE INDEX "economic_events_importance_idx" ON "economic_events"("importance");
CREATE INDEX "economic_events_event_name_idx" ON "economic_events"("event_name");

-- CreateTable economic_event_rules
CREATE TABLE "economic_event_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "event_name_pattern" TEXT NOT NULL,
    "importance_filter" "EventImportance",
    "minutes_before" INTEGER NOT NULL CHECK ("minutes_before" >= 0),
    "minutes_after" INTEGER NOT NULL CHECK ("minutes_after" >= 0),
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "economic_event_rules_user_id_idx" ON "economic_event_rules"("user_id");

-- CreateTable no_trade_windows
CREATE TABLE "no_trade_windows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "economic_event_id" TEXT NOT NULL REFERENCES "economic_events"("id") ON DELETE CASCADE,
    "rule_id" TEXT NOT NULL REFERENCES "economic_event_rules"("id") ON DELETE CASCADE,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "NoTradeWindowStatus" NOT NULL DEFAULT 'UPCOMING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "no_trade_windows_time_idx" ON "no_trade_windows"("starts_at", "ends_at");

-- CreateTable trade_rule_violations
CREATE TABLE "trade_rule_violations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trade_id" TEXT NOT NULL REFERENCES "trades"("id") ON DELETE CASCADE,
    "violation_type" "ViolationType" NOT NULL,
    "economic_event_id" TEXT REFERENCES "economic_events"("id") ON DELETE SET NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "trade_rule_violations_trade_idx" ON "trade_rule_violations"("trade_id");
CREATE INDEX "trade_rule_violations_type_idx" ON "trade_rule_violations"("violation_type");

-- CreateTable analytics_snapshots
CREATE TABLE "analytics_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trading_account_id" TEXT NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
    "period_type" "PeriodType" NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "analytics_snapshots_account_period_idx" ON "analytics_snapshots"("trading_account_id", "period_type");

-- CreateTable detected_patterns
CREATE TABLE "detected_patterns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trading_account_id" TEXT NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
    "pattern_type" "PatternType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "win_rate" DECIMAL(6,2),
    "expectancy_r" DECIMAL(8,4),
    "profit_factor" DECIMAL(8,4),
    "net_pnl" DECIMAL(18,8),
    "confidence_score" INTEGER CHECK ("confidence_score" >= 1 AND "confidence_score" <= 10),
    "is_positive" BOOLEAN NOT NULL,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "metadata" JSONB,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "detected_patterns_account_idx" ON "detected_patterns"("trading_account_id");
CREATE INDEX "detected_patterns_type_idx" ON "detected_patterns"("pattern_type");
CREATE INDEX "detected_patterns_detected_at_idx" ON "detected_patterns"("detected_at");

-- CreateTable sync_jobs
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trading_account_id" TEXT NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
    "sync_type" "SyncType" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "records_received" INTEGER NOT NULL DEFAULT 0,
    "records_inserted" INTEGER NOT NULL DEFAULT 0,
    "records_skipped" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "sync_jobs_account_status_idx" ON "sync_jobs"("trading_account_id", "status");

-- CreateTable import_batches
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trading_account_id" TEXT NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
    "source" TEXT NOT NULL DEFAULT 'MANUAL_CSV',
    "file_name" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "records_total" INTEGER NOT NULL DEFAULT 0,
    "records_success" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "import_batches_account_idx" ON "import_batches"("trading_account_id");
