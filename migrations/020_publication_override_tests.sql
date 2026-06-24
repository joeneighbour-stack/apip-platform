-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — Manual override workflow test suite
-- ============================================================================
-- Run: select * from run_publication_override_tests();
-- Uses test_impersonate() (defined in 004_rls_tests.sql, still present in
-- the database) to exercise override_publication_triggered()'s internal
-- role check via the same auth.uid()-based resolution current_app_role()
-- already uses -- this does not require "set role authenticated" the way
-- testing raw table RLS policies does, since the permission check here is
-- inside the function body, not a table policy.
-- ============================================================================

create or replace function run_publication_override_tests()
returns setof text language plpgsql as $$
declare
  v_results text[] := '{}';
  v_admin_auth uuid := gen_random_uuid();
  v_analyst_auth uuid := gen_random_uuid();
  v_admin_user_id uuid;
  v_analyst_id uuid;
  v_market_id uuid;
  v_pub_id uuid;
  v_raised_for_analyst boolean := false;
  v_raised_for_empty_reason boolean := false;
begin
  v_results := array_append(v_results, (select plan(6)));

  insert into auth.users (id) values (v_admin_auth), (v_analyst_auth);
  insert into app_users (auth_user_id, email, display_name, role)
    values (v_admin_auth, 'override-test-admin@test.local', 'Test Admin', 'ADMIN')
    returning app_user_id into v_admin_user_id;
  insert into app_users (auth_user_id, email, display_name, role)
    values (v_analyst_auth, 'override-test-analyst@test.local', 'Test Analyst', 'ANALYST');

  insert into analysts (display_name) values ('Test Override Analyst') returning analyst_id into v_analyst_id;
  insert into markets (symbol, asset_class) values ('TEST_OVERRIDE_' || gen_random_uuid()::text, 'FX') returning market_id into v_market_id;

  insert into analyst_publications (source_system, source_record_id, analyst_id, market_id, published_at,
      direction, entry, stop, target, original_triggered, effective_triggered, reconciliation_status, raw_payload)
    values ('ACUITY_PERFORMANCE_API', 'override-test-pub-001', v_analyst_id, v_market_id, '2026-02-01'::timestamptz,
            'BUY', 1.10, 1.05, 1.20, false, false, 'WEBHOOK_FALSE_CONFIRMED', '{}'::jsonb)
    returning publication_id into v_pub_id;

  -- --------------------------------------------------------------------
  -- Test 1: a non-ADMIN/RESEARCH role cannot override
  -- --------------------------------------------------------------------
  perform test_impersonate(app_user_id) from app_users where email = 'override-test-analyst@test.local';
  begin
    perform override_publication_triggered(v_pub_id, true, 'analyst attempting to self-override');
  exception when others then
    v_raised_for_analyst := true;
  end;

  v_results := array_append(v_results, (select is(
    v_raised_for_analyst, true,
    'override_publication_triggered: raises when called by a non-ADMIN/RESEARCH role'
  )));

  v_results := array_append(v_results, (select is(
    (select effective_triggered from analyst_publications where publication_id = v_pub_id),
    false,
    'override_publication_triggered: rejected attempt leaves effective_triggered unchanged'
  )));

  -- --------------------------------------------------------------------
  -- Test 2: ADMIN with an empty reason is rejected -- reason is mandatory
  -- --------------------------------------------------------------------
  perform test_impersonate(app_user_id) from app_users where email = 'override-test-admin@test.local';
  begin
    perform override_publication_triggered(v_pub_id, true, '');
  exception when others then
    v_raised_for_empty_reason := true;
  end;

  v_results := array_append(v_results, (select is(
    v_raised_for_empty_reason, true,
    'override_publication_triggered: empty override_reason is rejected, not treated as optional'
  )));

  -- --------------------------------------------------------------------
  -- Test 3: ADMIN with a real reason succeeds
  -- --------------------------------------------------------------------
  perform override_publication_triggered(v_pub_id, true, 'Confirmed via broker statement: trade did trigger, webhook data was delayed.');

  v_results := array_append(v_results, (select is(
    (select effective_triggered from analyst_publications where publication_id = v_pub_id),
    true,
    'override_publication_triggered: valid ADMIN override flips effective_triggered to true'
  )));

  v_results := array_append(v_results, (select is(
    (select reconciliation_status::text from analyst_publications where publication_id = v_pub_id),
    'MANUAL_OVERRIDE_TRIGGERED',
    'override_publication_triggered: reconciliation_status correctly set to MANUAL_OVERRIDE_TRIGGERED'
  )));

  -- --------------------------------------------------------------------
  -- Test 4: an audit_events row was created for the override
  -- --------------------------------------------------------------------
  v_results := array_append(v_results, (select is(
    (select count(*)::int from audit_events where table_name = 'analyst_publications' and record_id = v_pub_id::text and action = 'OVERRIDE'),
    1,
    'override_publication_triggered: creates exactly one audit_events row with action=OVERRIDE'
  )));

  -- --------------------------------------------------------------------
  -- Cleanup
  -- --------------------------------------------------------------------
  delete from audit_events where table_name = 'analyst_publications' and record_id = v_pub_id::text;
  delete from analyst_publications where publication_id = v_pub_id;
  delete from analysts where analyst_id = v_analyst_id;
  delete from markets where market_id = v_market_id;
  delete from app_users where email in ('override-test-admin@test.local', 'override-test-analyst@test.local');

  v_results := array_append(v_results, (select * from finish()));

  return query select unnest(v_results);
end;
$$;

select * from run_publication_override_tests();
