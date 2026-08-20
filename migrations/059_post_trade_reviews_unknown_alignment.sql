-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 059 -- allow 'Unknown' on post_trade_reviews.entry_alignment
-- ============================================================================
-- entry_alignment's check constraint (033_post_trade_reviews.sql, unnamed
-- inline check -> Postgres's default post_trade_reviews_entry_alignment_check
-- name) only ever allowed ('High', 'Low'), unlike stop_alignment and
-- target_alignment, which migration 047 gave a third 'Unknown' value for
-- exactly the case where alignment can't be scored (missing band data).
-- scoreEntryZoneAlignment() in generatePostTradeReviews.ts has always been
-- able to return 'Unknown' (see its own null-guard), so a row hitting that
-- path would fail this constraint on insert. Companion to the same script's
-- generatePostTradeReviews.ts fix (skip trades with missing band boundaries
-- before scoring, so entry_alignment should never actually be 'Unknown' in
-- practice) -- this is a safety net so the constraint reflects what the
-- other two alignment columns already allow, not the primary fix.
-- ============================================================================

alter table post_trade_reviews
  drop constraint post_trade_reviews_entry_alignment_check;

alter table post_trade_reviews
  add constraint post_trade_reviews_entry_alignment_check
  check (entry_alignment = any(array['High', 'Low', 'Unknown']));
