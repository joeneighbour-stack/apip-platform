-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — analyst_publications (Triggered Rate KPI support)
-- ============================================================================
-- actual_trades structurally cannot answer "what was the triggered rate?"
-- because it only ever holds trades that triggered -- there is no record of
-- untriggered/expired recommendations there, by design (Phase 1.1) and by
-- what the manual backfill spreadsheet contained (only realized trades).
--
-- analyst_publications is the denominator: every recommendation the
-- platform/analyst published, whether it triggered or not. Sourced from the
-- Acuity Performance webhook, which DOES return Triggered=false rows when
-- queried with reportType=analyst, with historical depth back to ~2022.
--
-- Reconciliation: Joe has manually corrected some backfilled trades where
-- the webhook claimed Triggered=false but the trade genuinely triggered.
-- Per Joe: "what is in the backfill [is] the most correct data" -- so
-- effective_triggered prefers actual_trades over the webhook's raw flag
-- whenever a match is found. Match key is (date, market_id) only --
-- confirmed as reliable because only one trade per asset per day is
-- published, so no price-based fuzzy matching is needed.
-- ============================================================================

create type reconciliation_status as enum (
  'WEBHOOK_TRUE',              -- webhook said triggered=true, trusted as-is
  'WEBHOOK_FALSE_CONFIRMED',   -- webhook said false, no actual_trades match found, false stands
  'WEBHOOK_FALSE_OVERRIDDEN',  -- webhook said false, but a matching actual_trades row exists -- corrected to true
  'AMBIGUOUS_MULTIPLE_MATCHES' -- more than one actual_trades match found on (date, market_id) -- should not
                                -- happen per the one-per-day rule, but flagged for manual review rather than guessed at
);

create table analyst_publications (
  publication_id          uuid primary key default gen_random_uuid(),
  source_system           source_system not null default 'ACUITY_PERFORMANCE_API',
  source_record_id        text not null, -- webhook's ReportId
  analyst_id              uuid not null references analysts(analyst_id),
  market_id               uuid not null references markets(market_id),
  published_at            timestamptz not null,
  direction               direction_type,
  entry numeric, stop numeric, target numeric,
  original_triggered      boolean not null, -- raw webhook Triggered flag, never overwritten
  effective_triggered     boolean not null, -- after reconciliation -- this is what the KPI reads
  reconciliation_status   reconciliation_status not null,
  matched_trade_id        uuid references actual_trades(trade_id),
  import_batch_id         uuid references import_batches(import_batch_id),
  imported_at             timestamptz not null default now(),
  raw_payload              jsonb not null,
  constraint uq_analyst_publication unique (source_system, source_record_id)
);
create index idx_analyst_publications_analyst_date on analyst_publications (analyst_id, published_at);
create index idx_analyst_publications_market_date on analyst_publications (market_id, published_at);

comment on table analyst_publications is
  'Every recommendation published, triggered or not. Denominator for Triggered Rate KPI. Historical depth from Acuity webhook: ~2022 onward. Pre-2022 is NOT recoverable -- the manual backfill spreadsheet only contained triggered trades, with no record of how many untriggered recommendations existed alongside them.';
