-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 037 -- coaching_reviews
-- ============================================================================
-- Original coaching review table from the platform spec. Created out-of-band.
-- NOTE: This table has 0 rows (confirmed live) and was superseded by
-- post_trade_reviews (migration 033), which uses a simpler text-based
-- alignment model rather than enums. coaching_reviews is retained for schema
-- completeness but post_trade_reviews is the active table used by
-- generatePostTradeReviews.ts.
--
-- CORRECTION to the originally-drafted version of this migration, confirmed
-- via live PostgREST introspection before writing: the four alignment
-- columns do NOT share one enum type. Live reality is two distinct types:
--   - direction_alignment uses its own enum, also named direction_alignment,
--     with values ('ALIGNED', 'PARTIAL', 'DIFFERENT').
--   - entry_alignment, risk_alignment and target_alignment all share a
--     second enum, alignment_level, with values ('HIGH', 'MODERATE', 'LOW').
-- The draft instead defined a single alignment_rating enum
-- ('HIGH', 'MEDIUM', 'LOW', 'NONE') and used it for all four columns --
-- neither the type name nor any of its values match what's actually live.
-- Since this table has 0 rows and create table if not exists already no-ops
-- against the live database, this wouldn't have broken anything running here
-- -- but would have created the wrong types entirely on a fresh environment.
-- review_status's enum (name and 5 values) matched the live type exactly, no
-- change needed there.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'review_status') then
    create type review_status as enum (
      'PENDING', 'GENERATED', 'ACKNOWLEDGED', 'MANAGER_REVIEWED', 'CLOSED'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'direction_alignment') then
    create type direction_alignment as enum (
      'ALIGNED', 'PARTIAL', 'DIFFERENT'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'alignment_level') then
    create type alignment_level as enum (
      'HIGH', 'MODERATE', 'LOW'
    );
  end if;
end $$;

create table if not exists coaching_reviews (
  review_id                  uuid primary key default gen_random_uuid(),
  trade_id                   uuid not null references actual_trades(trade_id),
  recommendation_version_id  uuid not null references recommendation_versions(recommendation_version_id),
  review_status              review_status not null default 'PENDING',
  direction_alignment        direction_alignment not null,
  entry_alignment            alignment_level not null,
  risk_alignment             alignment_level not null,
  target_alignment           alignment_level not null,
  alignment_score            numeric not null,
  improvement_opportunity_r  numeric not null,
  analyst_facing_review      text not null,
  acknowledged_at            timestamptz,
  created_at                 timestamptz not null default now()
);

comment on table coaching_reviews is
  'Original spec coaching review table -- superseded by post_trade_reviews. '
  'Retained for schema completeness. 0 rows, not populated by any active script.';
