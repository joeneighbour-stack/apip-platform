-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 053 -- shadow_trades.monitor_from
-- ============================================================================
-- Companion to the APAC engine-timing fix (engine-trigger/index.js moving
-- engine-apac to 13:05 UTC): APAC shadow trades are now generated hours
-- before APAC-session analysts have actually published, so monitoring them
-- immediately would measure "did the market move between rec and publish"
-- rather than the trade itself. monitor_from lets monitorShadowTrades.ts
-- ignore a trade until analysts have had a realistic chance to publish.
-- ============================================================================

alter table shadow_trades
  add column if not exists monitor_from timestamptz null;

comment on column shadow_trades.monitor_from is
  'When set, the shadow monitor ignores this trade until this timestamp. '
  'Used for APAC trades which are generated at 13:05 UTC but should not '
  'be monitored until 15:00 UTC (16:00 UK) when analysts have published.';

create index if not exists idx_shadow_trades_monitor_from
  on shadow_trades (monitor_from)
  where monitor_from is not null;
