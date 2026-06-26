-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.5 Step 2 — actual_trades.entry_zone + entry_zone_source
-- ============================================================================
-- Per APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md Section 4.2 (Amendment 2
-- resolution). Two nullable columns, not one:
--   - entry_zone: which ATR zone the trade entered in, when known.
--   - entry_zone_source: provenance. 'LIVE_COMPUTED' for new INCREMENTAL
--     ingestion (zone derived from market_state_daily/intraday at the time
--     of import); 'HISTORICAL_RECONSTRUCTED' only if the pilot (Step 2a)
--     finds reconstruction feasible and is later run at scale.
--
-- This migration does NOT populate either column for the existing 30,825
-- backfilled trades or 43,434 publications -- both remain NULL until the
-- pilot's findings (a separate, non-committing investigation) determine
-- whether reconstruction is worth pursuing for any subset of markets.
-- ============================================================================

alter table actual_trades add column entry_zone atr_zone;
alter table actual_trades add column entry_zone_source text
  check (entry_zone_source in ('LIVE_COMPUTED', 'HISTORICAL_RECONSTRUCTED'));

-- entry_zone_source must be null whenever entry_zone is null (no zone, no
-- provenance to record) -- enforced as a real constraint, not just a
-- convention services are expected to honour.
alter table actual_trades add constraint chk_entry_zone_source_requires_zone
  check (entry_zone is not null or entry_zone_source is null);

comment on column actual_trades.entry_zone is
  'Which ATR zone this trade entered in, when known. NULL for the vast majority of historical_backfill rows (no honest way to reconstruct without the historical ATR series -- see Architecture V1.1 Section 1.5 / Amendment 2).';
comment on column actual_trades.entry_zone_source is
  'Provenance of entry_zone: LIVE_COMPUTED (derived from market_state_daily/intraday at import time) or HISTORICAL_RECONSTRUCTED (lower-confidence, derived from a later Finnhub historical pull -- see Step 2a pilot). NULL iff entry_zone is NULL.';
