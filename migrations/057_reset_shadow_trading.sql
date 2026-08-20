-- ============================================================================
-- Migration 057 — Full shadow trading reset
-- ============================================================================
-- Shadow trading methodology was formalised on 2026-08-20. All prior shadow
-- trades used incorrect entry zones, ATR-multiplier stops/targets, stale
-- regime classifications, and ENTER_NOW mode. None represent valid benchmarks.
-- Day 1 of clean shadow tracking: 2026-08-20.
--
-- CAUTION: this is an unconditional, unfiltered truncate -- unlike migration
-- 054/056's soft-cancel UPDATEs (which only touched rows before a cutoff and
-- left the rows in place for audit), this permanently deletes EVERY row in
-- both tables, including any shadow trades already generated today
-- (2026-08-20) under the new, correct logic if this runs after they exist.
-- Apply this before today's remaining sessions run, not after, or add a
-- `where created_at < '2026-08-20T00:00:00Z'` guard first if same-day clean
-- data already exists and needs to survive.
-- ============================================================================
truncate shadow_trade_outcomes restart identity cascade;
truncate shadow_trades restart identity cascade;
