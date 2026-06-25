-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — Fix S30 misclassification + Solutions 30 alias
-- ============================================================================
-- The original spreadsheet's S30 (2 occurrences) was classified as INDEX by
-- the automated heuristic in markets_classification_review.csv -- Joe has
-- now confirmed S30 is actually Solutions 30, a French equity, not an
-- index. Same instrument, wrong asset_class. Corrected here, plus the
-- webhook alias mapping 'Solutions 30' -> the existing S30 market.
-- ============================================================================

update markets set asset_class = 'EQUITY' where symbol = 'S30';

insert into market_symbol_aliases (market_id, source_system, alias_symbol)
select market_id, 'ACUITY_PERFORMANCE_API', 'Solutions 30'
from markets where symbol = 'S30'
on conflict (source_system, alias_symbol) do nothing;
