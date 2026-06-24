-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — Merge 'Brent Oil' market into 'Brent' (Joe confirmed: same instrument)
-- ============================================================================
-- The original spreadsheet backfill created two separate markets ('Brent',
-- 351 rows, and 'Brent Oil', 71 rows) for what Joe has confirmed is the same
-- underlying instrument. This migration repoints every reference from the
-- 'Brent Oil' market_id to the 'Brent' market_id, then soft-disables the
-- now-redundant row (active=false, excluded=true) rather than deleting it --
-- preserving the audit trail of "this market existed and was merged" rather
-- than erasing it outright. 021_acuity_symbol_aliases_full.sql already
-- routes the webhook's future "Brent Oil" symbol to the 'Brent' market_id
-- directly, so no alias cleanup is needed here.
-- ============================================================================

do $$
declare
  v_brent_id uuid;
  v_brent_oil_id uuid;
  v_actual_trades_updated int;
  v_publications_updated int;
begin
  select market_id into v_brent_id from markets where symbol = 'Brent';
  select market_id into v_brent_oil_id from markets where symbol = 'Brent Oil';

  if v_brent_id is null or v_brent_oil_id is null then
    raise exception 'Could not find both Brent and Brent Oil markets -- aborting merge rather than guessing. brent_id=%, brent_oil_id=%', v_brent_id, v_brent_oil_id;
  end if;

  update actual_trades set market_id = v_brent_id where market_id = v_brent_oil_id;
  get diagnostics v_actual_trades_updated = row_count;

  update analyst_publications set market_id = v_brent_id where market_id = v_brent_oil_id;
  get diagnostics v_publications_updated = row_count;

  -- Defensive coverage of other market_id-referencing tables, harmless if
  -- zero rows match (none of these should be populated for this market yet,
  -- but covering them now avoids a silent gap if that changes later).
  update market_state_daily set market_id = v_brent_id where market_id = v_brent_oil_id;
  update market_event_risk set market_id = v_brent_id where market_id = v_brent_oil_id;
  update opportunities set market_id = v_brent_id where market_id = v_brent_oil_id;
  -- coverage_allocation has no market_id column directly (only via its
  -- linked opportunity, already covered above) -- no statement needed here.

  -- Soft-disable rather than delete -- preserves the historical record that
  -- this market existed and was merged, rather than erasing it.
  update markets set active = false, excluded = true where market_id = v_brent_oil_id;

  raise notice 'Merge complete: % actual_trades rows and % analyst_publications rows repointed from Brent Oil (%) to Brent (%).',
    v_actual_trades_updated, v_publications_updated, v_brent_oil_id, v_brent_id;
end $$;
