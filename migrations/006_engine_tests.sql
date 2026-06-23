-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.3 — Engine Orchestration Test Suite
-- ============================================================================
-- This version is structurally different from 004_rls_tests.sql for a
-- reason discovered the hard way: temp tables created with ON COMMIT DROP
-- did not reliably persist across statements when run via the Supabase SQL
-- Editor or `supabase db query`, which strongly suggests each statement may
-- be auto-committing individually rather than the whole script running in
-- one session/transaction the way `psql -f` does.
--
-- Fix: the entire suite is now ONE PL/pgSQL function. All fixture state
-- lives in local variables (no temp tables), every TAP result line is
-- buffered into a local array, fixtures are explicitly deleted before the
-- function returns, and the result is emitted via a single RETURN QUERY.
-- The whole test run is exactly ONE top-level statement -- nothing for an
-- autocommit-per-statement runner to lose between calls.
--
-- Run: select * from run_phase_1_3_tests();
-- Safe to run multiple times; cleans up its own fixtures on success. If it
-- errors partway through, the whole function call rolls back as a single
-- transaction.
-- ============================================================================

create or replace function run_phase_1_3_tests()
returns setof text language plpgsql as $$
declare
  v_results text[] := '{}';

  v_run_id uuid;
  v_step_market_data uuid;
  v_step_regime uuid;
  v_step_event_risk uuid;
  v_step_opportunity_gen uuid;

  v_blocked_run_id uuid;
  v_step_a uuid;
  v_step_b uuid;
  v_raised boolean := false;

  v_retry_run_id uuid;
  v_retry_step_id uuid;

  v_watchdog_run_id uuid;
  v_watchdog_step_id uuid;

  v_param_id uuid;
  v_sys_id uuid;

  v_window_start timestamptz := '2026-07-01 05:45:00+00';
  v_window_end timestamptz := '2026-07-01 06:00:00+00';
  v_first_id uuid; v_first_created boolean;
  v_second_id uuid; v_second_created boolean;
begin
  v_results := array_append(v_results, (select plan(11)));

  select service_principal_id into v_sys_id from service_principals where name = 'SYSTEM_ENGINE';

  -- --------------------------------------------------------------------
  -- Fixture: Sheet 26's fan-in example -- opportunity_generation depends
  -- on three REQUIRED predecessors.
  -- --------------------------------------------------------------------
  insert into engine_runs (run_type, session, window_start, window_end, idempotency_key,
      status, triggered_by_type, triggered_by_id)
    values ('test_europe_opportunity_generation', 'EUROPEAN', now(), now() + interval '1 hour',
            'test-fixture-key-' || gen_random_uuid()::text, 'QUEUED', 'SYSTEM', v_sys_id)
    returning engine_run_id into v_run_id;

  insert into engine_run_steps (engine_run_id, step_name, status, max_expected_duration_seconds)
    values (v_run_id, 'market_data_pre_session', 'QUEUED', 300) returning engine_run_step_id into v_step_market_data;
  insert into engine_run_steps (engine_run_id, step_name, status, max_expected_duration_seconds)
    values (v_run_id, 'regime_derivation', 'QUEUED', 300) returning engine_run_step_id into v_step_regime;
  insert into engine_run_steps (engine_run_id, step_name, status, max_expected_duration_seconds)
    values (v_run_id, 'event_risk_mapping', 'QUEUED', 300) returning engine_run_step_id into v_step_event_risk;
  insert into engine_run_steps (engine_run_id, step_name, status, max_expected_duration_seconds)
    values (v_run_id, 'opportunity_generation', 'QUEUED', 300) returning engine_run_step_id into v_step_opportunity_gen;

  insert into engine_run_step_dependencies (engine_run_step_id, depends_on_step_id, dependency_type) values
    (v_step_opportunity_gen, v_step_market_data, 'REQUIRED'),
    (v_step_opportunity_gen, v_step_regime, 'REQUIRED'),
    (v_step_opportunity_gen, v_step_event_risk, 'REQUIRED');

  -- Test 1: not ready while all predecessors QUEUED
  v_results := array_append(v_results, (select is(
    step_is_ready(v_step_opportunity_gen), false,
    'Fan-in: opportunity_generation not ready while predecessors are QUEUED'
  )));

  -- Test 2: still not ready with only 1 of 3 SUCCESS
  perform start_step(v_step_market_data);
  perform complete_step(v_step_market_data, '{"rows": 42}'::jsonb);

  v_results := array_append(v_results, (select is(
    step_is_ready(v_step_opportunity_gen), false,
    'Fan-in: opportunity_generation still not ready with only 1 of 3 predecessors SUCCESS'
  )));

  -- Test 3: ready once all 3 SUCCESS
  perform start_step(v_step_regime);
  perform complete_step(v_step_regime);
  perform start_step(v_step_event_risk);
  perform complete_step(v_step_event_risk);

  v_results := array_append(v_results, (select is(
    step_is_ready(v_step_opportunity_gen), true,
    'Fan-in: opportunity_generation ready once all 3 predecessors are SUCCESS'
  )));

  -- Test 4: get_ready_steps returns exactly this step
  v_results := array_append(v_results, (select is(
    (select count(*)::int from get_ready_steps(v_run_id) where engine_run_step_id = v_step_opportunity_gen),
    1,
    'get_ready_steps: returns the now-ready opportunity_generation step'
  )));

  -- --------------------------------------------------------------------
  -- Test 5: starting a step whose REQUIRED dependency is not SUCCESS
  -- raises an exception.
  -- --------------------------------------------------------------------
  insert into engine_runs (run_type, window_start, window_end, idempotency_key, status, triggered_by_type, triggered_by_id)
    values ('test_blocked', now(), now() + interval '1 hour', 'test-blocked-' || gen_random_uuid()::text,
            'QUEUED', 'SYSTEM', v_sys_id)
    returning engine_run_id into v_blocked_run_id;
  insert into engine_run_steps (engine_run_id, step_name, status) values (v_blocked_run_id, 'a', 'QUEUED') returning engine_run_step_id into v_step_a;
  insert into engine_run_steps (engine_run_id, step_name, status) values (v_blocked_run_id, 'b', 'QUEUED') returning engine_run_step_id into v_step_b;
  insert into engine_run_step_dependencies (engine_run_step_id, depends_on_step_id, dependency_type)
    values (v_step_b, v_step_a, 'REQUIRED');

  begin
    perform start_step(v_step_b);
  exception when others then
    v_raised := true;
  end;

  v_results := array_append(v_results, (select is(
    v_raised, true,
    'start_step: raises an exception when a REQUIRED dependency is not SUCCESS'
  )));

  -- --------------------------------------------------------------------
  -- Test 6: fail_step respects model_parameters retry ceiling.
  -- --------------------------------------------------------------------
  insert into model_parameters (parameter_group, parameter_name, parameter_value, changed_by_type, changed_by_id)
    values ('retry', 'max_retries', '{"value": 1}'::jsonb, 'SYSTEM', v_sys_id)
    returning parameter_id into v_param_id;

  insert into engine_runs (run_type, window_start, window_end, idempotency_key, status, triggered_by_type, triggered_by_id)
    values ('test_retry', now(), now() + interval '1 hour', 'test-retry-' || gen_random_uuid()::text,
            'QUEUED', 'SYSTEM', v_sys_id)
    returning engine_run_id into v_retry_run_id;
  insert into engine_run_steps (engine_run_id, step_name, status, retry_count)
    values (v_retry_run_id, 'flaky_step', 'QUEUED', 0) returning engine_run_step_id into v_retry_step_id;

  perform start_step(v_retry_step_id);
  perform fail_step(v_retry_step_id, 'first failure');

  v_results := array_append(v_results, (select is(
    (select status::text from engine_run_steps where engine_run_step_id = v_retry_step_id),
    'RETRYING',
    'fail_step: first failure with max_retries=1 goes to RETRYING'
  )));

  update engine_run_steps set status = 'RUNNING' where engine_run_step_id = v_retry_step_id;
  perform fail_step(v_retry_step_id, 'second failure');

  v_results := array_append(v_results, (select is(
    (select status::text from engine_run_steps where engine_run_step_id = v_retry_step_id),
    'FAILED',
    'fail_step: second failure at retry ceiling goes to FAILED, not RETRYING'
  )));

  v_results := array_append(v_results, (select is(
    (select count(*)::int from notifications where notification_type = 'ENGINE_FAILURE' and related_id = v_retry_step_id::text),
    1,
    'fail_step: creates exactly one ENGINE_FAILURE notification once retries exhausted'
  )));

  -- --------------------------------------------------------------------
  -- Test 7: watchdog marks a stuck RUNNING step as TIMED_OUT.
  -- --------------------------------------------------------------------
  insert into engine_runs (run_type, window_start, window_end, idempotency_key, status, triggered_by_type, triggered_by_id)
    values ('test_watchdog', now(), now() + interval '1 hour', 'test-watchdog-' || gen_random_uuid()::text,
            'QUEUED', 'SYSTEM', v_sys_id)
    returning engine_run_id into v_watchdog_run_id;
  insert into engine_run_steps (engine_run_id, step_name, status, max_expected_duration_seconds, started_at)
    values (v_watchdog_run_id, 'stuck_step', 'RUNNING', 60, now() - interval '10 minutes')
    returning engine_run_step_id into v_watchdog_step_id;

  perform watchdog_sweep_timed_out_steps();

  v_results := array_append(v_results, (select is(
    (select status::text from engine_run_steps where engine_run_step_id = v_watchdog_step_id),
    'TIMED_OUT',
    'watchdog_sweep_timed_out_steps: marks a stuck RUNNING step as TIMED_OUT'
  )));

  -- --------------------------------------------------------------------
  -- Test 8: idempotency.
  -- --------------------------------------------------------------------
  select out_engine_run_id, was_created into v_first_id, v_first_created
    from get_or_create_engine_run('test_idempotent_run', 'EUROPEAN', v_window_start, v_window_end, 'SYSTEM', v_sys_id);

  select out_engine_run_id, was_created into v_second_id, v_second_created
    from get_or_create_engine_run('test_idempotent_run', 'EUROPEAN', v_window_start, v_window_end, 'SYSTEM', v_sys_id);

  v_results := array_append(v_results, (select is(
    v_first_id = v_second_id, true,
    'get_or_create_engine_run: second call with identical run_type/session/window returns the same engine_run_id'
  )));

  v_results := array_append(v_results, (select is(
    v_second_created, false,
    'get_or_create_engine_run: was_created = false on the duplicate call'
  )));

  v_results := array_append(v_results, (select * from finish()));

  -- --------------------------------------------------------------------
  -- Cleanup: explicit deletes, since we are not relying on an outer
  -- ROLLBACK. engine_run_steps/engine_run_step_dependencies cascade from
  -- engine_runs via FK. notifications.related_id is plain text (by design,
  -- since it points at many different tables), so it does NOT cascade --
  -- clean those up explicitly or they accumulate on every test run.
  -- --------------------------------------------------------------------
  delete from notifications where related_id in (v_retry_step_id::text, v_watchdog_step_id::text);
  delete from engine_runs where run_type like 'test_%';
  delete from model_parameters where parameter_id = v_param_id;

  return query select unnest(v_results);
end;
$$;

select * from run_phase_1_3_tests();
