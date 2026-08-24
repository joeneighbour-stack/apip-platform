-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 060 -- shadow_trade_outcomes MFE/MAE
-- ============================================================================
-- MFE (Maximum Favourable Excursion) / MAE (Maximum Adverse Excursion), both
-- in R, tracked from trigger to close using each 5-minute bar's intrabar
-- high/low (monitorShadowTrades.ts). bars_to_trigger/bars_to_close are the
-- 5-minute bar counts generation→trigger and trigger→close respectively.
-- ============================================================================

alter table shadow_trade_outcomes
  add column if not exists mfe_r numeric,           -- max favourable excursion in R from entry
  add column if not exists mae_r numeric,           -- max adverse excursion in R from entry
  add column if not exists mfe_price numeric,       -- price at MFE
  add column if not exists mae_price numeric,       -- price at MAE
  add column if not exists bars_to_trigger integer, -- bars from generation to trigger
  add column if not exists bars_to_close integer;   -- bars from trigger to close

comment on column shadow_trade_outcomes.mfe_r is
  'Maximum favourable excursion in R, tracked from trigger to close (or to now, for still-open trades -- see raw_price_evidence.running_mfe_r).';
comment on column shadow_trade_outcomes.mae_r is
  'Maximum adverse excursion in R, tracked from trigger to close (or to now, for still-open trades -- see raw_price_evidence.running_mae_r).';
comment on column shadow_trade_outcomes.mfe_price is
  'Price at which mfe_r occurred.';
comment on column shadow_trade_outcomes.mae_price is
  'Price at which mae_r occurred.';
comment on column shadow_trade_outcomes.bars_to_trigger is
  '5-minute bar count from generated_at to the triggering bar. 0 for ENTER_NOW trades (triggered at generation, no bars scanned).';
comment on column shadow_trade_outcomes.bars_to_close is
  '5-minute bar count from trigger to the closing bar (TARGET_HIT/STOP_HIT/AMBIGUOUS/EXPIRY/CLOSED_PROFIT/CLOSED_LOSS).';
