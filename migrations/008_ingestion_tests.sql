-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — API Ingestion Test Suite
-- ============================================================================
-- Same shape as 006_engine_tests.sql: one self-contained function, all
-- fixture state in local variables, results buffered into an array,
-- explicit cleanup before returning. Run as: select * from run_phase_1_4_tests();
-- ============================================================================

create or replace function run_phase_1_4_tests()
returns setof text language plpgsql as $$
declare
  v_results text[] := '{}';
  v_sys_id uuid;
  v_market_id uuid;
  v_analyst_id uuid;

  v_batch_id uuid;
  v_trade_result text;

  v_event_result1 text;
  v_event_result2 text;
  v_event_id uuid;
  v_revision_count int;

  v_mismatch_batch_id uuid;
  v_mismatch_status text;
  v_notification_count int;
begin
  v_results := array_append(v_results, (select plan(8)));

  select service_principal_id into v_sys_id from service_principals where name = 'ACUITY_PERFORMANCE_IMPORTER';
  insert into markets (symbol, asset_class) values ('TEST_EURUSD_' || gen_random_uuid()::text, 'FX') returning market_id into v_market_id;
  insert into analysts (display_name) values ('Test Ingestion Analyst') returning analyst_id into v_analyst_id;

  -- --------------------------------------------------------------------
  -- Test 1: upsert_actual_trade INSERTED on first call
  -- --------------------------------------------------------------------
  v_batch_id := start_import_batch('ACUITY_PERFORMANCE_API', 'actual_trades', 'INCREMENTAL_API_SYNC', 'SYSTEM', v_sys_id);

  select upsert_actual_trade(
    'ACUITY_PERFORMANCE_API', 'test-trade-001', false, v_batch_id,
    null, null, now(), v_analyst_id, v_market_id, 'EUROPEAN', 'BUY',
    1.0850, 1.0830, 1.0900, null, true, null, null, '{"test": true}'::jsonb
  ) into v_trade_result;

  v_results := array_append(v_results, (select is(
    v_trade_result, 'INSERTED', 'upsert_actual_trade: first call with a new source_record_id inserts'
  )));

  -- --------------------------------------------------------------------
  -- Test 2: same (source_system, source_record_id) on second call returns
  -- DUPLICATE and does NOT create a second row.
  -- --------------------------------------------------------------------
  select upsert_actual_trade(
    'ACUITY_PERFORMANCE_API', 'test-trade-001', false, v_batch_id,
    null, null, now(), v_analyst_id, v_market_id, 'EUROPEAN', 'BUY',
    1.0850, 1.0830, 1.0900, null, true, now(), 1.5, '{"test": true, "closed": true}'::jsonb
  ) into v_trade_result;

  v_results := array_append(v_results, (select is(
    v_trade_result, 'DUPLICATE', 'upsert_actual_trade: second call with same source_record_id returns DUPLICATE'
  )));

  v_results := array_append(v_results, (select is(
    (select count(*)::int from actual_trades where source_system = 'ACUITY_PERFORMANCE_API' and source_record_id = 'test-trade-001'),
    1,
    'upsert_actual_trade: duplicate call does not create a second row'
  )));

  -- --------------------------------------------------------------------
  -- Test 3: economic calendar revision tracking
  -- --------------------------------------------------------------------
  select upsert_economic_calendar_event(
    'ACUITY_CALENDAR_API', 'test-event-001', 'src-001', now() + interval '1 day',
    'US', 'USD', 'Test NFP', 'HIGH', '200K', '180K', null, v_batch_id, '{"test": true}'::jsonb
  ) into v_event_result1;

  v_results := array_append(v_results, (select is(
    v_event_result1, 'INSERTED', 'upsert_economic_calendar_event: first call inserts'
  )));

  select event_id into v_event_id from economic_calendar_events
    where source_system = 'ACUITY_CALENDAR_API' and source_record_id = 'test-event-001';

  select upsert_economic_calendar_event(
    'ACUITY_CALENDAR_API', 'test-event-001', 'src-001', now() + interval '1 day',
    'US', 'USD', 'Test NFP', 'HIGH', '200K', '180K', '215K', v_batch_id, '{"test": true, "actual_published": true}'::jsonb
  ) into v_event_result2;

  v_results := array_append(v_results, (select is(
    v_event_result2, 'REVISED', 'upsert_economic_calendar_event: changed actual value returns REVISED'
  )));

  select count(*)::int into v_revision_count from economic_event_revisions where event_id = v_event_id;

  v_results := array_append(v_results, (select is(
    v_revision_count, 1,
    'upsert_economic_calendar_event: REVISED call archives exactly one prior-state row'
  )));

  -- --------------------------------------------------------------------
  -- Test 4: reconciliation mismatch forces FAILED + CRITICAL notification
  -- --------------------------------------------------------------------
  v_mismatch_batch_id := start_import_batch('FINNHUB', 'market_state_daily', 'INCREMENTAL_API_SYNC', 'SYSTEM',
    (select service_principal_id from service_principals where name = 'FINNHUB_IMPORTER'));
  perform record_import_success(v_mismatch_batch_id);
  perform finalize_import_batch(v_mismatch_batch_id, 5);

  select status::text into v_mismatch_status from import_batches where import_batch_id = v_mismatch_batch_id;

  v_results := array_append(v_results, (select is(
    v_mismatch_status, 'FAILED',
    'finalize_import_batch: reconciliation mismatch forces status to FAILED'
  )));

  select count(*)::int into v_notification_count from notifications
    where related_table = 'import_batches' and related_id = v_mismatch_batch_id::text and severity = 'CRITICAL';

  v_results := array_append(v_results, (select is(
    v_notification_count, 1,
    'finalize_import_batch: reconciliation mismatch creates exactly one CRITICAL notification'
  )));

  -- --------------------------------------------------------------------
  -- Cleanup
  -- --------------------------------------------------------------------
  delete from economic_event_revisions where event_id = v_event_id;
  delete from economic_calendar_events where event_id = v_event_id;
  delete from actual_trades where source_system = 'ACUITY_PERFORMANCE_API' and source_record_id = 'test-trade-001';
  delete from notifications where related_table = 'import_batches' and related_id = v_mismatch_batch_id::text;
  delete from import_batches where import_batch_id in (v_batch_id, v_mismatch_batch_id);
  delete from analysts where analyst_id = v_analyst_id;
  delete from markets where market_id = v_market_id;

  v_results := array_append(v_results, (select * from finish()));

  return query select unnest(v_results);
end;
$$;

select * from run_phase_1_4_tests();
