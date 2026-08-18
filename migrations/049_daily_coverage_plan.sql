-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 049 -- daily_coverage_plan
-- ============================================================================
-- Written by preallocateDay.ts, a lightweight day-start pass that scores and
-- assigns every market across all three sessions (EUROPEAN + US + APAC) at
-- 04:20 UTC, before any session's real engine run (populate-daily at 04:28,
-- first engine run at 04:48) and before that day's own regime derivation
-- (04:33) -- see that script's header comment for why it deliberately scores
-- off yesterday's market_regime_state rather than waiting for today's.
--
-- Advisory only, not authoritative: opportunities/coaching_recommendations
-- (written later, per session, by runEngineSession.ts) remain the real
-- source of truth for what an analyst is actually assigned and shown --
-- this table exists purely so an analyst can see a full-day coverage
-- forecast first thing in the morning, before EUROPEAN's own engine run has
-- even started. The two can and will sometimes disagree: each session's
-- real run re-scores with that day's live regime and its own cross-session
-- workload seeding from `opportunities`, not from this table.
-- ============================================================================

create table if not exists daily_coverage_plan (
  plan_id     uuid primary key default gen_random_uuid(),
  date        date not null,
  analyst_id  uuid not null references analysts(analyst_id),
  market_id   uuid not null references markets(market_id),
  session     text not null,
  created_at  timestamptz not null default now(),
  unique(date, market_id, session)
);

create index if not exists idx_daily_coverage_plan_date_analyst
  on daily_coverage_plan (date, analyst_id);

comment on table daily_coverage_plan is
  'Day-start (04:20 UTC) coverage forecast written by preallocateDay.ts, scored off yesterday''s market_regime_state since today''s regime hasn''t been derived yet. Advisory only -- opportunities/coaching_recommendations from each session''s real engine run remain authoritative and may assign differently once that day''s live regime and cross-session workload are known.';

alter table daily_coverage_plan enable row level security;

-- Analysts see their own day's plan; managers/admins see everyone's.
create policy daily_coverage_plan_select_own on daily_coverage_plan
  for select using (
    current_app_role() = 'ANALYST' and analyst_id = current_analyst_id()
  );

create policy daily_coverage_plan_select_manager_admin on daily_coverage_plan
  for select using (current_app_role() in ('MANAGER', 'ADMIN'));
