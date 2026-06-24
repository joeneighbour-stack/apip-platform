-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — analyst_external_codes (supplement, pre-backfill)
-- ============================================================================
-- Acuity's performance data identifies analysts by short codes, and a given
-- analyst can have MULTIPLE codes (e.g. Mona Hassan appears as MOH, MPH,
-- MOM, MONA, plus two confirmed data-entry variants JOL and NOH in the
-- historical spreadsheet). A single column on `analysts` cannot represent
-- a one-to-many relationship -- this needed a real mapping table, not a
-- column, caught before being built the wrong way.
--
-- Codes are stored uppercase; the backfill script normalizes incoming codes
-- to uppercase before lookup, since the source data has inconsistent casing
-- ('taf' vs 'TAF', 'JoD' vs 'JOD' -- same person, different case).
-- ============================================================================

create table analyst_external_codes (
  analyst_external_code_id uuid primary key default gen_random_uuid(),
  analyst_id   uuid not null references analysts(analyst_id) on delete cascade,
  source_system source_system not null default 'ACUITY_PERFORMANCE_API',
  external_code text not null,
  created_at    timestamptz not null default now(),
  constraint uq_analyst_external_code unique (source_system, external_code)
);
create index idx_analyst_external_codes_lookup on analyst_external_codes (source_system, external_code);

comment on table analyst_external_codes is
  'Maps Acuity Performance API / backfill spreadsheet analyst short codes to analysts.analyst_id. One analyst can have multiple codes.';
