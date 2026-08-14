-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 038 -- RLS policies for trade_disputes, audit_log, coaching_reviews
-- ============================================================================
-- RLS policies were created out-of-band alongside the tables in migrations
-- 036 and 037. Documented here with existence checks. The trade_disputes
-- policies here are identical to (and therefore harmlessly redundant with)
-- the ones in migration 048, written before these numbers were reclaimed --
-- whichever runs first in a full sequential migration creates them, the
-- other's guard sees the name already taken and no-ops.
--
-- Column names verified against live introspection before writing: all three
-- policy bodies below reference app_users.auth_user_id, confirmed as the real
-- column (not auth_id, which migration 048's first draft incorrectly used
-- before being corrected -- see that file's own note).
-- ============================================================================

-- Enable RLS
alter table trade_disputes enable row level security;
alter table audit_log enable row level security;
alter table coaching_reviews enable row level security;

-- trade_disputes: analysts see their own, managers/admins see all
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'trade_disputes'
    and policyname = 'trade_disputes_select_analyst'
  ) then
    execute $policy$
      create policy trade_disputes_select_analyst on trade_disputes
        for select using (
          raised_by_analyst_id = (
            select analyst_id from app_users
            where auth_user_id = auth.uid()
          )
        )
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'trade_disputes'
    and policyname = 'trade_disputes_select_manager'
  ) then
    execute $policy$
      create policy trade_disputes_select_manager on trade_disputes
        for select using (
          exists (
            select 1 from app_users
            where auth_user_id = auth.uid()
            and role in ('MANAGER', 'ADMIN')
          )
        )
    $policy$;
  end if;
end $$;

-- audit_log: managers/admins only
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'audit_log'
    and policyname = 'audit_log_select_manager'
  ) then
    execute $policy$
      create policy audit_log_select_manager on audit_log
        for select using (
          exists (
            select 1 from app_users
            where auth_user_id = auth.uid()
            and role in ('MANAGER', 'ADMIN')
          )
        )
    $policy$;
  end if;
end $$;

-- coaching_reviews: analysts see their own
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'coaching_reviews'
    and policyname = 'coaching_reviews_select_analyst'
  ) then
    execute $policy$
      create policy coaching_reviews_select_analyst on coaching_reviews
        for select using (
          trade_id in (
            select trade_id from actual_trades
            where analyst_id = (
              select analyst_id from app_users
              where auth_user_id = auth.uid()
            )
          )
        )
    $policy$;
  end if;
end $$;
