-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — API Ingestion Functions
-- ============================================================================
-- Same discipline as Phase 1.3: the database owns dedup, reconciliation, and
-- revision-tracking logic as atomic functions. The actual HTTP calls to
-- Finnhub / Acuity Calendar / Acuity Performance live in application code
-- (Edge Functions / Python workers per Sheet 33) and call these functions --
-- they never reimplement the upsert or dedup logic themselves. That's what
-- keeps a credential-handling bug or a retry-duplicate bug from being able
-- to corrupt actual_trades/economic_calendar_events even if the calling
-- code has a mistake in it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Import batch lifecycle (Sheet 41 workflow steps 2-6)
-- ----------------------------------------------------------------------------

create or replace function start_import_batch(
  p_source_system     source_system,
  p_target_table      text,
  p_batch_type        import_batch_type,
  p_triggered_by_type actor_type,
  p_triggered_by_id   uuid,
  p_date_range_start  timestamptz default null,
  p_date_range_end    timestamptz default null
) returns uuid language plpgsql as $$
declare
  v_batch_id uuid;
begin
  insert into import_batches (source_system, target_table, batch_type, triggered_by_type,
      triggered_by_id, date_range_start, date_range_end, status, started_at)
    values (p_source_system, p_target_table, p_batch_type, p_triggered_by_type,
            p_triggered_by_id, p_date_range_start, p_date_range_end, 'RUNNING', now())
    returning import_batch_id into v_batch_id;
  return v_batch_id;
end;
$$;

create or replace function record_import_error(
  p_import_batch_id  uuid,
  p_source_record_id text,
  p_error_type       import_error_type,
  p_error_detail     text,
  p_raw_payload      jsonb
) returns void language plpgsql as $$
begin
  insert into import_errors (import_batch_id, source_record_id, error_type, error_detail, raw_payload)
    values (p_import_batch_id, p_source_record_id, p_error_type, p_error_detail, p_raw_payload);
  update import_batches set error_rows = error_rows + 1 where import_batch_id = p_import_batch_id;
end;
$$;

create or replace function record_import_duplicate(p_import_batch_id uuid)
returns void language plpgsql as $$
begin
  update import_batches set duplicate_rows = duplicate_rows + 1 where import_batch_id = p_import_batch_id;
end;
$$;

create or replace function record_import_success(p_import_batch_id uuid)
returns void language plpgsql as $$
begin
  update import_batches set success_rows = success_rows + 1 where import_batch_id = p_import_batch_id;
end;
$$;

-- Finalize a batch: set total_rows, mark status, and run the reconciliation
-- check from Sheet 41 step 6 (total = success + duplicate + error). On
-- mismatch, raises a CRITICAL notification and sets status FAILED rather
-- than SUCCESS, regardless of what the caller intended -- the reconciliation
-- check overrides the caller's claimed status because an unreconciled batch
-- cannot be trusted to be SUCCESS even if every individual row insert
-- appeared to work.
create or replace function finalize_import_batch(p_import_batch_id uuid, p_total_rows int)
returns void language plpgsql as $$
declare
  v_success int; v_duplicate int; v_error int;
  v_source_system source_system; v_target_table text;
begin
  select success_rows, duplicate_rows, error_rows, source_system, target_table
    into v_success, v_duplicate, v_error, v_source_system, v_target_table
    from import_batches where import_batch_id = p_import_batch_id;

  update import_batches set total_rows = p_total_rows, finished_at = now() where import_batch_id = p_import_batch_id;

  if p_total_rows = v_success + v_duplicate + v_error then
    update import_batches set status = 'SUCCESS' where import_batch_id = p_import_batch_id;
  else
    update import_batches set status = 'FAILED' where import_batch_id = p_import_batch_id;
    insert into notifications (notification_type, severity, title, message, related_table, related_id)
      values ('IMPORT_FAILURE', 'CRITICAL',
              'Import reconciliation mismatch: ' || v_source_system::text || ' -> ' || v_target_table,
              format('Batch %s reported total_rows=%s but success(%s)+duplicate(%s)+error(%s)=%s. Do not trust this batch as complete.',
                     p_import_batch_id, p_total_rows, v_success, v_duplicate, v_error, v_success + v_duplicate + v_error),
              'import_batches', p_import_batch_id::text);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. actual_trades upsert with dedup
-- ----------------------------------------------------------------------------
-- Returns 'INSERTED' or 'DUPLICATE' so the caller can route to
-- record_import_success / record_import_duplicate without re-querying.
-- The historical-backfill-no-recommendation-link rule is already enforced
-- as a CHECK constraint on actual_trades (Phase 1.1), so a caller mistake
-- there fails loudly at the DB layer regardless of what this function does.
-- ----------------------------------------------------------------------------

create or replace function upsert_actual_trade(
  p_source_system    source_system,
  p_source_record_id text,
  p_historical_backfill boolean,
  p_import_batch_id  uuid,
  p_opportunity_id    uuid,
  p_recommendation_version_id uuid,
  p_published_at      timestamptz,
  p_analyst_id         uuid,
  p_market_id          uuid,
  p_session            session_type,
  p_direction          direction_type,
  p_entry numeric, p_stop numeric, p_target numeric, p_expiry timestamptz,
  p_triggered boolean, p_closed_at timestamptz, p_result_r numeric,
  p_raw_payload jsonb
) returns text language plpgsql as $$
declare
  v_existing_id uuid;
begin
  select trade_id into v_existing_id
  from actual_trades where source_system = p_source_system and source_record_id = p_source_record_id;

  if v_existing_id is not null then
    -- Update mutable fields (an open trade can close, results can resolve)
    -- but never change source_system/source_record_id/historical_backfill --
    -- those identify what this row IS, not its current state.
    update actual_trades set
      published_at = p_published_at, triggered = p_triggered, closed_at = p_closed_at,
      result_r = p_result_r, raw_payload = p_raw_payload
      where trade_id = v_existing_id;
    return 'DUPLICATE';
  end if;

  insert into actual_trades (source_system, source_record_id, historical_backfill, import_batch_id,
      opportunity_id, recommendation_version_id, published_at, analyst_id, market_id, session,
      direction, entry, stop, target, expiry, triggered, closed_at, result_r, raw_payload)
    values (p_source_system, p_source_record_id, p_historical_backfill, p_import_batch_id,
            p_opportunity_id, p_recommendation_version_id, p_published_at, p_analyst_id, p_market_id, p_session,
            p_direction, p_entry, p_stop, p_target, p_expiry, p_triggered, p_closed_at, p_result_r, p_raw_payload);
  return 'INSERTED';
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. economic_calendar_events upsert with revision tracking
-- ----------------------------------------------------------------------------
-- If forecast/previous/actual differ from what's currently stored, archive
-- the OLD values into economic_event_revisions before overwriting, and bump
-- revision_number. This is what lets a recommendation_version's snapshot
-- remain meaningful even after a provider revises NFP/CPI numbers later.
-- ----------------------------------------------------------------------------

create or replace function upsert_economic_calendar_event(
  p_source_system   source_system,
  p_source_record_id text,
  p_source_event_id  text,
  p_event_time_uk    timestamptz,
  p_country          text,
  p_currency         text,
  p_event_name       text,
  p_impact           event_impact,
  p_forecast         text,
  p_previous         text,
  p_actual           text,
  p_import_batch_id  uuid,
  p_raw_payload      jsonb
) returns text language plpgsql as $$
declare
  v_existing record;
  v_changed boolean;
begin
  select event_id, forecast, previous, actual, revision_number into v_existing
  from economic_calendar_events
  where source_system = p_source_system and source_record_id = p_source_record_id;

  if v_existing.event_id is null then
    insert into economic_calendar_events (source_system, source_event_id, source_record_id,
        event_time_uk, country, currency, event_name, impact, forecast, previous, actual,
        revision_number, last_updated_at, import_batch_id, imported_at, raw_payload)
      values (p_source_system, p_source_event_id, p_source_record_id, p_event_time_uk, p_country,
              p_currency, p_event_name, p_impact, p_forecast, p_previous, p_actual,
              0, now(), p_import_batch_id, now(), p_raw_payload);
    return 'INSERTED';
  end if;

  v_changed := (coalesce(v_existing.forecast,'') <> coalesce(p_forecast,''))
            or (coalesce(v_existing.previous,'') <> coalesce(p_previous,''))
            or (coalesce(v_existing.actual,'')   <> coalesce(p_actual,''));

  if v_changed then
    -- Archive the values as they stood before this update -- this is what
    -- "what the analyst actually saw at the time" depends on downstream.
    insert into economic_event_revisions (event_id, revision_number, captured_at, forecast, previous, actual, raw_payload)
      values (v_existing.event_id, v_existing.revision_number, now(), v_existing.forecast, v_existing.previous, v_existing.actual, p_raw_payload);

    update economic_calendar_events set
      forecast = p_forecast, previous = p_previous, actual = p_actual,
      revision_number = v_existing.revision_number + 1, last_updated_at = now(),
      import_batch_id = p_import_batch_id, imported_at = now(), raw_payload = p_raw_payload
      where event_id = v_existing.event_id;
    return 'REVISED';
  else
    update economic_calendar_events set imported_at = now() where event_id = v_existing.event_id;
    return 'DUPLICATE';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. market_state_daily upsert (no revision tracking needed -- a given
-- market/date's OHLC is restated, not revised, per provider conventions)
-- ----------------------------------------------------------------------------

create or replace function upsert_market_state_daily(
  p_market_id uuid, p_date date, p_open numeric, p_high numeric, p_low numeric,
  p_close numeric, p_atr14 numeric, p_zone atr_zone,
  p_source_system source_system, p_source_record_id text,
  p_import_batch_id uuid, p_raw_payload jsonb
) returns text language plpgsql as $$
declare v_existing_id uuid;
begin
  select market_state_id into v_existing_id from market_state_daily
    where market_id = p_market_id and date = p_date;

  if v_existing_id is not null then
    update market_state_daily set
      open = p_open, high = p_high, low = p_low, close = p_close, atr14 = p_atr14, zone = p_zone,
      source_record_id = p_source_record_id, import_batch_id = p_import_batch_id,
      imported_at = now(), raw_payload = p_raw_payload
      where market_state_id = v_existing_id;
    return 'UPDATED';
  end if;

  insert into market_state_daily (market_id, date, open, high, low, close, atr14, zone,
      source_system, source_record_id, import_batch_id, imported_at, raw_payload)
    values (p_market_id, p_date, p_open, p_high, p_low, p_close, p_atr14, p_zone,
            p_source_system, p_source_record_id, p_import_batch_id, now(), p_raw_payload);
  return 'INSERTED';
end;
$$;
