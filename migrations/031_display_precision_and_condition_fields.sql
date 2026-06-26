-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.5 Step 5 — display precision + persisted condition fields
-- ============================================================================
-- Per product clarification: analyst-facing guidance text must be
-- market-aware (not hardcoded to FX's 4 decimal places), and
-- volatility_warning/atr_move_since_generation must be persisted on
-- recommendation_versions, not just computed transiently -- they explain
-- why a recommendation became stale, support manager review and post-trade
-- context, and should not be recomputed later from market data that has
-- since moved on.
-- ============================================================================

alter table markets add column display_precision integer;
comment on column markets.display_precision is
  'Decimal places for analyst-facing display text (guidance ranges, etc). Presentation only -- never affects internal numeric calculations, shadow trade levels, expected R, trigger probability, or validation hashes. NULL falls back to a documented default in formatMarketPrice() (intelligence-engine/src/services/guidanceRangeFormatter.ts).';

alter table recommendation_versions add column volatility_warning text;
alter table recommendation_versions add column atr_move_since_generation numeric;
comment on column recommendation_versions.volatility_warning is
  'Human-readable explanation from RecommendationLifecycleService.assessCondition() at the time validity was last assessed -- persisted, not recomputed later, since the market conditions that produced it will have moved on by the time anyone reads it.';
comment on column recommendation_versions.atr_move_since_generation is
  'The ATR-normalised price move since generation, at the time validity was last assessed. Same persist-not-recompute reasoning as volatility_warning.';

-- ----------------------------------------------------------------------------
-- Backfill display_precision defaults by asset_class, with symbol-pattern
-- overrides for the cases that genuinely differ within an asset class
-- (JPY-quoted FX pairs need fewer decimal places than other FX majors).
-- These are sensible V1 defaults, not asset-pricing expertise -- intended
-- to be correctable per-symbol later without needing a code change, since
-- display_precision is now a real column or analysts to tune directly.
-- ----------------------------------------------------------------------------

update markets set display_precision = 4 where asset_class = 'FX' and symbol not like '%JPY%';
update markets set display_precision = 3 where asset_class = 'FX' and symbol like '%JPY%';
update markets set display_precision = 2 where asset_class = 'COMMODITY';  -- Gold, Oil, Copper, Natural Gas, Brent -- not differentiated further in V1
update markets set display_precision = 2 where asset_class = 'INDEX';
update markets set display_precision = 2 where asset_class = 'CRYPTO';    -- not differentiated per-symbol in V1 (see note below)
update markets set display_precision = 2 where asset_class = 'EQUITY';

-- NOTE on parameter_snapshot_hash backfill for pre-existing rows (raised in
-- the same clarification, point 3): NOT attempted in SQL here. Recomputing
-- stableHash(parameter_snapshot) requires the EXACT same hashing algorithm
-- as intelligence-engine/src/services/stableHash.ts (sha256 of a specific
-- deep-sorted, specifically-separated JSON serialization, verified
-- byte-for-byte against the research notebook's Python implementation in
-- Step 1) -- reimplementing that precisely in plpgsql risks exactly the
-- subtle separator/serialization mismatches that were already found and
-- fixed once in the JS/Python comparison. Given recommendation_versions
-- has not yet been written to by real application code (Step 5's services
-- have only run in tests so far), this is very likely a no-op in practice.
-- If real rows ever exist with parameter_snapshot set but
-- parameter_snapshot_hash null before the application itself computes it,
-- a one-off Node/TS backfill script reusing the verified stableHash()
-- function is the correct tool -- not a SQL rewrite of the algorithm.
