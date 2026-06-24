-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — Acuity Performance webhook symbol aliases (fourth wave) +
-- 16 more new markets discovered in the full 2022-2026 pull
-- ============================================================================
-- IMPORTANT: 'Axa' is deliberately NOT aliased to the existing 'CS' market.
-- Joe confirmed the existing CS market row is Credit Suisse, not Axa --
-- despite AXA and Credit Suisse having historically used similar-looking
-- ticker letters on different real-world exchanges, which would have been
-- exactly the kind of silent, consequential mixup this whole alias-review
-- process exists to prevent. Axa gets its own new market with the
-- unambiguous symbol 'AXA'.
--
-- 'Solutions 30' is deliberately OMITTED from this migration -- the real
-- ticker was not confirmed, and it is not worth guessing at for a company
-- this is the first time appearing. Pick this up in a future wave once
-- confirmed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part 1: aliases for symbols already present in markets
-- ----------------------------------------------------------------------------
insert into market_symbol_aliases (market_id, source_system, alias_symbol)
select m.market_id, 'ACUITY_PERFORMANCE_API', a.alias
from (values
  ('NKE', 'Nike'),
  ('JD', 'JD.com'),
  ('TWTR', 'Twitter'),
  ('ATVI', 'Activision'),
  ('SAN', 'Sanofi'),
  ('CA', 'Carrefour'),
  ('STM', 'ST Micro Electrics'),
  ('RNO', 'Renault'),
  ('FB', 'Meta'),
  ('QCOM', 'Qualcomm'),
  ('WFC', 'Wells Fargo'),
  ('LHA', 'Lufthansa'),
  ('ALO', 'Alstom'),
  ('ADBE', 'Adobe'),
  ('LLOY', 'Lloyds Bank'),
  ('NOK', 'Nokia Corporation'),
  ('AD', 'Koninklike Ahold Delhaize'),
  ('ABI', 'AB Inbev'),
  ('BNP', 'BNP Paribas'),
  ('BAYN', 'Bayer AG'),
  ('BP', 'BP. (BP.)'),
  ('Binance Coin', 'BNBUSD')
) as a(target_symbol, alias)
join markets m on m.symbol = a.target_symbol
on conflict (source_system, alias_symbol) do nothing;

-- ----------------------------------------------------------------------------
-- Part 2: 16 genuinely new markets, plus their aliases
-- ----------------------------------------------------------------------------
do $$
declare
  v_new_market record;
  v_market_id uuid;
begin
  for v_new_market in
    select * from (values
      ('GM', 'General Motors Company', 'EQUITY'),
      ('ZM', 'Zoom', 'EQUITY'),
      ('XOM', 'Exxon Mobile', 'EQUITY'),
      ('CVX', 'Chevron Corporation', 'EQUITY'),
      ('DBX', 'Dropbox', 'EQUITY'),
      ('TTD', 'The Trade Desk', 'EQUITY'),
      ('T', 'AT&T', 'EQUITY'),
      ('LMT', 'Lockheed Martin Corporation', 'EQUITY'),
      ('WM', 'Waste Management, Inc', 'EQUITY'),
      ('BIDU', 'Baidu', 'EQUITY'),
      ('AAL', 'American Airlines', 'EQUITY'),
      ('HD', 'Home Depot Inc', 'EQUITY'),
      ('BLK', 'BLACKROCK', 'EQUITY'),
      ('LYFT', 'LYFT Inc', 'EQUITY'),
      ('CADCHF', 'CADCHF', 'FX'),
      ('AXA', 'Axa', 'EQUITY')
    ) as t(new_symbol, webhook_alias, asset_class)
  loop
    insert into markets (symbol, asset_class, active, excluded)
      values (v_new_market.new_symbol, v_new_market.asset_class, true, false)
      on conflict (symbol) do nothing
      returning market_id into v_market_id;

    if v_market_id is null then
      select market_id into v_market_id from markets where symbol = v_new_market.new_symbol;
    end if;

    insert into market_symbol_aliases (market_id, source_system, alias_symbol)
      values (v_market_id, 'ACUITY_PERFORMANCE_API', v_new_market.webhook_alias)
      on conflict (source_system, alias_symbol) do nothing;
  end loop;
end $$;
