-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — actual_trades.session nullable
-- ============================================================================
-- The manual backfill spreadsheet has no time-of-day (date only), so session
-- genuinely cannot be known for those ~30,825 rows -- same conceptual gap as
-- opportunity_id/recommendation_version_id already being nullable for
-- historical_backfill rows. NULL here means "genuinely unknown", not "forgot
-- to set it".
-- ============================================================================

alter table actual_trades alter column session drop not null;

-- NOTE: a session-derivation function for the LIVE Acuity Performance API
-- (which does carry real timestamps) was drafted and then deliberately
-- removed from this migration before being run. session_configuration's
-- publication_window_start_uk/end_uk fields are narrow engine PUBLICATION
-- windows (5:45-7:00, 11:45-14:00, 15:45-18:00 UK -- roughly 5 hours
-- combined out of 24), not full trading-session ranges. A function built on
-- those windows would return NULL for the large majority of real trade
-- timestamps, which is a function that looks solved but mostly fails
-- silently -- worse than leaving it explicitly undone. Real session
-- classification (e.g. broad Asian/European/US trading-hour ranges, which
-- overlap and are a genuinely different concept from "when does the engine
-- publish") needs its own design pass, not a reuse of data meant for a
-- different purpose. Until then, the live Acuity Performance importer also
-- sets session = null, same as the backfill, with this comment as the
-- reason rather than a silent gap.

