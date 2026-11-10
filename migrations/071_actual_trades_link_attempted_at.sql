-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 071 -- link_attempted_at on actual_trades
-- ============================================================================
-- importActualTrades.ts's recommendation_versions-linking step (importActualTrades.ts,
-- "Link to recommendation_versions") re-queries the full backlog of still-unlinked
-- platform-era trades every run with a hard .limit(500) and no explicit order. With the
-- backlog now at ~1,900 rows (see fix/trade-linking investigation), rows outside the
-- first 500 of whatever order Postgres happens to return never get a turn, and because
-- the row's own .update() had no error check, any individual write failure inside that
-- window was invisible. This column lets the query retry rows on a 24h cadence instead
-- of competing with the same unordered 500 every 15 minutes forever, and the new query
-- orders by published_at desc + paginates past 500 within a single run so the whole
-- eligible backlog gets examined, not just an arbitrary slice of it.
-- ============================================================================

alter table actual_trades
  add column if not exists link_attempted_at timestamptz;

-- Supports `link_attempted_at.is.null,link_attempted_at.lt.<cutoff>` filtering against
-- the same still-unlinked population the linking query already filters by.
create index if not exists idx_actual_trades_link_attempted_at
  on actual_trades (link_attempted_at)
  where opportunity_id is null and recommendation_version_id is null;
