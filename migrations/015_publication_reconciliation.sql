-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — analyst_publications upsert + reconciliation functions
-- ============================================================================

create or replace function upsert_analyst_publication(
  p_source_system     source_system,
  p_source_record_id  text,
  p_analyst_id        uuid,
  p_market_id         uuid,
  p_published_at      timestamptz,
  p_direction         direction_type,
  p_entry numeric, p_stop numeric, p_target numeric,
  p_original_triggered boolean,
  p_import_batch_id    uuid,
  p_raw_payload        jsonb
) returns text language plpgsql as $$
declare
  v_existing_id uuid;
  v_matched_trade_id uuid;
  v_match_count int;
  v_effective_triggered boolean;
  v_status reconciliation_status;
begin
  select publication_id into v_existing_id
  from analyst_publications where source_system = p_source_system and source_record_id = p_source_record_id;

  if v_existing_id is not null then
    return 'DUPLICATE';
  end if;

  if p_original_triggered = true then
    -- Webhook already says triggered -- no reconciliation needed, nothing
    -- in actual_trades could make this MORE true.
    v_effective_triggered := true;
    v_status := 'WEBHOOK_TRUE';
    v_matched_trade_id := null;
  else
    -- Webhook says NOT triggered. Check whether the (corrected) backfill/
    -- actual_trades data disagrees, per Joe's explicit rule: actual_trades
    -- is the more correct source whenever a match exists. Match key is
    -- (date-only, market_id) -- confirmed reliable since only one trade
    -- per asset per day is published, so no price tolerance is needed.
    select count(*), (array_agg(trade_id))[1] into v_match_count, v_matched_trade_id
    from actual_trades
    where market_id = p_market_id
      and date(published_at) = date(p_published_at);

    if v_match_count = 0 then
      v_effective_triggered := false;
      v_status := 'WEBHOOK_FALSE_CONFIRMED';
      v_matched_trade_id := null;
    elsif v_match_count = 1 then
      v_effective_triggered := true;
      v_status := 'WEBHOOK_FALSE_OVERRIDDEN';
      -- v_matched_trade_id already set by the aggregate query above
    else
      -- More than one actual_trades row for this market on this date --
      -- violates the stated one-per-day assumption. Do not guess which one
      -- is the real match; flag for manual review instead.
      v_effective_triggered := false;
      v_status := 'AMBIGUOUS_MULTIPLE_MATCHES';
      v_matched_trade_id := null;
    end if;
  end if;

  insert into analyst_publications (
    source_system, source_record_id, analyst_id, market_id, published_at, direction,
    entry, stop, target, original_triggered, effective_triggered, reconciliation_status,
    matched_trade_id, import_batch_id, raw_payload
  ) values (
    p_source_system, p_source_record_id, p_analyst_id, p_market_id, p_published_at, p_direction,
    p_entry, p_stop, p_target, p_original_triggered, v_effective_triggered, v_status,
    v_matched_trade_id, p_import_batch_id, p_raw_payload
  );

  if v_status = 'AMBIGUOUS_MULTIPLE_MATCHES' then
    insert into notifications (notification_type, severity, title, message, related_table, related_id)
      values ('OTHER', 'WARNING',
              'Ambiguous publication reconciliation: multiple actual_trades match',
              format('market_id=%s, date=%s has more than one actual_trades row -- violates the one-trade-per-asset-per-day assumption. Manual review needed.', p_market_id, date(p_published_at)),
              'analyst_publications', p_source_record_id);
  end if;

  return v_status::text;
end;
$$;

-- Aggregate KPI helper: triggered rate per analyst over a date range.
-- Reads effective_triggered, never original_triggered -- this is the
-- entire point of the reconciliation step.
create or replace function get_triggered_rate(p_analyst_id uuid, p_from date, p_to date)
returns table (total_published bigint, total_triggered bigint, triggered_rate numeric)
language sql stable as $$
  select
    count(*) as total_published,
    count(*) filter (where effective_triggered) as total_triggered,
    case when count(*) = 0 then null
         else round(count(*) filter (where effective_triggered)::numeric / count(*), 4)
    end as triggered_rate
  from analyst_publications
  where analyst_id = p_analyst_id
    and date(published_at) between p_from and p_to;
$$;
