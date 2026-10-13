-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 068 -- ai_trades_with_reiteration() window-function helper
-- ============================================================================
-- PostgREST's standard .select() builder (used by every other analytics route in this
-- app) can't express a window function, so this ships as a proper SQL function instead,
-- called via .rpc() from apps/web/app/api/analytics/ai-signals/route.ts and
-- apps/web/app/api/analytics/combined/route.ts.
--
-- A "reiteration" is a signal published while an earlier signal on the SAME symbol was
-- still open (prev_open_until > published_at) -- the model re-confirming a continuing
-- opportunity rather than a genuinely new, independent setup. Reiterations are recorded
-- (never dropped) but excluded from performance statistics, since counting several
-- simultaneous signals on one name as independent bets overstates total R (see the
-- deduplication analysis that motivated this: ~68% of ai_trades rows are reiterations,
-- and Total R drops from +5,387R to +1,755R once a symbol can only hold one open
-- "position" worth of signal at a time).
--
-- Deliberately computed over the FULL, unfiltered table inside this function -- the
-- window needs every row for a symbol to correctly tell whether an earlier signal was
-- still open, regardless of whatever from/to/direction/assetClass filters the caller
-- applies afterward on the function's output. Filtering before computing the window
-- would misclassify reiterations at the filter boundary (e.g. an earlier signal just
-- outside a date range could still have left a later in-range signal's "prev_open_until"
-- unset, wrongly marking a real reiteration as a fresh signal).
--
-- A live signal (exit_date is null) is treated as open indefinitely: max(exit_date)
-- over the window naturally stays null if the most recent earlier signal hasn't closed,
-- and `prev_open_until is null then false` only fires when there is no earlier signal
-- at all for that symbol (the very first signal published for it) -- not when an earlier
-- one is open-ended. A still-open earlier signal's null exit_date would make
-- max(exit_date) null too, which this CASE treats as "not a reiteration" -- WRONG for an
-- open-ended earlier signal, so null exit_date is coalesced to a sentinel far-future
-- timestamp before the max() so an open earlier signal always reads as still open.
-- ============================================================================

-- report_id is included purely as a stable secondary sort key for the callers' own
-- .range()-based pagination (published_at alone can tie across rows) -- not otherwise
-- consumed by either route.
create or replace function ai_trades_with_reiteration()
returns table (
  report_id text,
  confidence integer,
  asset_class text,
  direction text,
  status text,
  triggered boolean,
  rr numeric,
  published_at timestamptz,
  symbol text,
  asset_name text,
  is_reiteration boolean
)
language sql
stable
as $$
  with ranked as (
    select
      t.report_id, t.confidence, t.asset_class, t.direction, t.status, t.triggered, t.rr,
      t.published_at, t.symbol, t.asset_name,
      max(coalesce(t.exit_date, 'infinity'::timestamptz)) over (
        partition by t.symbol
        order by t.published_at
        rows between unbounded preceding and 1 preceding
      ) as prev_open_until
    from ai_trades t
  )
  select
    report_id, confidence, asset_class, direction, status, triggered, rr, published_at, symbol, asset_name,
    coalesce(prev_open_until > published_at, false) as is_reiteration
  from ranked
  order by published_at desc, report_id desc
$$;
