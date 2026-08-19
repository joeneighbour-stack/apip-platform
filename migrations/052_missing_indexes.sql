-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 052 -- missing indexes on hot-path tables
-- ============================================================================
-- Follow-up to the Phase 6 pre-launch performance audit (docs/qa/performance-audit.md,
-- Check 3): these four tables had zero indexes beyond their primary key, despite all
-- four being queried on these exact columns in hot paths (management overview,
-- shadow monitoring, analyst monitor, dispute resolution).
-- ============================================================================

-- trade_disputes: queried by trade_id (.in('trade_id', batch) joins) and status
-- (.in('status', ['OPEN', 'UNDER_REVIEW']) in management/page.tsx).
create index if not exists idx_trade_disputes_trade_id
  on trade_disputes (trade_id);
create index if not exists idx_trade_disputes_status
  on trade_disputes (status);

-- analyst_availability: has a unique constraint on (analyst_id, date, session), but
-- that only helps queries filtering by analyst_id first -- management/page.tsx's
-- team-wide "today's availability" and "absence requests in the next 30 days" queries
-- filter by date alone, with no analyst_id, and get no benefit from it.
create index if not exists idx_analyst_availability_analyst_date
  on analyst_availability (analyst_id, date);

-- shadow_trade_outcomes: every query (ShadowMonitoringPanel, getShadowBreakdownData(),
-- TeamPerformanceGrid) joins through shadow_trade_id -- previously unindexed.
create index if not exists idx_shadow_trade_outcomes_shadow_trade_id
  on shadow_trade_outcomes (shadow_trade_id);

-- post_trade_reviews: trade_id is the entire access pattern for this table
-- (.in('trade_id', batch) in management/page.tsx, trade:trade_id!inner in monitor
-- pages) -- previously unindexed.
create index if not exists idx_post_trade_reviews_trade_id
  on post_trade_reviews (trade_id);
