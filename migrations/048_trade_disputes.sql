-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 048 -- trade_disputes table
-- ============================================================================
-- This table was created out-of-band (Supabase Studio) without a tracked
-- migration. This migration documents the authoritative schema as confirmed
-- from PostgREST's OpenAPI introspection on 2026-08-14.
--
-- CORRECTION to the originally-drafted version of this migration:
-- dispute_type and status are real Postgres enum types live (public.dispute_type,
-- public.dispute_status), not plain text as first drafted -- confirmed via the
-- same introspection ("format": "public.dispute_type" / "public.dispute_status"
-- on those two columns, with their allowed-value sets). Typing them as plain
-- text here would have been harmless against the current live database (create
-- table if not exists already no-ops there), but wrong for any fresh
-- environment this migration is ever run against from scratch -- it would
-- create the table with the wrong column types instead of matching production.
-- resolved_by_id is also a real FK to app_users.app_user_id live (confirmed via
-- introspection) and was missing its `references` clause in the first draft.
-- The RLS policies below also referenced app_users.auth_id, which does not
-- exist -- the real column (confirmed via introspection) is auth_user_id.
-- Left as-written, this DO block would have failed outright with "column
-- auth_id does not exist" the first time it ran somewhere these policy names
-- weren't already taken.
--
-- RLS policies exist live but were also created out-of-band -- documented
-- here for reference, applied only if not exists. Their exact definitions
-- (beyond the column-name fix above) are not independently verified against
-- pg_policies -- no direct Postgres connection was available in this
-- environment, only PostgREST, which doesn't expose policy bodies. The
-- if-not-exists guard makes this safe to run regardless: it creates the
-- policy only if the name isn't already taken, and no-ops otherwise, so it
-- can't clobber whatever the real out-of-band policy actually says.
-- ============================================================================

-- Enum types -- both already exist live; guarded since Postgres has no
-- CREATE TYPE IF NOT EXISTS.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'dispute_type') then
    create type dispute_type as enum ('MISSED_TRIGGER', 'WRONG_ENTRY', 'WRONG_OUTCOME', 'OTHER');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'dispute_status') then
    create type dispute_status as enum ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');
  end if;
end $$;

-- Create table (idempotent -- table already exists live)
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

comment on table trade_disputes is
  'Analyst or manager-raised disputes against actual_trades outcomes. '
  'Resolution updates actual_trades directly; original values preserved in original_values for audit. '
  'Created out-of-band (pre-migration-048) -- this migration documents the authoritative schema.';

comment on column trade_disputes.original_values is
  'Snapshot of actual_trades fields at dispute creation time (entry, stop, result_r, triggered, direction, published_at).';

comment on column trade_disputes.override_values is
  'Values applied to actual_trades on resolution (exit_price, computed_result_r, triggered). '
  'Null until dispute is resolved.';

comment on column trade_disputes.raised_by_analyst_id is
  'The analyst whose trade this is. When raised by a manager on behalf of an analyst, '
  'this is still the analyst -- the manager attribution is recorded in admin_note.';

-- RLS (applied only if not exists -- policies were created out-of-band)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'trade_disputes' and policyname = 'trade_disputes_select_analyst'
  ) then
    execute $policy$
      create policy trade_disputes_select_analyst on trade_disputes
        for select using (
          raised_by_analyst_id = (
            select analyst_id from app_users where auth_user_id = auth.uid()
          )
        )
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'trade_disputes' and policyname = 'trade_disputes_select_manager'
  ) then
    execute $policy$
      create policy trade_disputes_select_manager on trade_disputes
        for select using (
          exists (
            select 1 from app_users where auth_user_id = auth.uid()
            and role in ('MANAGER', 'ADMIN')
          )
        )
    $policy$;
  end if;
end $$;
