-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 063 -- rename entry variants to direction-relative labels
-- ============================================================================
-- ZONE_BOTTOM/ZONE_MID/ZONE_TOP renamed to CONSERVATIVE/MID/AGGRESSIVE. The old
-- names described an absolute zone position (low/high), but variantEntry() in
-- runEngineSession.ts has always picked whichever edge is deeper into the
-- pullback/rally -- and therefore gives the better RR -- for the trade's own
-- direction: BUY ZONE_BOTTOM = zone low, but SELL ZONE_BOTTOM = zone high (see
-- migrations/061_strategy_learning.sql's own column comment: "ZONE_BOTTOM (BUY
-- low / SELL high)"). ZONE_BOTTOM has therefore always meant "the better-RR
-- entry" and ZONE_TOP "the worse-RR entry", regardless of direction -- CONSERVATIVE/
-- AGGRESSIVE names that behaviour directly instead of the misleading
-- zone-position name.
--
-- IMPORTANT: because the BOTTOM/TOP <-> better/worse-RR mapping is already the
-- same for both directions, this rename must NOT branch on shadow_trades.direction
-- -- ZONE_BOTTOM always becomes CONSERVATIVE and ZONE_TOP always becomes
-- AGGRESSIVE. A direction-conditional rename (mapping SELL's ZONE_TOP to
-- CONSERVATIVE and ZONE_BOTTOM to AGGRESSIVE) would invert every historical
-- SELL row's label relative to its actual stored entry price, corrupting
-- Variant Performance stats for SELL trades going forward.
-- ============================================================================

update shadow_trades
set entry_variant = case
  when entry_variant = 'ZONE_BOTTOM' then 'CONSERVATIVE'
  when entry_variant = 'ZONE_MID' then 'MID'
  when entry_variant = 'ZONE_TOP' then 'AGGRESSIVE'
  else entry_variant
end
where entry_variant in ('ZONE_BOTTOM', 'ZONE_MID', 'ZONE_TOP');

alter table shadow_trades
  alter column entry_variant set default 'MID';

comment on column shadow_trades.entry_variant is
  'CONSERVATIVE (better-RR zone edge for this trade''s direction), MID (current/single-entry behaviour), AGGRESSIVE (worse-RR zone edge). See variantEntry() in runEngineSession.ts.';
