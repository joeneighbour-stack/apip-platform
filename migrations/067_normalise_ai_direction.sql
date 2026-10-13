-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 067 -- normalise direction values in ai_trades / pattern_trades
-- ============================================================================
-- Data fix, not a schema change: the webhook returns 'Buy'/'Sell' (mixed case) for
-- direction on AI and Pattern records, while importActualTrades.ts/backfillAiTrades.ts/
-- backfillPatternTrades.ts now uppercase it on the way in (see their own direction
-- mapping) -- this is a one-time cleanup for rows already imported before that change.
--
-- This file must be run manually in the Supabase SQL editor -- it is a data UPDATE,
-- not DDL, so it is not picked up by any automatic migration runner in this repo.
-- ============================================================================

-- Normalise direction values in ai_trades to uppercase (webhook returns 'Buy'/'Sell')
update ai_trades
set direction = upper(direction)
where direction is not null
  and direction != upper(direction);

-- Same for pattern_trades for consistency
update pattern_trades
set direction = upper(direction)
where direction is not null
  and direction != upper(direction);
