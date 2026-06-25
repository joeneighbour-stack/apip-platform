-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — Acuity Performance webhook symbol aliases (fifth wave) +
-- 22 new equity markets
-- ============================================================================
-- Includes 'Unilever (ULVR)' / 'Nike Inc', which should have been caught in
-- wave 4 but were missed -- genuine omission, corrected here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part 1: aliases for symbols already present in markets
-- ----------------------------------------------------------------------------
insert into market_symbol_aliases (market_id, source_system, alias_symbol)
select m.market_id, 'ACUITY_PERFORMANCE_API', a.alias
from (values
  ('DIS', 'Walt Disney'),
  ('ASM', 'ASM International'),
  ('BB', 'BlackBerry'),
  ('KO', 'Coca-Cola'),
  ('INGA', 'ING Groep'),
  ('JNJ', 'Johnson and Johnson'),
  ('RR', 'Rolls Royce (RR.)'),
  ('BA', 'The Boeing Company'),
  ('ABBV', 'AbbVie'),
  ('PRX', 'Prosus'),
  ('TKWY', 'Just Eat Takeaway'),
  ('BBBY', 'Bed Bath & Beyond'),
  ('SP500', 'S&P 500 Futures'),
  ('DOCU', 'DocuSign'),
  ('NKE', 'Nike Inc'),
  ('FB', 'Facebook'),
  ('TSCO', 'Tesco')
) as a(target_symbol, alias)
join markets m on m.symbol = a.target_symbol
on conflict (source_system, alias_symbol) do nothing;

-- ----------------------------------------------------------------------------
-- Part 2: 22 genuinely new equity markets, plus their aliases
-- (verified absent from real seeded markets data, no ticker collisions)
-- ----------------------------------------------------------------------------
do $$
declare
  v_new_market record;
  v_market_id uuid;
begin
  for v_new_market in
    select * from (values
      ('ASML', 'ASML Holding'),
      ('SCHW', 'Charles Schwab Corporation'),
      ('ENGI', 'Engie'),
      ('INTU', 'Intuit'),
      ('LULU', 'Lulumelon Athletica'),
      ('MC', 'LVMH'),
      ('PANW', 'Palo Alto Networks'),
      ('GLE', 'Societe Generale'),
      ('SONO', 'Sonos Inc'),
      ('ULVR', 'Unilever (ULVR)'),
      ('AGN', 'Aegon'),
      ('AI', 'Air Liquide'),
      ('ABN', 'ABN Amro Bank'),
      ('PCG', 'PG&E Corporation'),
      ('AF', 'Air France'),
      ('AME', 'AME'),
      ('TMUS', 'TMUS'),
      ('MRK', 'Merck and Company'),
      ('NBIX', 'Neurocrine Biosciences, Inc.'),
      ('BN', 'Danone'),
      ('GLPG', 'Galapagos'),
      ('HL', 'Hecla Mining Company')
    ) as t(new_symbol, webhook_alias)
  loop
    insert into markets (symbol, asset_class, active, excluded)
      values (v_new_market.new_symbol, 'EQUITY', true, false)
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
