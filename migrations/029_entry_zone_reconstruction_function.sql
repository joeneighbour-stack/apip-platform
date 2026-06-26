-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.5 Step 2a — apply_historical_entry_zone write function
-- ============================================================================
-- Per Architecture V1.1 Section 4.2. Writes go through a named function,
-- same pattern as every Phase 1.4 upsert_*/record_* function -- never a raw
-- UPDATE scattered across application code.
-- ============================================================================

create or replace function apply_historical_entry_zone(
  p_trade_id uuid,
  p_entry_zone atr_zone
) returns void language plpgsql as $$
begin
  update actual_trades
    set entry_zone = p_entry_zone,
        entry_zone_source = 'HISTORICAL_RECONSTRUCTED'
    where trade_id = p_trade_id
      and entry_zone is null; -- idempotent: never overwrites an existing zone
                                -- (live-computed or a prior reconstruction run),
                                -- safe to re-run this script without risk of
                                -- clobbering anything.

  if not found then
    raise warning 'apply_historical_entry_zone: no update applied for trade_id % (either it does not exist, or entry_zone was already set)', p_trade_id;
  end if;
end;
$$;
