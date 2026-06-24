-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — Acuity Performance webhook symbol aliases (full set)
-- ============================================================================
-- Confirmed with Joe against the real markets table (company tickers
-- verified directly; index/commodity/crypto names confirmed via standard
-- naming conventions). Supersedes the single AU200 alias from
-- 017_market_symbol_aliases.sql with the full set found from one week of
-- real webhook data (2026-01-25 to 2026-02-01, 19 distinct unmapped symbols).
--
-- KNOWN OPEN ISSUE (flagged, not resolved here): the existing markets table
-- has both 'Brent' (351 backfilled rows) and 'Brent Oil' (71 backfilled
-- rows) as SEPARATE markets from the original spreadsheet import. Per Joe,
-- webhook symbol 'Brent Oil' should alias to 'Brent' going forward -- but
-- the 71 already-backfilled actual_trades rows still sit under the
-- separate 'Brent Oil' market_id. Left as-is pending an explicit decision
-- on whether to merge that historical data.
-- ============================================================================

insert into market_symbol_aliases (market_id, source_system, alias_symbol)
select m.market_id, 'ACUITY_PERFORMANCE_API', a.alias
from (values
  ('DAX', 'GER40'),
  ('FTSE', 'UK100'),
  ('CAC', 'FRA40'),
  ('NIKKEI', 'NIK225'),
  ('CHINA A50', 'CHN50'),
  ('DOW', 'US30'),
  ('NASDAQ', 'US100'),
  ('SP500', 'US500'),
  ('Natural Gas', 'NatGas'),
  ('Copper', 'XCUUSD'),
  ('Ripple', 'XRP'),
  ('Oil', 'WTI'),
  ('Brent', 'Brent Oil'),  -- webhook's "Brent Oil" -> existing "Brent" market (see open issue note above)
  ('BABA', 'Alibaba'),
  ('BAC', 'Bank of America Corp'),
  ('CMA', 'Comerica Incorporated'),
  ('PTON', 'Peloton'),
  ('SNAP', 'Snap'),
  ('SBUX', 'Starbucks'),
  ('W', 'Wayfair Inc')
) as a(target_symbol, alias)
join markets m on m.symbol = a.target_symbol
on conflict (source_system, alias_symbol) do nothing;
