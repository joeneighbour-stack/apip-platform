-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 069 -- paging indexes for the full-history analytics fetches
-- ============================================================================
-- /api/analytics/trades and /api/analytics/publications (and the analytics cache
-- rebuild in lib/analyticsCache.ts) page through actual_trades/analyst_publications
-- ordered by (published_at DESC, trade_id/publication_id DESC), via PostgREST's
-- .range() (LIMIT/OFFSET under the hood). With no supporting index, every page
-- requires a full sort of the matching rows before the requested OFFSET can be
-- skipped -- cost grows with page number, so a "Since Inception" fetch (30-40+
-- pages) gets slower page over page and was observed hitting
-- `canceling statement due to statement timeout` specifically on later pages
-- (page 25, page 29, ...) during live testing, driving the Analyst Signals
-- "Generate Report" button's multi-minute load time.
--
-- Run this directly in the Supabase SQL editor (or via `psql`), one statement at
-- a time if your tool wraps pasted SQL in an implicit transaction --
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. CONCURRENTLY
-- avoids taking a write lock on these tables while the index builds, so normal
-- reads/writes (the live trade-ingestion webhook, the dashboard) are unaffected
-- during creation; it just takes longer than a plain CREATE INDEX would.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_actual_trades_published_at_trade_id
  ON actual_trades (published_at DESC, trade_id DESC);

-- Partial index: every query against this table filters
-- source_system = 'ACUITY_PERFORMANCE_API' (see /api/analytics/publications,
-- lib/analyticsCache.ts, lib/shadowBreakdown.ts) -- indexing only that subset keeps
-- the index smaller and more effective than a full-table composite would be.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analyst_publications_api_published_at_id
  ON analyst_publications (published_at DESC, publication_id DESC)
  WHERE source_system = 'ACUITY_PERFORMANCE_API';
