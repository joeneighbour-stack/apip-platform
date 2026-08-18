-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 050 -- analytics_cache
-- ============================================================================
-- Pre-computed analytics view cache. Replaces Next.js unstable_cache, which
-- runs into Next.js's ~2MB per-entry limit on this payload (30,000+ trades,
-- 40,000+ publications, fully recomputed). Written by
-- getCachedDefaultAnalyticsView() (lib/analyticsCache.ts) on a cache miss,
-- and by /api/analytics/warm-cache, which is hit every 2 hours during market
-- hours by .github/workflows/analytics-cache-warm.yml so the first manager
-- to open the page each cycle finds a warm cache rather than paying for the
-- computation themselves. Read by /api/analytics/summary.
--
-- No TTL column: freshness is maintained by the warm-cache schedule above,
-- not by expiring rows here -- a row is only replaced by an explicit
-- recompute (warm-cache endpoint or the summary route's ?force=true path).
-- ============================================================================

create table if not exists analytics_cache (
  cache_key text primary key,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  trade_count int not null default 0
);

-- No RLS: accessed only via the service-role client (createAdminClient()),
-- never from a user session.
