-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 070 -- unique constraint on shadow_trades (opportunity_id, shadow_system, entry_variant)
-- ============================================================================
-- runEngineSession.ts generates shadow trades in two independently-gated passes
-- per opportunity (ANALYST_MIRROR and OPTIMAL, migrations/061_strategy_learning.sql
-- and 062_shadow_optimal_analyst.sql), each writing exactly one row per
-- (shadow_system, entry_variant) pair -- so a given opportunity should have at
-- most one shadow_trades row for any given (shadow_system, entry_variant)
-- combination. Nothing currently enforces that: a diagnosis investigation
-- (fix/shadow-monitor-diagnosis) found zero violations across the full table
-- (13,563 rows checked, read-only, via the Supabase REST API), but a future
-- re-run or retry of the insert loop at runEngineSession.ts ~line 1267/1414
-- could silently double-write without this.
--
-- NOT applied by this commit -- review and run manually (Supabase SQL editor
-- or psql). Safe to apply as a plain CREATE UNIQUE INDEX (not CONCURRENTLY):
-- this table is written by a once-per-session batch job, not a
-- high-frequency path, so a brief write lock during creation is acceptable
-- (unlike migrations/069_analytics_paging_indexes.sql's CONCURRENTLY indexes
-- on the much hotter actual_trades/analyst_publications tables).

create unique index if not exists idx_shadow_trades_unique_variant
  on shadow_trades (opportunity_id, shadow_system, entry_variant);
