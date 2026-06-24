-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — analyst_publications RLS (closing a sequencing gap)
-- ============================================================================
-- analyst_publications was created in Phase 1.4, after the Phase 1.2 RLS
-- pass had already completed -- it has had ZERO RLS policies since it was
-- created. Caught while designing the manual-override workflow, not by a
-- test (there was no test for it, which is itself the lesson: every new
-- table needs RLS applied in the SAME migration that creates it, not
-- deferred to "whenever Phase 1.2 happens to run again").
--
-- Policy design: this table holds reconciliation-in-progress data
-- (raw webhook flags, internal match status) that is closer in spirit to
-- automation_readiness_metrics than to coaching_recommendations -- it is an
-- internal QA/coaching-input table, not something analysts read directly.
-- Revisit if there is ever a product decision to show analysts their own
-- trigger history; today's request is specifically an ADMIN/RESEARCH review
-- and override workflow.
-- ============================================================================

alter table analyst_publications enable row level security;

create policy analyst_publications_select_admin_research on analyst_publications
  for select using (current_app_role() in ('ADMIN','RESEARCH'));

create policy analyst_publications_select_manager_scoped on analyst_publications
  for select using (current_app_role() = 'MANAGER' and manages_analyst(analyst_id));

-- No ANALYST or EXECUTIVE policy exists -> default deny, same pattern used
-- for shadow_trades and automation_readiness_metrics. Executives read this
-- only through an aggregated Triggered Rate KPI (executive_kpis), never
-- raw publication rows.

-- Writes (including the override function below) go through
-- override_publication_triggered(), which is SECURITY DEFINER and enforces
-- its own role check internally rather than relying on a blanket UPDATE
-- policy here -- see 019_publication_override.sql.
