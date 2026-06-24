-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — market_symbol_aliases
-- ============================================================================
-- Confirmed: the Acuity Performance webhook names some markets differently
-- than the historical backfill spreadsheet did (e.g. webhook 'AU200' ==
-- spreadsheet 'ASX200'), and Joe has confirmed there will be more cases
-- like this. Same one-to-many pattern as analyst_external_codes (Phase 1.4
-- migration 010) -- one market, many source-specific symbol spellings.
--
-- Lookup order in importer code: try market_symbol_aliases for the calling
-- source_system first, fall back to markets.symbol direct match. Any symbol
-- that matches neither routes to import_errors for manual review --
-- exactly the mechanism that will surface the "more examples" as they're
-- found, rather than guessing at them in advance.
-- ============================================================================

create table market_symbol_aliases (
  market_symbol_alias_id uuid primary key default gen_random_uuid(),
  market_id     uuid not null references markets(market_id) on delete cascade,
  source_system source_system not null,
  alias_symbol  text not null,
  created_at    timestamptz not null default now(),
  constraint uq_market_symbol_alias unique (source_system, alias_symbol)
);
create index idx_market_symbol_aliases_lookup on market_symbol_aliases (source_system, alias_symbol);

comment on table market_symbol_aliases is
  'Maps source-system-specific symbol spellings to markets.market_id. E.g. Acuity Performance webhook uses AU200 for the same market the backfill spreadsheet called ASX200.';

-- Known alias, confirmed directly: webhook 'AU200' == spreadsheet 'ASX200'.
insert into market_symbol_aliases (market_id, source_system, alias_symbol)
select market_id, 'ACUITY_PERFORMANCE_API', 'AU200'
from markets where symbol = 'ASX200';
