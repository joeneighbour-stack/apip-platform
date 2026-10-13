-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 066 -- ai_trades table
-- ============================================================================
-- Acuity's webhook (signal-performance) also returns ReportType='AI' records
-- alongside 'Analyst' (actual_trades) and 'Pattern' (pattern_trades, migration
-- 065) -- AI signals were previously counted and discarded. This table gives
-- them a home so backfillAiTrades.ts and importActualTrades.ts's AI-trade
-- routing can persist them, and the management analytics "AI Signals" tab can
-- read them. Same structure as pattern_trades, but keyed on a confidence score
-- instead of family/granularity -- AI signals have no pattern family or chart
-- timeframe concept.
-- ============================================================================

create table ai_trades (
  ai_trade_id         uuid primary key default gen_random_uuid(),
  report_id           text not null unique,
  symbol              text not null,
  asset_name          text,
  asset_class         text,
  direction           text,
  status              text,
  confidence          integer,
  published_at        timestamptz,
  exit_date           timestamptz,
  expiry              timestamptz,
  entry               numeric,
  stop_loss           numeric,
  take_profit         numeric,
  exit_price          numeric,
  rr                  numeric,
  triggered           boolean,
  return_pct          numeric,
  source_system       text not null default 'ACUITY_PERFORMANCE_API',
  import_batch_id     uuid references import_batches(import_batch_id),
  created_at          timestamptz not null default now()
);

create index ai_trades_published_at_idx on ai_trades(published_at desc);
create index ai_trades_confidence_idx on ai_trades(confidence);
create index ai_trades_symbol_idx on ai_trades(symbol);
create index ai_trades_asset_class_idx on ai_trades(asset_class);

-- Management/admin only — no analyst RLS needed, same as pattern_trades
alter table ai_trades enable row level security;
create policy "ai_trades_select_management" on ai_trades
  for select using (
    current_app_role() = any(array['ADMIN'::app_role, 'MANAGER'::app_role, 'RESEARCH'::app_role])
  );
