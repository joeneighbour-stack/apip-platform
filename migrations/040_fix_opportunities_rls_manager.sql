-- ============================================================================
-- APIP Phase 1.7 -- Fix opportunities RLS for MANAGER role
-- ============================================================================
-- Original policy required manages_analyst(assigned_analyst_id) which
-- blocked managers from seeing opportunities unless they had an explicit
-- team relationship set up. Managers should see all opportunities.
-- Applied directly to staging 2026-07-02 during Management Workspace build.
-- ============================================================================

drop policy if exists opportunities_select_manager on opportunities;

create policy opportunities_select_manager on opportunities
  for select using (
    current_app_role() = 'MANAGER'
  );
