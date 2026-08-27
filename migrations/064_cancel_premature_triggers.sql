-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 064 -- cancel/reset shadow trades that triggered before monitor_from
-- ============================================================================
-- APAC/US shadow trades are generated hours before analysts actually publish
-- (see migrations/053_shadow_trades_monitor_from.sql /
-- 055_us_shadow_trades_monitor_from.sql) and are gated with monitor_from so the
-- monitor doesn't measure pre-publication price movement as if it were the
-- trade. monitorShadowTrades.ts's bar-scan loop didn't actually enforce that
-- gate (fixed in this same change -- see Fix 1/2 in monitorShadowTrades.ts),
-- so some trades triggered on bars before their own monitor_from.
--
-- Live-data check before writing this migration (grouping shadow_trades by
-- opportunity via shadow_trade_outcomes) found 119 affected rows:
--   TRIGGERED (still open): 39
--   STOP_HIT: 31, TARGET_HIT: 14, CLOSED_PROFIT: 20, CLOSED_LOSS: 14 (79 closed)
--   CANCELLED: 1 (already terminal, unaffected either way)
--
-- Two corrections to the queries as originally given:
--
-- 1. The reset query (second, run first) had no trade_outcome_status filter, so
--    as given it would ALSO match the 39 still-open TRIGGERED rows -- not just
--    the closed TARGET_HIT/STOP_HIT/CLOSED_PROFIT/CLOSED_LOSS ones its own
--    accompanying description says it's for. Since it nulls triggered_at, every
--    row it touches becomes invisible to the cancel query that follows (that
--    query requires triggered_at is not null), so the unscoped version would
--    silently reset 100% of premature triggers -- including the currently-open
--    ones this migration's own opening paragraph says must be CANCELLED -- and
--    leave the cancel query with nothing left to do. Added
--    "and sto.trade_outcome_status in ('TARGET_HIT','STOP_HIT','CLOSED_PROFIT','CLOSED_LOSS')"
--    so the reset only touches closed outcomes, and the 39 open TRIGGERED rows
--    fall through to the cancel query as intended.
--
-- 2. The reset query's SET clause assigned triggered_price = null twice
--    (once directly, once via a stray duplicate line) -- "multiple assignments
--    to same column" is a Postgres UPDATE syntax error, so the statement as
--    given would not have run at all. Removed the duplicate. Also added
--    mfe_price/mae_price/exit_bar_timestamp to the reset (real columns written
--    by monitorShadowTrades.ts's close paths, confirmed against live schema)
--    so a reset row has no leftover fields from the invalid premature close.
-- ============================================================================

-- Reset trades that closed via a premature trigger back to NOT_TRIGGERED so
-- they get a fair chance to trigger after monitor_from. Scoped to closed
-- outcomes only (see correction 1 above) -- still-open TRIGGERED rows are
-- handled by the cancel query below instead.
update shadow_trade_outcomes sto
set
  trade_outcome_status = 'NOT_TRIGGERED',
  triggered_at = null,
  triggered_price = null,
  trigger_source = null,
  trigger_bar_timestamp = null,
  result_r = null,
  exit_price = null,
  exit_bar_timestamp = null,
  closed_at = null,
  exit_reason = null,
  mfe_r = null,
  mae_r = null,
  mfe_price = null,
  mae_price = null,
  bars_to_trigger = null,
  bars_to_close = null,
  raw_price_evidence = null
from shadow_trades st
where sto.shadow_trade_id = st.shadow_trade_id
and st.monitor_from is not null
and sto.triggered_at is not null
and sto.triggered_at < st.monitor_from
and sto.trade_outcome_status in ('TARGET_HIT', 'STOP_HIT', 'CLOSED_PROFIT', 'CLOSED_LOSS');

-- Cancel shadow trades that are still sitting in TRIGGERED (still open) having
-- triggered before their monitor_from gate -- pre-publication price movement,
-- invalid as a trigger. Run second: the reset above already cleared
-- triggered_at on every closed row it touched, so only the still-open rows
-- (never matched by the reset's status filter) reach this query.
update shadow_trade_outcomes sto
set
  trade_outcome_status = 'CANCELLED',
  exit_reason = 'TRIGGERED_BEFORE_MONITOR_FROM_GATE',
  closed_at = now()
from shadow_trades st
where sto.shadow_trade_id = st.shadow_trade_id
and st.monitor_from is not null
and sto.triggered_at is not null
and sto.triggered_at < st.monitor_from
and sto.trade_outcome_status not in ('CANCELLED', 'CANCELLED_BEFORE_TRIGGER');
