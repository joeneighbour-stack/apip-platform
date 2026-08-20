-- ============================================================================
-- Migration 057 — Full shadow trading reset
-- ============================================================================
-- Shadow trading methodology was formalised on 2026-08-20. All prior shadow
-- trades used incorrect entry zones, ATR-multiplier stops/targets, stale
-- regime classifications, and ENTER_NOW mode. None represent valid benchmarks.
-- Day 1 of clean shadow tracking: 2026-08-20.
-- Applied manually on 2026-08-20 using date-filtered deletes to preserve
-- the 37 clean trades already generated under the new methodology.
-- ============================================================================

delete from shadow_trade_outcomes
where shadow_trade_id in (
  select shadow_trade_id from shadow_trades
  where created_at < '2026-08-20T00:00:00Z'
);

delete from shadow_trades
where created_at < '2026-08-20T00:00:00Z';
