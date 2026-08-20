-- ============================================================================
-- Migration 058 — RLS policies for analyst_availability
-- ============================================================================
-- analyst_availability had RLS enabled but no policies (confirmed in the
-- Phase 1 schema audit). This adds appropriate access scoping:
--   ANALYST: sees own rows only
--   MANAGER/ADMIN: sees all rows (needed for AbsenceQueue and allocation)
--
-- `enable row level security` below is not in the original request but is
-- included defensively: no migration file in this repo's tracked history
-- shows RLS ever being enabled on this table (checked via `grep -rn
-- analyst_availability migrations/*.sql`), which would mean the policies
-- below are silently inert without it. Idempotent either way -- a no-op if
-- RLS is in fact already enabled live (schema drift ahead of the tracked
-- migration history has happened before in this project, e.g. the
-- trade_outcome_status enum), required if it isn't.
-- ============================================================================

alter table analyst_availability enable row level security;

create policy analyst_availability_select_own on analyst_availability
  for select using (
    analyst_id = current_analyst_id()
    or current_app_role() in ('MANAGER', 'ADMIN')
  );

create policy analyst_availability_insert_own on analyst_availability
  for insert with check (
    analyst_id = current_analyst_id()
    or current_app_role() in ('MANAGER', 'ADMIN')
  );

create policy analyst_availability_update_manager on analyst_availability
  for update using (
    current_app_role() in ('MANAGER', 'ADMIN')
  );
