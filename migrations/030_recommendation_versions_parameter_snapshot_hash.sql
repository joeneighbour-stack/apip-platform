-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.5 Step 5 — parameter_snapshot_hash as a first-class column
-- ============================================================================
-- Per product clarification: this is used frequently for equivalence checks
-- (ValidationService, Architecture Section 10) and should not require
-- re-hashing the full parameter_snapshot jsonb every time. The jsonb itself
-- still carries the complete parameters; the hash column is the fast,
-- indexable, deterministic reference -- not a duplicate source of truth,
-- just a precomputed lookup key.
-- ============================================================================

alter table recommendation_versions add column parameter_snapshot_hash text;

comment on column recommendation_versions.parameter_snapshot_hash is
  'sha256 hash of parameter_snapshot, computed via stableHash() (intelligence-engine/src/services/stableHash.ts) -- verified byte-for-byte equivalent to the research notebook''s stable_hash(). Used for fast equivalence comparison without re-hashing the full jsonb.';

-- Also add to engine_validation_runs if that table is created without it --
-- 029_entry_zone_reconstruction_function.sql did not touch that table, and
-- it does not exist yet (it's part of Step 9 / ValidationService, not yet
-- built) -- noted here so whoever builds 029's successor table remembers
-- to include parameter_snapshot_hash as a column from the start, not added
-- retroactively.
