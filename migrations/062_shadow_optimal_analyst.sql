-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 062 -- shadow_trades.profile_analyst_id
-- ============================================================================
-- Tracks which analyst's historical profile a shadow trade was built from --
-- for shadow_system='ANALYST_MIRROR' this is the same analyst already assigned
-- to the opportunity (opportunities.assigned_analyst_id); for 'OPTIMAL' it's
-- whichever session-eligible analyst scored highest against this market/regime,
-- unconstrained by allocation/workload, and may differ from the assigned one.
-- ============================================================================

alter table shadow_trades
  add column if not exists profile_analyst_id uuid references analysts(analyst_id);

comment on column shadow_trades.profile_analyst_id is
  'Analyst whose profile this shadow trade''s direction/levels are based on. ANALYST_MIRROR: same as opportunities.assigned_analyst_id. OPTIMAL: whichever eligible analyst scored highest (confidence x |avgR| x alignmentMultiplier), unconstrained by allocation.';

create index if not exists idx_shadow_trades_profile_analyst_id
  on shadow_trades (profile_analyst_id)
  where profile_analyst_id is not null;
