-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — Acuity Performance webhook symbol aliases (second wave)
-- ============================================================================
-- Found from the full-January test run (935 processed, 8 errors -> 7 of
-- which were these 4 distinct unmapped company names, the 8th being the
-- already-known blank-analyst-code data gap). All 4 verified directly
-- against the real markets table, same as the first wave in
-- 021_acuity_symbol_aliases_full.sql.
-- ============================================================================

insert into market_symbol_aliases (market_id, source_system, alias_symbol)
select m.market_id, 'ACUITY_PERFORMANCE_API', a.alias
from (values
  ('GOOGL', 'Alphabet'),
  ('SHOP', 'Shopify'),
  ('UBER', 'Uber Technologies'),
  ('TSLA', 'Tesla')
) as a(target_symbol, alias)
join markets m on m.symbol = a.target_symbol
on conflict (source_system, alias_symbol) do nothing;
