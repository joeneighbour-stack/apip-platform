-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 065 -- pattern_trades table
-- ============================================================================
-- Acuity's webhook (signal-performance) returns both ReportType='Analyst' and
-- ReportType='Pattern' records in the same response. Analyst records already
-- import into actual_trades (importActualTrades.ts); Pattern records were
-- previously counted and discarded. This table gives them a home so
-- backfillPatternTrades.ts and importActualTrades.ts's new pattern-trade
-- routing can persist them, and the management analytics "Patterns" tab can
-- read them.
-- ============================================================================

create table pattern_trades (
  pattern_trade_id    uuid primary key default gen_random_uuid(),
  report_id           text not null unique,
  symbol              text not null,
  asset_class         text,
  direction           text,
  family              text,
  granularity         text,
  status              text,
  published_at        timestamptz,
  exit_date           timestamptz,
  expiry              timestamptz,
  entry               numeric,
  stop_loss           numeric,
  take_profit         numeric,
  exit_price          numeric,
  rr                  numeric,
  triggered           boolean,
  points              numeric,
  return_pct          numeric,
  source_system       text not null default 'ACUITY_PERFORMANCE_API',
  import_batch_id     uuid references import_batches(import_batch_id),
  created_at          timestamptz not null default now()
);

create index pattern_trades_published_at_idx on pattern_trades(published_at desc);
create index pattern_trades_family_idx on pattern_trades(family);
create index pattern_trades_granularity_idx on pattern_trades(granularity);
create index pattern_trades_symbol_idx on pattern_trades(symbol);

-- Management/admin only — no analyst RLS needed
alter table pattern_trades enable row level security;
create policy "pattern_trades_select_management" on pattern_trades
  for select using (
    current_app_role() = any(array['ADMIN'::app_role, 'MANAGER'::app_role, 'RESEARCH'::app_role])
  );
