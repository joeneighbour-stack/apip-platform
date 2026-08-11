-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Analyst-specific ATR stop/target profiles for the entry optimizer
-- ============================================================================
-- One row per (analyst, direction, zone) -- the ATR-normalised stop/target
-- distribution generateAtrProfiles.ts computes from that analyst's own
-- actual_trades, joined to market_state_daily for atr14. Read by
-- entryOptimizerService.ts (via analystAtrProfileService.ts / runEngineSession.ts's
-- preloaded map) to replace the team-wide DEFAULT_PROFILES fallback with an
-- analyst-specific one where enough history exists (>= 10 qualifying trades).
-- ============================================================================

create table analyst_atr_profiles (
  analyst_atr_profile_id uuid primary key default gen_random_uuid(),
  analyst_id uuid not null references analysts(analyst_id),
  direction text not null check (direction in ('BUY', 'SELL')),
  zone text not null,
  trade_count int not null,
  stop_atr_q25 numeric not null,
  stop_atr_median numeric not null,
  stop_atr_q75 numeric not null,
  target_atr_q25 numeric not null,
  target_atr_median numeric not null,
  target_atr_q75 numeric not null,
  generated_at timestamptz not null default now(),
  unique(analyst_id, direction, zone)
);

comment on table analyst_atr_profiles is
  'Per-analyst ATR-normalised stop/target quartiles (q25/median/q75), by direction and entry zone -- generated weekly by generateAtrProfiles.ts, full delete-and-reinsert per run. Consumed by entryOptimizerService.ts as the analyst-specific override for its team-wide DEFAULT_PROFILES.';

alter table analyst_atr_profiles enable row level security;

-- Same read policy as its sibling analyst_profiles (002_rls.sql) -- research/
-- admin unrestricted, managers scoped to analysts they manage. Written only by
-- generateAtrProfiles.ts via the service-role client, which bypasses RLS, so
-- no insert/update/delete policy is needed for the engine's own writes.
create policy analyst_atr_profiles_select_manager_research on analyst_atr_profiles
  for select using (
    current_app_role() in ('RESEARCH','ADMIN')
    or (current_app_role() = 'MANAGER' and manages_analyst(analyst_id))
  );
