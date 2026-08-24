-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 061 -- Strategy Learning: strategy_parameters, signal_insights,
-- shadow_trades variant columns
-- ============================================================================
-- strategy_parameters: engine reads these at run time, falls back to
-- hardcoded defaults if no row exists for the context.
-- signal_insights: patterns detected by the weekly analysis job, reviewed
-- by a manager/admin before being applied as a strategy_parameters row.
-- shadow_trades.entry_variant/shadow_system: tag every shadow trade with
-- which entry-zone variant and which shadow strategy generated it, so
-- future variants (ZONE_BOTTOM/ZONE_TOP, OPTIMAL) can be compared against
-- the current defaults on a like-for-like basis.
-- ============================================================================

create table strategy_parameters (
  parameter_id uuid primary key default gen_random_uuid(),
  context_regime text not null,        -- TRENDING_UP, TRENDING_DOWN, RANGE, MIXED, or ANY
  context_asset_class text not null,   -- FX, INDEX, COMMODITY, CRYPTO, EQUITY, or ANY
  context_session text not null,       -- EUROPEAN, US, APAC, or ANY
  parameter_name text not null,        -- e.g. entry_variant, stop_multiplier, target_multiplier
  parameter_value jsonb not null,      -- e.g. {"variant": "ZONE_BOTTOM"} or {"multiplier": 1.2}
  confidence numeric,                  -- 0-1, from signal intelligence job
  sample_size integer,                 -- number of trades this is based on
  applied_at timestamptz default now(),
  applied_by text,                     -- 'SYSTEM' or user email
  status text not null default 'ACTIVE', -- ACTIVE, SUPERSEDED, DISMISSED
  source_insight_id uuid,              -- FK to signal_insights, added below (created after this table)
  created_at timestamptz default now(),
  unique (context_regime, context_asset_class, context_session, parameter_name, status)
);

-- Signal insights: patterns detected by the weekly analysis job
create table signal_insights (
  insight_id uuid primary key default gen_random_uuid(),
  insight_type text not null,          -- ENTRY_VARIANT, STOP_WIDTH, TARGET_WIDTH, TRIGGER_RATE
  context_regime text not null,
  context_asset_class text not null,
  context_session text not null,
  context_symbol text,                 -- null = applies to all symbols in context
  current_value jsonb not null,        -- what the engine currently uses
  suggested_value jsonb not null,      -- what the data suggests
  evidence jsonb not null,             -- sample_size, confidence, avg_r, triggered_rate, win_rate, mfe_avg, mae_avg
  summary text not null,               -- plain English description shown in UI
  status text not null default 'PENDING', -- PENDING, APPLIED, DISMISSED
  detected_at timestamptz default now(),
  actioned_at timestamptz,
  actioned_by text
);

-- strategy_parameters.source_insight_id -> signal_insights.insight_id. Declared here
-- rather than inline on strategy_parameters, since signal_insights didn't exist yet
-- at that point in this file. Nullable (not every parameter row is insight-sourced --
-- 'SYSTEM'-applied defaults or manual overrides have no insight to point at).
alter table strategy_parameters
  add constraint strategy_parameters_source_insight_id_fkey
  foreign key (source_insight_id) references signal_insights (insight_id);

-- Entry variant on shadow trades
alter table shadow_trades
  add column if not exists entry_variant text default 'ZONE_MID',
    -- ZONE_BOTTOM (BUY low / SELL high), ZONE_MID (current), ZONE_TOP (BUY high / SELL low)
  add column if not exists shadow_system text default 'ANALYST_MIRROR';
    -- ANALYST_MIRROR (current), OPTIMAL (unconstrained best profile)

-- RLS
alter table strategy_parameters enable row level security;
alter table signal_insights enable row level security;

-- Matches the established current_app_role() in (...) form used elsewhere
-- (e.g. migrations/049_daily_coverage_plan.sql) rather than the
-- = any(array[...]::app_role[]) form, for consistency across the codebase --
-- both are equivalent since current_app_role() returns app_role and the
-- literals coerce to it in an IN list the same way.
create policy strategy_parameters_select_manager on strategy_parameters
  for select using (current_app_role() in ('MANAGER', 'ADMIN'));

create policy strategy_parameters_all_admin on strategy_parameters
  for all using (current_app_role() = 'ADMIN');

create policy signal_insights_select_manager on signal_insights
  for select using (current_app_role() in ('MANAGER', 'ADMIN'));

create policy signal_insights_all_admin on signal_insights
  for all using (current_app_role() = 'ADMIN');
