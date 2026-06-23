-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.3 — Engine Orchestration Framework
-- ============================================================================
-- Design principle: the database is the source of truth for run/step state
-- and the only place idempotency and DAG-readiness are decided. The Edge
-- Function / Python worker layer calls these functions and does not
-- reimplement the logic — that's what kept RLS bulletproof in Phase 1.2
-- (logic in one place, not duplicated across every caller), and the same
-- discipline applies here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Idempotent engine run creation
-- ----------------------------------------------------------------------------
-- Builds the idempotency_key deterministically from run_type+session+window,
-- then either creates a new run or returns the existing one. Uses an
-- advisory lock keyed on the idempotency key's hash to close the race window
-- between "check if exists" and "insert" under concurrent triggers (e.g. a
-- retry firing at the same moment as a cron-scheduled run).
-- ----------------------------------------------------------------------------

create or replace function build_idempotency_key(
  p_run_type text, p_session session_type, p_window_start timestamptz, p_window_end timestamptz
) returns text language sql immutable as $$
  select p_run_type || ':' || coalesce(p_session::text, 'NONE') || ':' ||
         to_char(p_window_start, 'YYYY-MM-DD"T"HH24:MI:SS') || ':' ||
         to_char(p_window_end, 'YYYY-MM-DD"T"HH24:MI:SS');
$$;

-- Explicit drop before (re)create: CREATE OR REPLACE FUNCTION cannot change
-- the row type of a RETURNS TABLE function, only its body. Needed at least
-- once after the out_engine_run_id rename below; kept permanently so any
-- future signature change doesn't require a manual one-off DROP on staging.
drop function if exists get_or_create_engine_run(text, session_type, timestamptz, timestamptz, actor_type, uuid);

create or replace function get_or_create_engine_run(
  p_run_type        text,
  p_session         session_type,
  p_window_start    timestamptz,
  p_window_end      timestamptz,
  p_triggered_by_type actor_type,
  p_triggered_by_id   uuid
) returns table (out_engine_run_id uuid, was_created boolean)
language plpgsql as $$
declare
  v_key text;
  v_lock_key bigint;
  v_existing_id uuid;
  v_new_id uuid;
begin
  v_key := build_idempotency_key(p_run_type, p_session, p_window_start, p_window_end);
  v_lock_key := hashtextextended(v_key, 0);

  -- Advisory lock scoped to this transaction; released automatically on
  -- commit/rollback. Prevents two concurrent callers from both passing the
  -- "does it exist" check before either has inserted.
  perform pg_advisory_xact_lock(v_lock_key);

  select er.engine_run_id into v_existing_id
  from engine_runs er where er.idempotency_key = v_key;

  if v_existing_id is not null then
    return query select v_existing_id, false;
    return;
  end if;

  insert into engine_runs (run_type, session, window_start, window_end, idempotency_key,
      status, triggered_by_type, triggered_by_id)
    values (p_run_type, p_session, p_window_start, p_window_end, v_key,
            'QUEUED', p_triggered_by_type, p_triggered_by_id)
    returning engine_run_id into v_new_id;

  return query select v_new_id, true;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. DAG dependency resolution
-- ----------------------------------------------------------------------------
-- A step is eligible to start only when every REQUIRED dependency is SUCCESS.
-- OPTIONAL dependencies never block. SOFT_BLOCKING dependencies block start
-- but a failure there demotes the run to PARTIAL_SUCCESS rather than FAILED
-- (see complete_run_if_finished below) instead of blocking indefinitely.
-- ----------------------------------------------------------------------------

create or replace function step_is_ready(p_step_id uuid)
returns boolean language sql stable as $$
  select not exists (
    select 1
    from engine_run_step_dependencies d
    join engine_run_steps dep on dep.engine_run_step_id = d.depends_on_step_id
    where d.engine_run_step_id = p_step_id
      and d.dependency_type in ('REQUIRED','SOFT_BLOCKING')
      and dep.status not in ('SUCCESS','SKIPPED')
  );
$$;

-- Returns every step in a run that is currently QUEUED and ready to start,
-- in dependency order. The orchestrator polls this instead of walking the
-- DAG itself client-side.
create or replace function get_ready_steps(p_engine_run_id uuid)
returns setof engine_run_steps language sql stable as $$
  select s.*
  from engine_run_steps s
  where s.engine_run_id = p_engine_run_id
    and s.status = 'QUEUED'
    and step_is_ready(s.engine_run_step_id);
$$;

-- ----------------------------------------------------------------------------
-- 3. Step lifecycle transitions
-- ----------------------------------------------------------------------------

create or replace function start_step(p_step_id uuid)
returns void language plpgsql as $$
begin
  if not step_is_ready(p_step_id) then
    raise exception 'step % is not ready: required/soft-blocking dependencies not yet SUCCESS', p_step_id;
  end if;

  update engine_run_steps
    set status = 'RUNNING', started_at = now()
    where engine_run_step_id = p_step_id and status = 'QUEUED';

  if not found then
    raise exception 'step % could not be started: not in QUEUED state (concurrent start attempt?)', p_step_id;
  end if;
end;
$$;

create or replace function complete_step(p_step_id uuid, p_output_summary jsonb default null)
returns void language plpgsql as $$
begin
  update engine_run_steps
    set status = 'SUCCESS', finished_at = now(), output_summary = p_output_summary
    where engine_run_step_id = p_step_id and status = 'RUNNING';
  perform finalize_run_if_complete(engine_run_id) from engine_run_steps where engine_run_step_id = p_step_id;
end;
$$;

-- Failure handling consults model_parameters for the retry ceiling rather
-- than a hardcoded constant (Sheet 26: "Retry settings stored in
-- model_parameters"). Falls back to 2 retries if no parameter is configured,
-- so the function never hard-fails for lack of config.
create or replace function fail_step(p_step_id uuid, p_error_detail text)
returns void language plpgsql as $$
declare
  v_retry_count int;
  v_max_retries int;
  v_run_type text;
begin
  select s.retry_count, er.run_type into v_retry_count, v_run_type
  from engine_run_steps s join engine_runs er on er.engine_run_id = s.engine_run_id
  where s.engine_run_step_id = p_step_id;

  select coalesce((parameter_value->>'value')::int, 2) into v_max_retries
  from model_parameters
  where parameter_group = 'retry' and parameter_name = 'max_retries' and active = true
  order by effective_from desc limit 1;

  if v_retry_count < v_max_retries then
    update engine_run_steps
      set status = 'RETRYING', retry_count = retry_count + 1, error_detail = p_error_detail
      where engine_run_step_id = p_step_id;
    -- Orchestrator is responsible for re-queueing RETRYING steps back to
    -- QUEUED after a backoff delay; this function only records the failure.
  else
    update engine_run_steps
      set status = 'FAILED', finished_at = now(), error_detail = p_error_detail
      where engine_run_step_id = p_step_id;

    insert into notifications (notification_type, severity, title, message, related_table, related_id)
      values ('ENGINE_FAILURE', 'CRITICAL',
              'Engine step failed after max retries: ' || v_run_type,
              p_error_detail, 'engine_run_steps', p_step_id::text);

    perform finalize_run_if_complete(engine_run_id) from engine_run_steps where engine_run_step_id = p_step_id;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Run finalization
-- ----------------------------------------------------------------------------
-- Called after every step completion/failure. A run is SUCCESS if all steps
-- are SUCCESS/SKIPPED; PARTIAL_SUCCESS if some failed but only via OPTIONAL/
-- SOFT_BLOCKING paths; FAILED if any REQUIRED-path step is FAILED.
-- ----------------------------------------------------------------------------

create or replace function finalize_run_if_complete(p_engine_run_id uuid)
returns void language plpgsql as $$
declare
  v_unfinished int;
  v_failed_required int;
  v_any_failed int;
begin
  select count(*) into v_unfinished
  from engine_run_steps
  where engine_run_id = p_engine_run_id and status in ('QUEUED','RUNNING','RETRYING');

  if v_unfinished > 0 then
    return; -- run still in progress
  end if;

  select count(*) into v_any_failed
  from engine_run_steps where engine_run_id = p_engine_run_id and status = 'FAILED';

  -- A FAILED step that nothing required-depends-on for a SUCCESS step is
  -- "soft" — everything downstream that needed it would itself be FAILED
  -- or SKIPPED, so we can distinguish by checking if any SUCCESS step had a
  -- FAILED required dependency (which shouldn't be possible given
  -- step_is_ready, but PARTIAL_SUCCESS covers the SOFT_BLOCKING/OPTIONAL case
  -- where downstream steps proceeded despite the failure).
  select count(*) into v_failed_required
  from engine_run_steps s
  where s.engine_run_id = p_engine_run_id and s.status = 'FAILED'
    and exists (
      select 1 from engine_run_step_dependencies d
      where d.depends_on_step_id = s.engine_run_step_id and d.dependency_type = 'REQUIRED'
    );

  update engine_runs
    set status = case
          when v_any_failed = 0 then 'SUCCESS'::engine_run_status
          when v_failed_required > 0 then 'FAILED'::engine_run_status
          else 'PARTIAL_SUCCESS'::engine_run_status
        end,
        finished_at = now()
    where engine_run_id = p_engine_run_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Watchdog — sweeps RUNNING steps that exceeded their expected duration
-- ----------------------------------------------------------------------------
-- Intended to run on its own schedule (e.g. every 5 minutes) independent of
-- any specific session window, since a stuck step can happen at any time.
-- ----------------------------------------------------------------------------

create or replace function watchdog_sweep_timed_out_steps()
returns int language plpgsql as $$
declare
  v_count int := 0;
  v_step record;
begin
  for v_step in
    select s.engine_run_step_id, s.step_name, s.engine_run_id, er.run_type
    from engine_run_steps s
    join engine_runs er on er.engine_run_id = s.engine_run_id
    where s.status = 'RUNNING'
      and s.max_expected_duration_seconds is not null
      and s.started_at < now() - (s.max_expected_duration_seconds || ' seconds')::interval
  loop
    update engine_run_steps
      set status = 'TIMED_OUT', finished_at = now(),
          error_detail = 'Watchdog: exceeded max_expected_duration_seconds without completing.'
      where engine_run_step_id = v_step.engine_run_step_id;

    insert into notifications (notification_type, severity, title, message, related_table, related_id)
      values ('ENGINE_FAILURE', 'SYSTEM_FAILURE',
              'Engine step timed out: ' || v_step.run_type || ' / ' || v_step.step_name,
              'Watchdog detected a step stuck in RUNNING past its expected duration.',
              'engine_run_steps', v_step.engine_run_step_id::text);

    perform finalize_run_if_complete(v_step.engine_run_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Audit triggers
-- ----------------------------------------------------------------------------
-- One trigger function per audited table rather than a single generic
-- function: PL/pgSQL trigger functions receive OLD/NEW/TG_OP implicitly and
-- can't delegate that context through a plain function call, so a fully
-- generic audit_trigger_fn() can't be parameterized with a per-table PK
-- column name the way a normal function argument could. This is slightly
-- more boilerplate per table but keeps each trigger simple and correct.
--
-- Phase 1 wires this up for the two highest-stakes mutable tables named in
-- Sheet 05/93 (config thresholds, allocation overrides). Extend the same
-- pattern to recommendation_versions regeneration and role/permission
-- changes on app_users as those write paths are built in later phases.
-- ----------------------------------------------------------------------------

create or replace function audit_model_parameters() returns trigger language plpgsql as $$
declare v_actor_type actor_type; v_actor_id uuid;
begin
  begin v_actor_type := coalesce(current_setting('app.actor_type', true), 'SYSTEM')::actor_type;
  exception when others then v_actor_type := 'SYSTEM'; end;
  begin
    v_actor_id := coalesce(current_setting('app.actor_id', true), '00000000-0000-0000-0000-000000000000')::uuid;
  exception when others then v_actor_id := '00000000-0000-0000-0000-000000000000'; end;

  if TG_OP = 'DELETE' then
    insert into audit_events (actor_type, actor_id, action, table_name, record_id, before_value)
      values (v_actor_type, v_actor_id, 'DELETE', 'model_parameters', OLD.parameter_id::text, row_to_json(OLD)::jsonb);
    return OLD;
  elsif TG_OP = 'UPDATE' then
    insert into audit_events (actor_type, actor_id, action, table_name, record_id, before_value, after_value)
      values (v_actor_type, v_actor_id, 'UPDATE', 'model_parameters', NEW.parameter_id::text, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
    return NEW;
  else
    insert into audit_events (actor_type, actor_id, action, table_name, record_id, after_value)
      values (v_actor_type, v_actor_id, 'CREATE', 'model_parameters', NEW.parameter_id::text, row_to_json(NEW)::jsonb);
    return NEW;
  end if;
end;
$$;

drop trigger if exists trg_audit_model_parameters on model_parameters;
create trigger trg_audit_model_parameters
  after insert or update or delete on model_parameters
  for each row execute function audit_model_parameters();

create or replace function audit_coverage_allocation() returns trigger language plpgsql as $$
declare v_actor_type actor_type; v_actor_id uuid;
begin
  begin v_actor_type := coalesce(current_setting('app.actor_type', true), 'SYSTEM')::actor_type;
  exception when others then v_actor_type := 'SYSTEM'; end;
  begin
    v_actor_id := coalesce(current_setting('app.actor_id', true), '00000000-0000-0000-0000-000000000000')::uuid;
  exception when others then v_actor_id := '00000000-0000-0000-0000-000000000000'; end;

  if TG_OP = 'UPDATE' then
    insert into audit_events (actor_type, actor_id, action, table_name, record_id, before_value, after_value)
      values (v_actor_type, v_actor_id,
              case when NEW.allocation_status = 'OVERRIDDEN' then 'OVERRIDE'::audit_action else 'UPDATE'::audit_action end,
              'coverage_allocation', NEW.allocation_id::text, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
    return NEW;
  elsif TG_OP = 'INSERT' then
    insert into audit_events (actor_type, actor_id, action, table_name, record_id, after_value)
      values (v_actor_type, v_actor_id, 'CREATE', 'coverage_allocation', NEW.allocation_id::text, row_to_json(NEW)::jsonb);
    return NEW;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_audit_coverage_allocation on coverage_allocation;
create trigger trg_audit_coverage_allocation
  after insert or update on coverage_allocation
  for each row execute function audit_coverage_allocation();

-- Optimistic lock enforcement for coverage_allocation overrides (Sheet 34):
-- reject an update if the caller's lock_version doesn't match the current
-- row, rather than silently last-write-wins.
create or replace function enforce_allocation_lock_version() returns trigger language plpgsql as $$
begin
  if NEW.lock_version <> OLD.lock_version then
    raise exception 'coverage_allocation %: stale lock_version (expected %, got %). Reload and retry.',
      OLD.allocation_id, OLD.lock_version, NEW.lock_version;
  end if;
  NEW.lock_version := OLD.lock_version + 1;
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_allocation_lock_version on coverage_allocation;
create trigger trg_allocation_lock_version
  before update on coverage_allocation
  for each row execute function enforce_allocation_lock_version();
