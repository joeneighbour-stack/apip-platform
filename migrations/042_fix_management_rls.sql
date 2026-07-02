-- ============================================================================
-- APIP Phase 1.7 -- Fix RLS blocking Management Workspace
-- Applied directly to staging 2026-07-02 during Management Workspace build.
-- ============================================================================

-- 1. coverage_allocation: remove manages_team restriction for managers
-- managers should see all allocations, not just ones for teams they manage
drop policy if exists coverage_allocation_select_manager on coverage_allocation;

create policy coverage_allocation_select_manager on coverage_allocation
  for select using (
    current_app_role() = 'MANAGER'
  );

-- 2. analysts: RLS was enabled with no policies (default deny)
-- all authenticated users need to read analyst display names
create policy analysts_select_authenticated on analysts
  for select using (auth.uid() is not null);
