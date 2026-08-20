-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 054 -- invalidate ENTER_NOW shadow trades
-- ============================================================================
-- Companion to the runEngineSession.ts fix that removes ENTER_NOW as a shadow
-- trade entry mode: shadow trades generated with entry_mode = 'ENTER_NOW' were
-- marked TRIGGERED at the session's snapshot price the instant they were
-- generated, rather than waiting for price to actually reach the entry range.
-- That's not a valid benchmark for what a disciplined trader would have done,
-- so the ~150 existing ENTER_NOW shadow trades that already progressed past
-- NOT_TRIGGERED are cancelled here rather than left in KPI/performance
-- calculations. Only rows in an in-progress-or-closed status are touched --
-- an ENTER_NOW row still sitting at NOT_TRIGGERED (shouldn't exist given how
-- ENTER_NOW was generated, but guarded here regardless) is left alone.
-- ============================================================================

-- Invalidate ENTER_NOW shadow trades -- triggered at snapshot price not entry level
update shadow_trade_outcomes
set trade_outcome_status = 'CANCELLED'
where shadow_trade_id in (
  select shadow_trade_id from shadow_trades
  where entry_mode = 'ENTER_NOW'
)
and trade_outcome_status in ('TRIGGERED', 'CLOSED_PROFIT', 'CLOSED_LOSS', 'STOP_HIT', 'TARGET_HIT');

-- Update the shadow_trades table status sync
update shadow_trades
set trade_outcome_status = 'CANCELLED'
where entry_mode = 'ENTER_NOW'
and trade_outcome_status in ('TRIGGERED', 'CLOSED_PROFIT', 'CLOSED_LOSS', 'STOP_HIT', 'TARGET_HIT');
