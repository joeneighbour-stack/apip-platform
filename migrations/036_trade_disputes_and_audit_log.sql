-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 036 -- trade_disputes and audit_log
-- ============================================================================
-- These tables were created out-of-band (Supabase Studio) without a tracked
-- migration. This file documents the authoritative schema as confirmed from
-- live PostgREST OpenAPI introspection on 2026-08-14. See also migration 048
-- (written before this one existed, since these numbers -- 036-038, the real
-- out-of-band creation order between 035 and 039 -- were only reclaimed
-- afterwards) which independently documents trade_disputes and its RLS.
-- Both are guarded (create table/type if not exists), so whichever of the two
-- runs first in a full sequential migration is authoritative for actually
-- creating anything; the other becomes a no-op. Verified their trade_disputes/
-- dispute_type/dispute_status definitions now agree exactly, so it doesn't
-- matter which one "wins".
--
-- Two corrections made against the originally-drafted version of this file,
-- both confirmed via live introspection before writing:
--   - dispute_type's live value set is ('MISSED_TRIGGER', 'WRONG_ENTRY',
--     'WRONG_OUTCOME', 'OTHER') -- the draft had ('WRONG_OUTCOME',
--     'MISSED_TRIGGER', 'WRONG_DIRECTION', 'DATA_ERROR', 'OTHER'), which
--     doesn't match at all (extra/wrong values, missing WRONG_ENTRY).
--   - audit_log.changed_by_id is a real FK to app_users.app_user_id live,
--     missing its `references` clause in the draft -- added.
-- Table comments below use the real live comment text (also fetched via
-- introspection) rather than redrafted summaries, so this migration can't
-- regress either comment to something less accurate if it's ever the one
-- that actually runs.
-- ============================================================================

-- Enum types
do $$ begin
  if not exists (select 1 from pg_type where typname = 'dispute_type') then
    create type dispute_type as enum (
      'MISSED_TRIGGER', 'WRONG_ENTRY', 'WRONG_OUTCOME', 'OTHER'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'dispute_status') then
    create type dispute_status as enum (
      'OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'audit_change_type') then
    create type audit_change_type as enum (
      'INSERT', 'UPDATE', 'DELETE'
    );
  end if;
end $$;

create table if not exists trade_disputes (
  dispute_id            uuid primary key default gen_random_uuid(),
  trade_id              uuid not null references actual_trades(trade_id),
  raised_by_analyst_id  uuid not null references analysts(analyst_id),
  dispute_type          dispute_type not null,
  analyst_note          text,
  admin_note            text,
  original_values       jsonb not null,
  override_values       jsonb,
  status                dispute_status not null default 'OPEN',
  resolved_by_id        uuid references app_users(app_user_id),
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists audit_log (
  audit_id            uuid primary key default gen_random_uuid(),
  table_name          text not null,
  record_id           uuid not null,
  changed_by_id       uuid not null references app_users(app_user_id),
  change_type         audit_change_type not null,
  before_values       jsonb,
  after_values        jsonb,
  reason              text,
  related_dispute_id  uuid references trade_disputes(dispute_id),
  created_at          timestamptz not null default now()
);

comment on table trade_disputes is
  'Analyst-initiated disputes against actual_trades records. When resolved, admin updates actual_trades directly and writes an audit_log entry. The original_values snapshot here preserves what the record looked like at the time of the dispute, since actual_trades will be mutated on resolution.';

comment on table audit_log is
  'Immutable audit trail for admin overrides and sensitive mutations. Never update or delete rows from this table -- append only. For actual_trades overrides, always include related_dispute_id and reason.';
