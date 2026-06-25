-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — Acuity Performance webhook symbol aliases (third wave) +
-- 11 genuinely new equity markets discovered during the full 2022-2026 pull
-- ============================================================================
-- 27 of the 38 unmapped symbols from the full historical run were already
-- present in our 217 seeded markets (verified against the real data, same
-- discipline as waves 1 and 2) and just need an alias. The remaining 11
-- (Ford, HP Inc, New York Times Co, JPMorgan Chase, Procter and Gamble Co,
-- Dollar General, Morgan Stanley, Bristol-Myers Squibb Co, General Electric
-- Company, Abbott Labratories, Humana Inc) genuinely never appeared in the
-- original spreadsheet's 217 distinct symbols under any spelling -- these
-- are real new markets, not aliasing gaps, and are created fresh here.
--
-- SSE Comp / SSE COMP: per Joe, this market was once covered by Acuity but
-- no longer is. Existing market row is left as-is (active/excluded flags
-- unchanged) -- this is purely a naming alias so historical publications
-- attribute correctly, not a statement about whether it's still tradable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part 1: aliases for symbols already present in markets
-- ----------------------------------------------------------------------------
insert into market_symbol_aliases (market_id, source_system, alias_symbol)
select m.market_id, 'ACUITY_PERFORMANCE_API', a.alias
from (values
  ('SSE COMP', 'SSE Comp'),
  ('PLTR', 'Palantir Technology'),
  ('AMZN', 'Amazon'),
  ('AAPL', 'Apple'),
  ('MSFT', 'Microsoft'),
  ('NVDA', 'NVIDIA'),
  ('AMD', 'Advanced Micro Devices'),
  ('COIN', 'Coinbase'),
  ('PFE', 'Pfizer'),
  ('NFLX', 'Netflix'),
  ('CSCO', 'Cisco Systems'),
  ('PLUG', 'Plug Power'),
  ('MU', 'Micron Technology'),
  ('GME', 'GameStop'),
  ('MRNA', 'Moderna'),
  ('PYPL', 'PayPal'),
  ('AIR', 'Airbus'),
  ('EZJ', 'EasyJet'),
  ('DHER', 'Delivery Hero'),
  ('MA', 'Mastercard'),
  ('V', 'Visa'),
  ('MT', 'ArcelorMittal'),
  ('FCEL', 'FuelCell Energy'),
  ('BYND', 'Beyond Meat'),
  ('BARC', 'Barclays'),
  ('INTC', 'Intel Corporation'),
  ('CRM', 'Salesforce'),
  ('RBLX', 'Roblox')
) as a(target_symbol, alias)
join markets m on m.symbol = a.target_symbol
on conflict (source_system, alias_symbol) do nothing;

-- ----------------------------------------------------------------------------
-- Part 2: 11 genuinely new equity markets, plus their aliases
-- ----------------------------------------------------------------------------
do $$
declare
  v_new_market record;
  v_market_id uuid;
begin
  for v_new_market in
    select * from (values
      ('F', 'Ford'),
      ('HPQ', 'HP Inc'),
      ('NYT', 'New York Times Co'),
      ('JPM', 'JPMorgan Chase'),
      ('PG', 'Procter and Gamble Co'),
      ('DG', 'Dollar General'),
      ('MS', 'Morgan Stanley'),
      ('BMY', 'Bristol-Myers Squibb Co'),
      ('GE', 'General Electric Company'),
      ('ABT', 'Abbott Labratories'),
      ('HUM', 'Humana Inc')
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
