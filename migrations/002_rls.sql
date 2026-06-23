-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.2 — Row Level Security
-- ============================================================================
-- PATCH HISTORY:
--   2026-06-23 — Fixed three instances of an over-broad EXECUTIVE grant,
--   found via the Phase 1.2 RLS test suite run against live Supabase
--   staging (Tests 9 + ad hoc follow-up checks on opportunities and
--   coverage_allocation). Executives are scoped to executive_kpis and
--   automation_readiness_metrics only -- raw operational tables
--   (coaching_recommendations, opportunities, coverage_allocation) no
--   longer grant EXECUTIVE select access. See inline NOTEs at each fix.
-- ============================================================================
-- Design principle: every policy here is written assuming a hostile or buggy
-- API layer. RLS is the actual enforcement of the hidden/visible boundary,
-- not the UI. Service principals operate via a dedicated Postgres role that
-- bypasses RLS for system writes (service_role in Supabase), but all
-- analyst/manager/executive/research access goes through these policies.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper functions (security definer, used inside policies to avoid
-- re-evaluating expensive joins per row and to keep policy logic readable)
-- ----------------------------------------------------------------------------

create or replace function current_app_user_id()
returns uuid
language sql stable security definer
as $$
  select app_user_id from app_users where auth_user_id = auth.uid();
$$;

create or replace function current_app_role()
returns app_role
language sql stable security definer
as $$
  select role from app_users where auth_user_id = auth.uid();
$$;

create or replace function current_analyst_id()
returns uuid
language sql stable security definer
as $$
  select analyst_id from app_users where auth_user_id = auth.uid();
$$;

-- True if the current user manages the given team (via team_managers), used
-- for scoped manager access instead of a jsonb manager_scope blob.
create or replace function manages_team(target_team_id uuid)
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1 from team_managers tm
    where tm.manager_user_id = current_app_user_id()
      and tm.team_id = target_team_id
      and tm.active = true
  );
$$;

-- True if the given analyst is on any team the current user manages.
create or replace function manages_analyst(target_analyst_id uuid)
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1
    from team_managers tm
    join team_members tmem on tmem.team_id = tm.team_id
    where tm.manager_user_id = current_app_user_id()
      and tm.active = true
      and tmem.analyst_id = target_analyst_id
      and tmem.active = true
  );
$$;

-- ----------------------------------------------------------------------------
-- app_users
-- Policy: users read own row; admin manages all; managers read scoped users.
-- ----------------------------------------------------------------------------
alter table app_users enable row level security;

create policy app_users_select_own on app_users
  for select using (auth_user_id = auth.uid());

create policy app_users_select_admin on app_users
  for select using (current_app_role() = 'ADMIN');

create policy app_users_select_manager_scoped on app_users
  for select using (
    current_app_role() = 'MANAGER'
    and analyst_id is not null
    and manages_analyst(analyst_id)
  );

create policy app_users_write_admin on app_users
  for all using (current_app_role() = 'ADMIN')
  with check (current_app_role() = 'ADMIN');

-- ----------------------------------------------------------------------------
-- teams / team_members / team_managers
-- Admin manages all; managers/analysts read their own scope.
-- ----------------------------------------------------------------------------
alter table teams enable row level security;
alter table team_members enable row level security;
alter table team_managers enable row level security;

create policy teams_select_all_authenticated on teams
  for select using (auth.uid() is not null);

create policy teams_write_admin on teams
  for all using (current_app_role() = 'ADMIN') with check (current_app_role() = 'ADMIN');

create policy team_members_select_own on team_members
  for select using (app_user_id = current_app_user_id());

create policy team_members_select_manager on team_members
  for select using (current_app_role() = 'MANAGER' and manages_team(team_id));

create policy team_members_select_admin on team_members
  for select using (current_app_role() in ('ADMIN','RESEARCH'));

create policy team_members_write_admin on team_members
  for all using (current_app_role() = 'ADMIN') with check (current_app_role() = 'ADMIN');

create policy team_managers_select_admin_or_self on team_managers
  for select using (current_app_role() = 'ADMIN' or manager_user_id = current_app_user_id());

create policy team_managers_write_admin on team_managers
  for all using (current_app_role() = 'ADMIN') with check (current_app_role() = 'ADMIN');

-- ----------------------------------------------------------------------------
-- markets / session_configuration — broadly readable reference data
-- ----------------------------------------------------------------------------
alter table markets enable row level security;
alter table session_configuration enable row level security;

create policy markets_select_all on markets for select using (auth.uid() is not null);
create policy markets_write_admin on markets for all
  using (current_app_role() = 'ADMIN') with check (current_app_role() = 'ADMIN');

create policy session_config_select_admin_manager on session_configuration
  for select using (current_app_role() in ('ADMIN','MANAGER'));
create policy session_config_write_admin on session_configuration for all
  using (current_app_role() = 'ADMIN') with check (current_app_role() = 'ADMIN');

-- ----------------------------------------------------------------------------
-- model_parameters — admin/research write with audit; others read only if needed
-- ----------------------------------------------------------------------------
alter table model_parameters enable row level security;

create policy model_parameters_select on model_parameters
  for select using (current_app_role() in ('ADMIN','RESEARCH','MANAGER'));

create policy model_parameters_write on model_parameters
  for all using (current_app_role() in ('ADMIN','RESEARCH'))
  with check (current_app_role() in ('ADMIN','RESEARCH'));

-- ----------------------------------------------------------------------------
-- engine_runs / engine_run_steps / engine_run_step_dependencies
-- Admin/Manager/Research read; service principals write via service_role.
-- ----------------------------------------------------------------------------
alter table engine_runs enable row level security;
alter table engine_run_steps enable row level security;
alter table engine_run_step_dependencies enable row level security;

create policy engine_runs_select on engine_runs
  for select using (current_app_role() in ('ADMIN','MANAGER','RESEARCH'));
create policy engine_run_steps_select on engine_run_steps
  for select using (current_app_role() in ('ADMIN','MANAGER','RESEARCH'));
create policy engine_run_step_deps_select on engine_run_step_dependencies
  for select using (current_app_role() in ('ADMIN','MANAGER','RESEARCH'));
-- No user-facing write policies: these tables are written exclusively by
-- service principals via the Supabase service_role key, which bypasses RLS.
-- Admin manual re-run actions go through an API route that writes as a
-- service principal on the admin's behalf, never as the admin's own row.

-- ----------------------------------------------------------------------------
-- import_batches / import_errors — admin/research visibility only
-- ----------------------------------------------------------------------------
alter table import_batches enable row level security;
alter table import_errors enable row level security;

create policy import_batches_select on import_batches
  for select using (current_app_role() in ('ADMIN','RESEARCH'));
create policy import_errors_select on import_errors
  for select using (current_app_role() in ('ADMIN','RESEARCH'));
create policy import_errors_update_admin on import_errors
  for update using (current_app_role() = 'ADMIN') with check (current_app_role() = 'ADMIN');

-- ----------------------------------------------------------------------------
-- market_state_daily / market_state_intraday / market_regime_state
-- "All filtered" / "Internal/Manager" per Sheet 05 — readable broadly, with
-- intraday/regime detail restricted from raw analyst access beyond what's
-- surfaced through opportunities/recommendation_versions.
-- ----------------------------------------------------------------------------
alter table market_state_daily enable row level security;
alter table market_state_intraday enable row level security;
alter table market_regime_state enable row level security;

create policy market_state_daily_select on market_state_daily
  for select using (auth.uid() is not null);

create policy market_state_intraday_select_internal on market_state_intraday
  for select using (current_app_role() in ('ADMIN','MANAGER','RESEARCH'));

create policy market_regime_state_select_internal on market_regime_state
  for select using (current_app_role() in ('ADMIN','MANAGER','RESEARCH'));

-- ----------------------------------------------------------------------------
-- economic_calendar_events — safe to show analysts; market_event_risk
-- shows plain-language warnings to analysts via a view, raw score restricted.
-- ----------------------------------------------------------------------------
alter table economic_calendar_events enable row level security;
alter table economic_event_revisions enable row level security;
alter table market_event_risk enable row level security;

create policy economic_events_select_all on economic_calendar_events
  for select using (auth.uid() is not null);

create policy economic_event_revisions_select_internal on economic_event_revisions
  for select using (current_app_role() in ('ADMIN','RESEARCH'));

-- Raw market_event_risk table (with risk_score) is internal-only.
-- Analysts consume event risk through market_event_risk_analyst_view (below).
create policy market_event_risk_select_internal on market_event_risk
  for select using (current_app_role() in ('ADMIN','MANAGER','RESEARCH'));

create view market_event_risk_analyst_view as
  select market_event_risk_id, event_id, market_id, risk_window_start,
         risk_window_end, event_risk_status, analyst_warning
  from market_event_risk;
grant select on market_event_risk_analyst_view to authenticated;

-- ----------------------------------------------------------------------------
-- opportunities — role-based; analyst sees own assignment, manager sees team
-- ----------------------------------------------------------------------------
alter table opportunities enable row level security;

create policy opportunities_select_analyst on opportunities
  for select using (
    current_app_role() = 'ANALYST'
    and assigned_analyst_id = current_analyst_id()
  );

create policy opportunities_select_manager on opportunities
  for select using (
    current_app_role() = 'MANAGER'
    and (assigned_analyst_id is null or manages_analyst(assigned_analyst_id))
  );

-- NOTE: EXECUTIVE intentionally excluded here. Executives work from
-- executive_kpis aggregates, not raw per-opportunity rows. Same class of
-- bug as coaching_recommendations above -- caught by the same test pass.
create policy opportunities_select_research_admin on opportunities
  for select using (current_app_role() in ('RESEARCH','ADMIN'));

-- ----------------------------------------------------------------------------
-- recommendation_versions — analysts see a restricted "safe" projection only.
-- Raw internal status fields (parameter_snapshot, full validity history) are
-- restricted; analysts consume this via a dedicated safe view.
-- ----------------------------------------------------------------------------
alter table recommendation_versions enable row level security;

create policy recommendation_versions_select_internal on recommendation_versions
  for select using (current_app_role() in ('ADMIN','MANAGER','RESEARCH'));

create policy recommendation_versions_select_analyst on recommendation_versions
  for select using (
    current_app_role() = 'ANALYST'
    and exists (
      select 1 from coaching_recommendations cr
      where cr.active_recommendation_version_id = recommendation_versions.recommendation_version_id
        and cr.analyst_id = current_analyst_id()
    )
  );

-- Analyst-safe projection: excludes parameter_snapshot, full regime_tags,
-- and treats recommendation_validity_status as the only "internal" signal
-- exposed, translated to plain language at the API layer.
create view recommendation_versions_analyst_view as
  select recommendation_version_id, opportunity_id, version_number, generated_at,
         shown_at, entry_range_low, entry_range_high, risk_range, target_range,
         recommendation_validity_status, event_risk_status, requires_refresh, is_active
  from recommendation_versions;
grant select on recommendation_versions_analyst_view to authenticated;

-- ----------------------------------------------------------------------------
-- coaching_recommendations — analyst reads own; manager reads scoped
-- ----------------------------------------------------------------------------
alter table coaching_recommendations enable row level security;

create policy coaching_recommendations_select_own on coaching_recommendations
  for select using (
    current_app_role() = 'ANALYST' and analyst_id = current_analyst_id()
  );

create policy coaching_recommendations_select_manager on coaching_recommendations
  for select using (
    current_app_role() = 'MANAGER' and manages_analyst(analyst_id)
  );

-- NOTE: EXECUTIVE intentionally excluded here. Executives consume coaching
-- data only through executive_kpis aggregates, never raw per-trade rows
-- (Sheet 28: "Executive raw coaching -> Denied by default"). Caught by
-- Phase 1.2 RLS test suite (Test 9) against a real Supabase staging project
-- on 2026-06-23 -- the original migration incorrectly granted EXECUTIVE here.
create policy coaching_recommendations_select_research_admin on coaching_recommendations
  for select using (current_app_role() in ('RESEARCH','ADMIN'));

-- ----------------------------------------------------------------------------
-- shadow_trades / shadow_trade_outcomes — the platform's core trust boundary.
-- Analysts must NEVER access these tables. No analyst policy exists at all
-- (default-deny), which is intentional: there is no row predicate that could
-- be misconfigured to leak access, because there is no analyst-facing policy.
-- ----------------------------------------------------------------------------
alter table shadow_trades enable row level security;
alter table shadow_trade_outcomes enable row level security;

create policy shadow_trades_select_manager_research on shadow_trades
  for select using (current_app_role() in ('MANAGER','RESEARCH','ADMIN'));
-- Explicitly no policy for ANALYST or EXECUTIVE roles -> RLS defaults to deny.

create policy shadow_trade_outcomes_select_manager_research on shadow_trade_outcomes
  for select using (current_app_role() in ('MANAGER','RESEARCH','ADMIN'));

-- Executives see only an aggregated summary, never row-level shadow data.
create view shadow_performance_executive_summary as
  select date_trunc('month', sto.outcome_timestamp) as period,
         count(*) as shadow_trade_count,
         avg(sto.result_r) as avg_shadow_r
  from shadow_trade_outcomes sto
  where sto.outcome_timestamp is not null
  group by 1;
grant select on shadow_performance_executive_summary to authenticated;

create policy shadow_exec_summary_view_guard on shadow_trade_outcomes
  for select using (current_app_role() in ('MANAGER','RESEARCH','ADMIN'));
  -- (Executive access is via the aggregated view only, not this policy.)

-- ----------------------------------------------------------------------------
-- actual_trades — analyst reads own; manager scoped; executive aggregate
-- (handled at API layer via a rollup); importer writes via service_role.
-- ----------------------------------------------------------------------------
alter table actual_trades enable row level security;

create policy actual_trades_select_own on actual_trades
  for select using (
    current_app_role() = 'ANALYST' and analyst_id = current_analyst_id()
  );

create policy actual_trades_select_manager on actual_trades
  for select using (
    current_app_role() = 'MANAGER' and manages_analyst(analyst_id)
  );

create policy actual_trades_select_research_admin on actual_trades
  for select using (current_app_role() in ('RESEARCH','ADMIN'));

-- Executives do not get a direct row-level policy; they consume actual_trades
-- only through executive_kpis aggregates, consistent with "aggregate unless
-- permitted" in Sheet 23.

-- ----------------------------------------------------------------------------
-- coverage_allocation — analyst reads own; manager approves/overrides scoped
-- ----------------------------------------------------------------------------
alter table coverage_allocation enable row level security;

create policy coverage_allocation_select_own on coverage_allocation
  for select using (
    current_app_role() = 'ANALYST' and assigned_analyst_id = current_analyst_id()
  );

create policy coverage_allocation_select_manager on coverage_allocation
  for select using (current_app_role() = 'MANAGER' and manages_team(team_id));

create policy coverage_allocation_update_manager on coverage_allocation
  for update using (current_app_role() = 'MANAGER' and manages_team(team_id))
  with check (current_app_role() = 'MANAGER' and manages_team(team_id));

-- NOTE: EXECUTIVE intentionally excluded here. Sheet 23 grants executives no
-- direct access to raw coverage_allocation rows (analysts read own
-- assignments, managers approve/override scoped assignments). Executives see
-- coverage efficiency only via executive_kpis. Third instance of the same
-- bug pattern as coaching_recommendations/opportunities above.
create policy coverage_allocation_select_admin on coverage_allocation
  for select using (current_app_role() = 'ADMIN');

create policy allocation_decision_log_select on allocation_decision_log
  for select using (current_app_role() in ('ADMIN','MANAGER','RESEARCH'));
alter table allocation_decision_log enable row level security;

-- ----------------------------------------------------------------------------
-- notifications — role-based, scoped by recipient/team
-- ----------------------------------------------------------------------------
alter table notifications enable row level security;

create policy notifications_select_own on notifications
  for select using (recipient_user_id = current_app_user_id());

create policy notifications_select_role on notifications
  for select using (recipient_role = current_app_role());

create policy notifications_select_team_manager on notifications
  for select using (team_id is not null and manages_team(team_id));

create policy notifications_select_admin on notifications
  for select using (current_app_role() = 'ADMIN');

create policy notifications_update_ack on notifications
  for update using (
    recipient_user_id = current_app_user_id()
    or recipient_role = current_app_role()
    or (team_id is not null and manages_team(team_id))
    or current_app_role() = 'ADMIN'
  );

-- ----------------------------------------------------------------------------
-- coaching_reviews — analyst reads/acknowledges own; manager scoped
-- ----------------------------------------------------------------------------
alter table coaching_reviews enable row level security;

create policy coaching_reviews_select_own on coaching_reviews
  for select using (
    current_app_role() = 'ANALYST'
    and exists (
      select 1 from actual_trades at_
      where at_.trade_id = coaching_reviews.trade_id
        and at_.analyst_id = current_analyst_id()
    )
  );

create policy coaching_reviews_update_acknowledge on coaching_reviews
  for update using (
    current_app_role() = 'ANALYST'
    and exists (
      select 1 from actual_trades at_
      where at_.trade_id = coaching_reviews.trade_id
        and at_.analyst_id = current_analyst_id()
    )
  )
  with check (true);

create policy coaching_reviews_select_manager on coaching_reviews
  for select using (
    current_app_role() = 'MANAGER'
    and exists (
      select 1 from actual_trades at_
      where at_.trade_id = coaching_reviews.trade_id
        and manages_analyst(at_.analyst_id)
    )
  );

create policy coaching_reviews_select_admin_research on coaching_reviews
  for select using (current_app_role() in ('ADMIN','RESEARCH'));

-- ----------------------------------------------------------------------------
-- analyst_profiles / template_profiles / trigger_probability_profiles
-- ----------------------------------------------------------------------------
alter table analyst_profiles enable row level security;
alter table template_profiles enable row level security;
alter table trigger_probability_profiles enable row level security;

create policy analyst_profiles_select_manager_research on analyst_profiles
  for select using (
    current_app_role() in ('RESEARCH','ADMIN')
    or (current_app_role() = 'MANAGER' and manages_analyst(analyst_id))
  );

create policy template_profiles_select on template_profiles
  for select using (current_app_role() in ('RESEARCH','MANAGER','ADMIN'));

create policy trigger_probability_select_all on trigger_probability_profiles
  for select using (auth.uid() is not null);

-- ----------------------------------------------------------------------------
-- Claude governance tables — admin/research only
-- ----------------------------------------------------------------------------
alter table golden_set_scenarios enable row level security;
alter table prompt_templates enable row level security;
alter table prompt_regression_runs enable row level security;
alter table fallback_templates enable row level security;
alter table claude_generation_logs enable row level security;

create policy claude_tables_select_admin_research on golden_set_scenarios
  for select using (current_app_role() in ('ADMIN','RESEARCH'));
create policy prompt_templates_select on prompt_templates
  for select using (current_app_role() in ('ADMIN','RESEARCH'));
create policy prompt_regression_runs_select on prompt_regression_runs
  for select using (current_app_role() in ('ADMIN','RESEARCH'));
create policy fallback_templates_select on fallback_templates
  for select using (current_app_role() in ('ADMIN','RESEARCH'));
create policy claude_generation_logs_select on claude_generation_logs
  for select using (current_app_role() in ('ADMIN','RESEARCH'));

create policy golden_set_write_admin_research on golden_set_scenarios
  for all using (current_app_role() in ('ADMIN','RESEARCH'))
  with check (current_app_role() in ('ADMIN','RESEARCH'));
create policy prompt_templates_write_admin_research on prompt_templates
  for all using (current_app_role() in ('ADMIN','RESEARCH'))
  with check (current_app_role() in ('ADMIN','RESEARCH'));

-- ----------------------------------------------------------------------------
-- api_usage_logs / api_quota_alerts — admin/research
-- ----------------------------------------------------------------------------
alter table api_usage_logs enable row level security;
alter table api_quota_alerts enable row level security;

create policy api_usage_logs_select on api_usage_logs
  for select using (current_app_role() in ('ADMIN','RESEARCH'));
create policy api_quota_alerts_select on api_quota_alerts
  for select using (current_app_role() in ('ADMIN','RESEARCH'));

-- ----------------------------------------------------------------------------
-- executive_kpis / automation_readiness_metrics
-- ----------------------------------------------------------------------------
alter table executive_kpis enable row level security;
alter table automation_readiness_metrics enable row level security;

create policy executive_kpis_select_exec_manager on executive_kpis
  for select using (
    kpi_visibility = 'EXECUTIVE' and current_app_role() in ('EXECUTIVE','ADMIN')
    or kpi_visibility = 'MANAGER' and current_app_role() in ('MANAGER','EXECUTIVE','ADMIN') and (team_id is null or manages_team(team_id))
    or kpi_visibility = 'RESEARCH' and current_app_role() in ('RESEARCH','ADMIN')
    or kpi_visibility = 'ANALYST_OWN' and current_app_role() = 'ANALYST' and analyst_id = current_analyst_id()
  );

create policy automation_readiness_select on automation_readiness_metrics
  for select using (current_app_role() in ('EXECUTIVE','RESEARCH','ADMIN'));
-- Per Key Cultural Principle: analysts and managers never see automation
-- readiness metrics. No ANALYST or MANAGER policy exists -> default deny.

-- ----------------------------------------------------------------------------
-- audit_events — admin/research read; no analyst access; system writes only
-- ----------------------------------------------------------------------------
alter table audit_events enable row level security;

create policy audit_events_select_admin_research on audit_events
  for select using (current_app_role() in ('ADMIN','RESEARCH'));
-- No write policy for any app_user role: audit_events is written exclusively
-- by triggers/service principals via service_role.
