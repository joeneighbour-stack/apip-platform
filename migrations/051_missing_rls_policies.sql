-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 051 -- missing RLS policies for zero-policy tables
-- ============================================================================
-- Follow-up to the Phase 1 pre-launch schema audit (docs/qa/schema-audit.md,
-- section 5): closes the RLS documentation gap for tables that had neither
-- an "enable row level security" statement nor a policy anywhere in
-- migrations 001-050.
--
-- Two tables originally flagged as candidates -- analyst_atr_profiles and
-- analyst_opportunity_feedback -- are NOT included here: both already have
-- RLS enabled and policies (046_analyst_atr_profiles.sql,
-- 045_analyst_opportunity_feedback.sql), so there is nothing missing for
-- them. analyst_opportunity_feedback in particular already has a policy
-- named analyst_opportunity_feedback_insert_own -- re-creating it would
-- fail outright on apply.
--
-- Uses the same helper functions as 002_rls.sql:
--   current_app_role()   -- role of the current auth user
--   current_analyst_id() -- analyst_id for the current auth user, if any
--   manages_analyst(id)  -- true if the current user manages that analyst
-- ============================================================================

-- ----------------------------------------------------------------------------
-- analyst_external_codes -- analyst reads own codes; manager scoped to
-- analysts they manage (same manages_analyst() scoping actual_trades,
-- coaching_recommendations, analyst_profiles etc. all use -- a flat
-- "any MANAGER sees any analyst" grant would be a real widening of access
-- versus every other analyst-owned table in this schema); admin unrestricted.
-- No write policy: written only by the backfill/import scripts via the
-- service-role client, which bypasses RLS (same pattern as analyst_profiles).
-- ----------------------------------------------------------------------------
alter table analyst_external_codes enable row level security;

create policy analyst_external_codes_select_own on analyst_external_codes
  for select using (
    analyst_id = current_analyst_id()
    or current_app_role() = 'ADMIN'
    or (current_app_role() = 'MANAGER' and manages_analyst(analyst_id))
  );

-- ----------------------------------------------------------------------------
-- engine_validation_runs -- internal engine/research equivalence-check
-- records (Architecture Section 10). Manager/admin read only.
-- No write policy: written only by the engine's own validation pass via the
-- service-role client, same as engine_runs/engine_run_steps (002_rls.sql).
-- ----------------------------------------------------------------------------
alter table engine_validation_runs enable row level security;

create policy engine_validation_runs_select_manager on engine_validation_runs
  for select using (
    current_app_role() in ('MANAGER', 'ADMIN')
  );

-- ----------------------------------------------------------------------------
-- market_symbol_aliases -- read-only reference data (source-system symbol
-- spellings mapped to markets.market_id), same broad-read pattern as
-- markets_select_all / economic_events_select_all (002_rls.sql).
-- No write policy: populated by migrations today, not by any application
-- write path.
-- ----------------------------------------------------------------------------
alter table market_symbol_aliases enable row level security;

create policy market_symbol_aliases_select_all on market_symbol_aliases
  for select using (auth.uid() is not null);

-- ----------------------------------------------------------------------------
-- service_principals -- system/service account identities and credential
-- modes. Admin only, no exceptions -- same sensitivity class as app_users
-- writes and team writes, which are also admin-only throughout 002_rls.sql.
-- ----------------------------------------------------------------------------
alter table service_principals enable row level security;

create policy service_principals_select_admin on service_principals
  for select using (current_app_role() = 'ADMIN');

-- ----------------------------------------------------------------------------
-- analytics_cache -- intentionally no user-facing policy.
-- Its own migration (050_analytics_cache.sql) already documents this: the
-- table is read and written exclusively via createAdminClient() (the
-- service-role client), never from a user's browser session, so there is no
-- row-level boundary for RLS to enforce. Noted here too so this migration
-- reads as a complete answer to "which zero-policy tables were reviewed",
-- rather than looking like an oversight.
-- ----------------------------------------------------------------------------
