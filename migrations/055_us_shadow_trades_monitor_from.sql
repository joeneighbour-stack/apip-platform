-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 055 -- monitor_from gate for US shadow trades
-- ============================================================================
-- Companion to the runEngineSession.ts fix extending the APAC monitor_from
-- gate (migrations/053_shadow_trades_monitor_from.sql) to the US session:
-- engine-us runs at 08:48 UTC, well before US-session analysts actually
-- publish, so monitoring a shadow trade immediately would measure market
-- movement between generation and publication as if it were the trade
-- itself. Backfills monitor_from onto existing US shadow trades that are
-- still NOT_TRIGGERED (and therefore still eligible to be gated -- a trade
-- that already triggered under the old, ungated behaviour is left alone,
-- same scoping as migration 054's ENTER_NOW invalidation).
-- ============================================================================

update shadow_trades
set monitor_from = date_trunc('day', created_at) + interval '12 hours'
where session = 'US'
and shadow_trade_id in (
  select st.shadow_trade_id
  from shadow_trades st
  join shadow_trade_outcomes sto on sto.shadow_trade_id = st.shadow_trade_id
  where sto.trade_outcome_status = 'NOT_TRIGGERED'
  and st.session = 'US'
)
and monitor_from is null;
