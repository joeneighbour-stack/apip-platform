-- ============================================================================
-- Migration 056 — Invalidate pre-redesign shadow trades
-- ============================================================================
-- Shadow trades generated before 2026-08-20 used:
--   - Incorrect ATR-multiplier stop/target logic (not band-boundary)
--   - Wrong entry zones (Zone 2 placeholder contamination)
--   - Stale ADX regime classifications (15-day lag, fixed 2026-08-18)
--   - ENTER_NOW mode (price never reached entry level)
-- None of these trades represent valid performance benchmarks.
-- Cancelling all outcomes and marking trades as invalid.
-- Clean shadow data accumulates from 2026-08-20 onwards.
-- ============================================================================

-- Cancel all outcome records for pre-redesign shadow trades
update shadow_trade_outcomes
set trade_outcome_status = 'CANCELLED'
where shadow_trade_id in (
  select shadow_trade_id from shadow_trades
  where created_at < '2026-08-20T00:00:00Z'
)
and trade_outcome_status != 'CANCELLED';

-- Sync the denormalized status on shadow_trades
update shadow_trades
set trade_outcome_status = 'CANCELLED'
where created_at < '2026-08-20T00:00:00Z'
and trade_outcome_status != 'CANCELLED';
