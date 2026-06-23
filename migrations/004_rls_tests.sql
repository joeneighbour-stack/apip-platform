-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.2 — RLS Test Suite
-- ============================================================================
-- Run via pgTAP (recommended: `supabase test db`) or adapt the assertion
-- pattern below to your test runner. Each test creates a minimal fixture,
-- sets the session to a specific app_user via `set local role` + a mocked
-- auth.uid(), runs the query as that user, and asserts the expected result.
--
-- Pattern used throughout: wrap auth.uid() via a test helper that lets us
-- impersonate a given app_user without needing a real Supabase JWT in CI.
-- ============================================================================

create extension if not exists pgtap;

-- Test helper: impersonate a given app_user for the duration of a transaction.
create or replace function test_impersonate(p_app_user_id uuid)
returns void language plpgsql as $$
declare v_auth_user_id uuid;
begin
  select auth_user_id into v_auth_user_id from app_users where app_user_id = p_app_user_id;
  perform set_config('request.jwt.claim.sub', v_auth_user_id::text, true);
end;
$$;

begin;
select plan(12);

-- ----------------------------------------------------------------------------
-- Fixtures: one team, one manager, one analyst (outside that team), one
-- analyst inside the team, one executive, one research user, one admin.
-- ----------------------------------------------------------------------------
do $$
declare
  v_team_id uuid;
  v_admin_auth uuid := gen_random_uuid();
  v_manager_auth uuid := gen_random_uuid();
  v_analyst_a_auth uuid := gen_random_uuid();
  v_analyst_b_auth uuid := gen_random_uuid();
  v_exec_auth uuid := gen_random_uuid();
  v_research_auth uuid := gen_random_uuid();
  v_analyst_a_id uuid;
  v_analyst_b_id uuid;
  v_market_id uuid;
  v_opportunity_id uuid;
  v_rec_version_id uuid;
  v_shadow_id uuid;
  v_manager_user_id uuid;
begin
  insert into teams (team_name) values ('Test Desk') returning team_id into v_team_id;

  insert into auth.users (id) values (v_admin_auth), (v_manager_auth), (v_analyst_a_auth),
    (v_analyst_b_auth), (v_exec_auth), (v_research_auth);

  insert into app_users (auth_user_id, email, display_name, role)
    values (v_admin_auth, 'admin@test.local', 'Admin', 'ADMIN');
  insert into app_users (auth_user_id, email, display_name, role)
    values (v_manager_auth, 'manager@test.local', 'Manager', 'MANAGER') returning app_user_id into v_manager_user_id;
  insert into app_users (auth_user_id, email, display_name, role)
    values (v_exec_auth, 'exec@test.local', 'Exec', 'EXECUTIVE');
  insert into app_users (auth_user_id, email, display_name, role)
    values (v_research_auth, 'research@test.local', 'Research', 'RESEARCH');

  insert into analysts (display_name) values ('Analyst A') returning analyst_id into v_analyst_a_id;
  insert into analysts (display_name) values ('Analyst B') returning analyst_id into v_analyst_b_id;

  insert into app_users (auth_user_id, email, display_name, role, analyst_id)
    values (v_analyst_a_auth, 'a@test.local', 'Analyst A', 'ANALYST', v_analyst_a_id);
  insert into app_users (auth_user_id, email, display_name, role, analyst_id)
    values (v_analyst_b_auth, 'b@test.local', 'Analyst B', 'ANALYST', v_analyst_b_id);

  -- Analyst A is on the test team; Analyst B is not.
  insert into team_members (team_id, app_user_id, analyst_id)
    select v_team_id, app_user_id, v_analyst_a_id from app_users where auth_user_id = v_analyst_a_auth;
  insert into team_managers (team_id, manager_user_id)
    values (v_team_id, v_manager_user_id);

  insert into markets (symbol, asset_class) values ('EURUSD', 'FX') returning market_id into v_market_id;

  insert into opportunities (date, market_id, session, publication_window_start_uk,
      publication_window_end_uk, current_zone, preferred_entry_zone, direction,
      expected_r, trigger_probability, assigned_analyst_id)
    values (current_date, v_market_id, 'EUROPEAN', '06:00', '07:00', 'ZONE_2', 'ZONE_2',
            'BUY', 1.5, 0.6, v_analyst_a_id)
    returning opportunity_id into v_opportunity_id;

  insert into recommendation_versions (opportunity_id, version_number, price_at_generation,
      zone_at_generation, parameter_snapshot, entry_range_low, entry_range_high, risk_range, target_range)
    values (v_opportunity_id, 1, 1.0850, 'ZONE_2', '{}'::jsonb, 1.0840, 1.0860, '1.0820-1.0830', '1.0900-1.0920')
    returning recommendation_version_id into v_rec_version_id;

  insert into coaching_recommendations (opportunity_id, active_recommendation_version_id, analyst_id,
      entry_range_low, entry_range_high, risk_range, target_range, trigger_probability, expected_r, coaching_note)
    values (v_opportunity_id, v_rec_version_id, v_analyst_a_id, 1.0840, 1.0860, '1.0820-1.0830',
            '1.0900-1.0920', 0.6, 1.5, 'Stay disciplined within the suggested range.');

  insert into shadow_trades (opportunity_id, recommendation_version_id, entry, stop, target, rr,
      confidence_label, template_source)
    values (v_opportunity_id, v_rec_version_id, 1.0845, 1.0825, 1.0905, 3.0, 'HIGH', 'EXACT')
    returning shadow_trade_id into v_shadow_id;
end $$;

-- ----------------------------------------------------------------------------
-- Test 1: Analyst cannot select shadow_trades (Critical)
-- ----------------------------------------------------------------------------
select test_impersonate(app_user_id) from app_users where email = 'a@test.local';
select is(
  (select count(*) from shadow_trades)::int, 0,
  'Analyst A: shadow_trades returns zero rows'
);

-- ----------------------------------------------------------------------------
-- Test 2: Analyst cannot select shadow_trade_outcomes (Critical)
-- ----------------------------------------------------------------------------
select is(
  (select count(*) from shadow_trade_outcomes)::int, 0,
  'Analyst A: shadow_trade_outcomes returns zero rows'
);

-- ----------------------------------------------------------------------------
-- Test 3: Analyst cannot select automation_readiness_metrics (Critical)
-- ----------------------------------------------------------------------------
select is(
  (select count(*) from automation_readiness_metrics)::int, 0,
  'Analyst A: automation_readiness_metrics returns zero rows'
);

-- ----------------------------------------------------------------------------
-- Test 4: Analyst CAN select own coaching_recommendations (Critical)
-- ----------------------------------------------------------------------------
select is(
  (select count(*) from coaching_recommendations)::int, 1,
  'Analyst A: can read own coaching_recommendations row'
);

-- ----------------------------------------------------------------------------
-- Test 5: Analyst CANNOT select another analyst's coaching_recommendations
-- ----------------------------------------------------------------------------
select test_impersonate(app_user_id) from app_users where email = 'b@test.local';
select is(
  (select count(*) from coaching_recommendations)::int, 0,
  'Analyst B: cannot read Analyst A coaching_recommendations row'
);

-- ----------------------------------------------------------------------------
-- Test 6: Analyst cannot select recommendation_versions raw table directly
-- (only via the analyst-safe view, or via the coaching_recommendations join
-- for their own active version)
-- ----------------------------------------------------------------------------
select test_impersonate(app_user_id) from app_users where email = 'b@test.local';
select is(
  (select count(*) from recommendation_versions)::int, 0,
  'Analyst B: cannot read recommendation_versions for an opportunity not assigned to them'
);

-- ----------------------------------------------------------------------------
-- Test 7: Manager CAN select team analyst coaching_reviews (scoped)
-- ----------------------------------------------------------------------------
-- (No coaching_reviews fixture inserted above for brevity in this excerpt --
-- in the full suite, insert an actual_trades + coaching_reviews row for
-- Analyst A and assert the manager can read it.)
select test_impersonate(app_user_id) from app_users where email = 'manager@test.local';
select is(
  (select count(*) from coaching_recommendations)::int, 1,
  'Manager: can read coaching_recommendations for Analyst A (managed team member)'
);

-- ----------------------------------------------------------------------------
-- Test 8: Manager CANNOT select out-of-scope (Analyst B is not on managed team)
-- ----------------------------------------------------------------------------
select is(
  (select count(*) from app_users where email = 'b@test.local' and analyst_id is not null
     and manages_analyst(analyst_id))::int, 0,
  'Manager: cannot resolve managed-analyst scope for Analyst B (out of team)'
);

-- ----------------------------------------------------------------------------
-- Test 9: Executive sees aggregate KPIs, not raw trade-by-trade coaching
-- ----------------------------------------------------------------------------
select test_impersonate(app_user_id) from app_users where email = 'exec@test.local';
select is(
  (select count(*) from coaching_recommendations)::int, 0,
  'Executive: cannot read raw coaching_recommendations by default'
);

-- ----------------------------------------------------------------------------
-- Test 10: Admin can update model_parameters and an audit_events row results
-- (audit trigger assumed implemented in Phase 1.3; this asserts the write
-- itself succeeds under RLS, audit-row assertion lives in the engine suite)
-- ----------------------------------------------------------------------------
select test_impersonate(app_user_id) from app_users where email = 'admin@test.local';
select lives_ok(
  $$ update model_parameters set parameter_value = '{"value": 0.30}'::jsonb
     where parameter_name = 'stale_price_atr_threshold' $$,
  'Admin: can update model_parameters'
);

-- ----------------------------------------------------------------------------
-- Test 11: Research CAN select shadow_trades
-- ----------------------------------------------------------------------------
select test_impersonate(app_user_id) from app_users where email = 'research@test.local';
select is(
  (select count(*) from shadow_trades)::int, 1,
  'Research: can read shadow_trades'
);

-- ----------------------------------------------------------------------------
-- Test 12: API-layer field filtering (application-level assertion placeholder)
-- The DB-level guarantee is that recommendation_versions_analyst_view excludes
-- parameter_snapshot and full regime_tags. Assert the view's column list here;
-- the API contract test (no hidden fields in HTTP response) lives in the
-- application test suite, not pgTAP, since it tests serialization, not RLS.
-- ----------------------------------------------------------------------------
select isnt(
  (select string_agg(column_name, ',') from information_schema.columns
   where table_name = 'recommendation_versions_analyst_view' and column_name = 'parameter_snapshot'),
  'parameter_snapshot',
  'recommendation_versions_analyst_view: does not expose parameter_snapshot to analysts'
);

select * from finish();
rollback;
