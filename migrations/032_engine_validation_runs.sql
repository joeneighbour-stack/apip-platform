-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.5 Step 9 — engine_validation_runs
-- ============================================================================
-- Per Architecture Section 10.2 (table definition) and Section 10.6
-- (Amendment 4: resolution_type column, distinguishing methodology changes
-- from production bug fixes in the audit trail).
--
-- This is new, not retrofitted onto recommendation_versions -- equivalence
-- checking is a verification activity that happens AFTER a recommendation
-- is generated and persisted, potentially repeatedly (e.g. re-validated
-- after a notebook update), and conflating it with the recommendation's
-- own row would violate the same single-responsibility principle Section 3's
-- persistence-boundary design is built on.
-- ============================================================================

create table engine_validation_runs (
  validation_run_id             uuid primary key default gen_random_uuid(),
  recommendation_version_id     uuid not null references recommendation_versions(recommendation_version_id),
  research_engine_version       text not null,   -- e.g. 'APIP_RESEARCH_ENGINE_V1_0'
  production_engine_version     text not null,   -- git commit hash or semver of the deployed service code
  parameter_snapshot_hash       text not null,
  recommendation_hash           text not null,   -- stableHash() of the production output
  research_recommendation_hash  text,            -- stableHash() of the notebook's equivalent output, when available
  equivalence_status            text not null check (equivalence_status in ('MATCH', 'DRIFT_DETECTED', 'NOT_COMPARABLE')),
  drift_detail                  jsonb,           -- BehaviouralDifferenceReport structure (Section 10.5) when DRIFT_DETECTED
  -- Section 10.6 (Amendment 4): distinguishes methodology changes from
  -- production bug fixes in the audit trail. null = unresolved.
  resolution_type               text check (resolution_type in ('NOTEBOOK_UPDATED', 'PRODUCTION_BUG_FIXED', 'ACCEPTED_AS_INTENTIONAL_VARIANCE')),
  validated_at                  timestamptz not null default now()
);

comment on table engine_validation_runs is
  'Records the outcome of each behavioural equivalence check between the production pipeline and the research notebook. Per Architecture Section 10: equivalence checking is a standing, continuous process (not a one-time migration), ideally run as a CI gate on every change to any Section 3 service.';

comment on column engine_validation_runs.resolution_type is
  'How a DRIFT_DETECTED result was resolved. NOTEBOOK_UPDATED = the notebook was updated (a methodology change, notebook is the source of truth). PRODUCTION_BUG_FIXED = the production pipeline was corrected (a behavioural-equivalence violation). ACCEPTED_AS_INTENTIONAL_VARIANCE = a documented, approved departure (e.g. V1.3 TOO_DEEP clamping). null = unresolved. Per Section 10.6 (Amendment 4).';
