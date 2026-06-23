-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.1 — Core Database Schema
-- Target: Supabase Postgres
-- ============================================================================
-- Migration order rationale:
--   1. Extensions
--   2. Enums (no dependencies)
--   3. Identity & org tables (app_users, service_principals, teams)
--   4. Reference/master data (markets, analysts, session_configuration)
--   5. Engine orchestration (engine_runs, steps, dependencies)
--   6. Import/audit infrastructure (import_batches, import_errors)
--   7. Market intelligence (state, regime, economic calendar)
--   8. Core domain: opportunities -> recommendations -> coaching -> shadow -> actual trades
--   9. Allocation
--   10. Notifications / API governance
--   11. Reviews / profiles
--   12. Claude governance
--   13. KPIs / automation readiness
--   14. Audit log (last, since it can reference anything by table_name/record_id pattern)
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- optional: useful for text search later

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

create type app_role as enum ('ANALYST','MANAGER','EXECUTIVE','ADMIN','RESEARCH');
create type actor_type as enum ('USER','SYSTEM');
create type credential_mode as enum ('SERVICE_ROLE_SHARED','PER_PRINCIPAL_TOKEN','EXTERNAL_WORKER_SECRET');
create type team_type as enum ('APIP','RESEARCH','MANAGEMENT','OTHER');
create type membership_role as enum ('MEMBER','LEAD','OBSERVER');

create type session_type as enum ('EUROPEAN','US','APAC','CRYPTO');

create type engine_run_status as enum ('QUEUED','RUNNING','SUCCESS','PARTIAL_SUCCESS','FAILED','CANCELLED','TIMED_OUT');
create type engine_step_status as enum ('QUEUED','RUNNING','SUCCESS','FAILED','SKIPPED','RETRYING','TIMED_OUT');
create type dependency_type as enum ('REQUIRED','OPTIONAL','SOFT_BLOCKING');

create type source_system as enum ('FINNHUB','ACUITY_CALENDAR_API','ACUITY_PERFORMANCE_API','MANUAL_BACKFILL','CLAUDE');
create type import_batch_type as enum ('HISTORICAL_BACKFILL','INCREMENTAL_API_SYNC');
create type import_batch_status as enum ('QUEUED','RUNNING','SUCCESS','PARTIAL_SUCCESS','FAILED');
create type import_error_type as enum ('VALIDATION_FAILED','DUPLICATE','SCHEMA_MISMATCH','MISSING_REQUIRED_FIELD','PROVIDER_ERROR');

create type atr_zone as enum ('TOO_DEEP','ZONE_1','ZONE_2','ZONE_3','ZONE_4','TOO_HIGH');
create type volatility_state as enum ('LOW_VOL','NORMAL_VOL','HIGH_VOL','EXTREME_VOL');
create type trend_state as enum ('TRENDING_UP','TRENDING_DOWN','MIXED','RANGE');
create type regime_confidence as enum ('LOW','MEDIUM','HIGH');

create type event_impact as enum ('LOW','MEDIUM','HIGH');
create type event_risk_status as enum ('NONE','WATCH','HIGH_RISK','EVENT_ACTIVE','POST_EVENT_VOLATILITY');

create type opportunity_lifecycle_status as enum ('DRAFT','GENERATED','ASSIGNED','SHOWN','ACTIVE','CLOSED','CANCELLED');
create type direction_type as enum ('BUY','SELL');
create type analyst_action as enum ('ENTER_NOW','WAIT_FOR_PREFERRED_ZONE','REVIEW_ONLY');

create type recommendation_validity_status as enum (
  'VALID','CAUTION_VOLATILITY','STALE_PRICE','ZONE_CHANGED',
  'ENTRY_ALREADY_PASSED','DO_NOT_USE_RECALCULATE','RECALCULATING','ARCHIVED'
);

create type confidence_label as enum ('LOW','MEDIUM','HIGH');

create type allocation_status as enum ('RECOMMENDED','ASSIGNED','OVERRIDDEN','UNASSIGNED','CANCELLED');
create type assigned_by_type as enum ('SYSTEM','USER');

create type trade_outcome_status as enum ('NOT_TRIGGERED','TRIGGERED','TARGET_HIT','STOP_HIT','EXPIRY','CANCELLED','AMBIGUOUS');

create type review_status as enum ('PENDING','GENERATED','ACKNOWLEDGED','MANAGER_REVIEWED','CLOSED');
create type alignment_level as enum ('HIGH','MODERATE','LOW');
create type direction_alignment as enum ('ALIGNED','PARTIAL','DIFFERENT');

create type notification_type as enum (
  'STALE_RECOMMENDATION','IMPORT_FAILURE','ENGINE_FAILURE','ALLOCATION_CONFLICT',
  'CLAUDE_FAILURE','API_QUOTA_WARNING','RECALCULATION_FAILED','OTHER'
);
create type notification_severity as enum ('INFO','WARNING','CRITICAL','SYSTEM_FAILURE');
create type notification_status as enum ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED','ESCALATED');

create type prompt_type as enum ('ANALYST_COACHING','POST_TRADE_REVIEW','MANAGER_SUMMARY','RESEARCH_COMMENTARY');
create type fallback_type as enum ('COACHING_NOTE','REVIEW_NOTE','WARNING_NOTE');
create type lint_status as enum ('PASSED','FAILED','NOT_RUN');
create type regression_status as enum ('RUNNING','PASSED','FAILED','PARTIAL');

create type api_usage_status as enum ('SUCCESS','FAILED','RATE_LIMITED','TIMEOUT');
create type quota_alert_type as enum ('COST_THRESHOLD','RATE_LIMIT_LOW','RATE_LIMITED','USAGE_SPIKE');
create type quota_alert_severity as enum ('INFO','WARNING','CRITICAL');

create type kpi_visibility as enum ('EXECUTIVE','MANAGER','ANALYST_OWN','RESEARCH');
create type kpi_freshness as enum ('INTRADAY','DAILY','WEEKLY','MONTHLY');

create type audit_action as enum ('CREATE','UPDATE','DELETE','OVERRIDE','APPROVE','REGENERATE','RUN_ENGINE');

-- ============================================================================
-- 2. IDENTITY & ORG
-- ============================================================================

create table app_users (
  app_user_id   uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  email         text not null unique,
  display_name  text not null,
  role          app_role not null,
  analyst_id    uuid null,  -- fk added after analysts table exists
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table service_principals (
  service_principal_id uuid primary key default gen_random_uuid(),
  name                  text not null unique,  -- SYSTEM_ENGINE, SYSTEM_IMPORTER, SYSTEM_MONITOR, SYSTEM_CLAUDE, SYSTEM_RESEARCH, FINNHUB_IMPORTER, ACUITY_CALENDAR_IMPORTER, ACUITY_PERFORMANCE_IMPORTER
  credential_mode       credential_mode not null,
  purpose               text not null,
  active                boolean not null default true
);

create table teams (
  team_id     uuid primary key default gen_random_uuid(),
  team_name   text not null,
  team_type   team_type,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table team_members (
  team_member_id   uuid primary key default gen_random_uuid(),
  team_id          uuid not null references teams(team_id) on delete cascade,
  app_user_id      uuid not null references app_users(app_user_id) on delete cascade,
  analyst_id       uuid null, -- fk added after analysts table exists
  membership_role  membership_role not null default 'MEMBER',
  active           boolean not null default true,
  effective_from   timestamptz not null default now(),
  effective_to     timestamptz null,
  constraint uq_team_member unique (team_id, app_user_id, effective_from)
);

create table team_managers (
  team_manager_id           uuid primary key default gen_random_uuid(),
  team_id                   uuid not null references teams(team_id) on delete cascade,
  manager_user_id           uuid not null references app_users(app_user_id) on delete cascade,
  can_override_allocation   boolean not null default false,
  can_view_coaching_reviews boolean not null default true,
  receives_escalations      boolean not null default true,
  active                    boolean not null default true,
  constraint uq_team_manager unique (team_id, manager_user_id)
);

-- ============================================================================
-- 3. REFERENCE / MASTER DATA
-- ============================================================================

create table markets (
  market_id     uuid primary key default gen_random_uuid(),
  symbol        text not null,
  finnhub_symbol text,
  asset_class   text not null,        -- FX, INDEX, COMMODITY, CRYPTO, EQUITY
  session       session_type,
  active        boolean not null default true,
  excluded      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_markets_symbol unique (symbol)
);

create table analysts (
  analyst_id   uuid primary key default gen_random_uuid(),
  app_user_id  uuid references app_users(app_user_id),
  display_name text not null,
  active       boolean not null default true,
  sessions     session_type[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table app_users   add constraint fk_app_users_analyst    foreign key (analyst_id) references analysts(analyst_id);
alter table team_members add constraint fk_team_members_analyst foreign key (analyst_id) references analysts(analyst_id);

create table analyst_availability (
  availability_id uuid primary key default gen_random_uuid(),
  analyst_id      uuid not null references analysts(analyst_id) on delete cascade,
  date            date not null,
  session         session_type not null,
  available       boolean not null default true,
  workload_cap    int,
  reason          text,
  created_at      timestamptz not null default now(),
  constraint uq_availability unique (analyst_id, date, session)
);

create table session_configuration (
  session_config_id          uuid primary key default gen_random_uuid(),
  session                    session_type not null unique,
  publication_window_start_uk time not null,
  publication_window_end_uk   time not null,
  engine_run_time_uk           time not null,
  expiry_rule                  text not null,
  active                       boolean not null default true
);

create table model_parameters (
  parameter_id      uuid primary key default gen_random_uuid(),
  parameter_group   text not null,
  parameter_name    text not null,
  parameter_value   jsonb not null,
  effective_from    timestamptz not null default now(),
  effective_to      timestamptz null,
  active            boolean not null default true,
  changed_by_type   actor_type not null,
  changed_by_id     uuid not null,
  constraint uq_param_active_window unique (parameter_group, parameter_name, effective_from)
);
create index idx_model_parameters_lookup on model_parameters (parameter_group, parameter_name, active);

-- ============================================================================
-- 4. ENGINE ORCHESTRATION
-- ============================================================================

create table engine_runs (
  engine_run_id     uuid primary key default gen_random_uuid(),
  run_type          text not null,
  session           session_type,
  window_start      timestamptz not null,
  window_end        timestamptz not null,
  idempotency_key   text not null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  status            engine_run_status not null default 'QUEUED',
  triggered_by_type actor_type not null,
  triggered_by_id   uuid not null,
  error_summary     text,
  constraint uq_engine_run_idempotency unique (idempotency_key)
);
create index idx_engine_runs_lookup on engine_runs (run_type, session, window_start, status);

create table engine_run_steps (
  engine_run_step_id        uuid primary key default gen_random_uuid(),
  engine_run_id             uuid not null references engine_runs(engine_run_id) on delete cascade,
  step_name                 text not null,
  started_at                timestamptz,
  finished_at               timestamptz,
  status                    engine_step_status not null default 'QUEUED',
  retry_count               int not null default 0,
  max_expected_duration_seconds int,
  error_detail              text,
  output_summary            jsonb,
  constraint uq_run_step unique (engine_run_id, step_name)
);
create index idx_engine_run_steps_status on engine_run_steps (status, started_at);

create table engine_run_step_dependencies (
  dependency_id       uuid primary key default gen_random_uuid(),
  engine_run_step_id  uuid not null references engine_run_steps(engine_run_step_id) on delete cascade,
  depends_on_step_id  uuid not null references engine_run_steps(engine_run_step_id) on delete cascade,
  dependency_type     dependency_type not null default 'REQUIRED',
  constraint uq_step_dependency unique (engine_run_step_id, depends_on_step_id),
  constraint chk_no_self_dependency check (engine_run_step_id <> depends_on_step_id)
);

-- ============================================================================
-- 5. IMPORT / INGESTION AUDIT INFRASTRUCTURE
-- ============================================================================

create table import_batches (
  import_batch_id     uuid primary key default gen_random_uuid(),
  source_system        source_system not null,
  target_table         text not null,
  batch_type           import_batch_type not null,
  triggered_by_type    actor_type not null,
  triggered_by_id      uuid not null,
  date_range_start     timestamptz,
  date_range_end       timestamptz,
  status               import_batch_status not null default 'QUEUED',
  total_rows           int not null default 0,
  success_rows         int not null default 0,
  duplicate_rows       int not null default 0,
  error_rows           int not null default 0,
  checksum_or_summary  jsonb,
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),
  constraint chk_batch_row_reconciliation check (
    status <> 'SUCCESS' or total_rows = success_rows + duplicate_rows + error_rows
  )
);
create index idx_import_batches_lookup on import_batches (source_system, target_table, batch_type, status);

create table import_errors (
  import_error_id   uuid primary key default gen_random_uuid(),
  import_batch_id   uuid not null references import_batches(import_batch_id) on delete cascade,
  source_record_id  text,
  error_type        import_error_type not null,
  error_detail      text not null,
  raw_payload       jsonb not null,
  resolved          boolean not null default false,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index idx_import_errors_batch on import_errors (import_batch_id, resolved);

-- ============================================================================
-- 6. MARKET INTELLIGENCE
-- ============================================================================

create table market_state_daily (
  market_state_id  uuid primary key default gen_random_uuid(),
  market_id        uuid not null references markets(market_id),
  date             date not null,
  open             numeric, high numeric, low numeric, close numeric,
  atr14            numeric,
  zone             atr_zone,
  source_system    source_system not null default 'FINNHUB',
  source_record_id text,
  import_batch_id  uuid references import_batches(import_batch_id),
  imported_at      timestamptz,
  raw_payload      jsonb,
  constraint uq_market_state_daily unique (market_id, date)
);

create table market_state_intraday (
  market_state_intraday_id uuid primary key default gen_random_uuid(),
  market_id           uuid not null references markets(market_id),
  session             session_type not null,
  captured_at         timestamptz not null default now(),
  current_price       numeric not null,
  current_zone        atr_zone not null,
  session_high        numeric,
  session_low         numeric,
  intraday_range_atr  numeric,
  volatility_state    volatility_state
);
create index idx_market_state_intraday_lookup on market_state_intraday (market_id, session, captured_at desc);

create table market_regime_state (
  market_regime_state_id uuid primary key default gen_random_uuid(),
  market_id        uuid not null references markets(market_id),
  captured_at      timestamptz not null default now(),
  session          session_type,
  trend_state      trend_state,
  volatility_state volatility_state,
  regime_tags      jsonb,
  regime_confidence regime_confidence,
  derived_from     jsonb
);
create index idx_market_regime_state_lookup on market_regime_state (market_id, captured_at desc);

create table economic_calendar_events (
  event_id          uuid primary key default gen_random_uuid(),
  source_system     source_system not null default 'ACUITY_CALENDAR_API',
  source_event_id   text,
  source_record_id  text not null,
  event_time_uk     timestamptz not null,
  country           text,
  currency          text,
  event_name        text not null,
  impact            event_impact not null,
  forecast          text,
  previous          text,
  actual            text,
  revision_number   int not null default 0,
  last_updated_at   timestamptz not null default now(),
  import_batch_id   uuid references import_batches(import_batch_id),
  imported_at       timestamptz,
  raw_payload       jsonb,
  constraint uq_economic_event_source unique (source_system, source_record_id)
);
create index idx_economic_events_lookup on economic_calendar_events (event_time_uk, currency, impact);

create table economic_event_revisions (
  event_revision_id uuid primary key default gen_random_uuid(),
  event_id          uuid not null references economic_calendar_events(event_id) on delete cascade,
  revision_number   int not null,
  captured_at       timestamptz not null default now(),
  forecast          text, previous text, actual text,
  raw_payload       jsonb,
  constraint uq_event_revision unique (event_id, revision_number)
);

create table market_event_risk (
  market_event_risk_id uuid primary key default gen_random_uuid(),
  event_id            uuid not null references economic_calendar_events(event_id) on delete cascade,
  market_id           uuid not null references markets(market_id) on delete cascade,
  risk_window_start   timestamptz not null,
  risk_window_end     timestamptz not null,
  event_risk_status   event_risk_status not null default 'NONE',
  risk_score          numeric,
  analyst_warning      text,
  constraint uq_market_event_risk unique (event_id, market_id)
);
create index idx_market_event_risk_window on market_event_risk (market_id, risk_window_start, risk_window_end);

-- ============================================================================
-- 7. CORE DOMAIN: OPPORTUNITY -> RECOMMENDATION -> COACHING -> SHADOW -> ACTUAL
-- ============================================================================

create table opportunities (
  opportunity_id            uuid primary key default gen_random_uuid(),
  date                      date not null,
  market_id                 uuid not null references markets(market_id),
  session                   session_type not null,
  publication_window_start_uk time not null,
  publication_window_end_uk   time not null,
  current_zone              atr_zone not null,
  preferred_entry_zone      atr_zone not null,
  direction                 direction_type not null,
  expected_r                numeric not null,
  trigger_probability       numeric not null,
  opportunity_lifecycle_status opportunity_lifecycle_status not null default 'DRAFT',
  analyst_action            analyst_action,
  assigned_analyst_id       uuid references analysts(analyst_id),
  version                   int not null default 1,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint uq_opportunity unique (date, market_id, session, version)
);
create index idx_opportunities_status on opportunities (opportunity_lifecycle_status, session, date);

create table recommendation_versions (
  recommendation_version_id uuid primary key default gen_random_uuid(),
  opportunity_id            uuid not null references opportunities(opportunity_id) on delete cascade,
  version_number            int not null,
  generated_at              timestamptz not null default now(),
  shown_at                  timestamptz,
  price_at_generation       numeric not null,
  zone_at_generation        atr_zone not null,
  recommendation_validity_status recommendation_validity_status not null default 'VALID',
  parameter_snapshot        jsonb not null,
  event_risk_status         event_risk_status,
  regime_tags               jsonb,
  requires_refresh          boolean not null default false,
  is_active                 boolean not null default true,
  entry_range_low           numeric not null,
  entry_range_high          numeric not null,
  risk_range                text not null,
  target_range              text not null,
  constraint uq_recommendation_version unique (opportunity_id, version_number)
);
create index idx_recommendation_versions_active on recommendation_versions (opportunity_id, is_active);
create index idx_recommendation_versions_status on recommendation_versions (recommendation_validity_status, requires_refresh);

create table coaching_recommendations (
  recommendation_id                  uuid primary key default gen_random_uuid(),
  opportunity_id                     uuid not null references opportunities(opportunity_id) on delete cascade,
  active_recommendation_version_id   uuid not null references recommendation_versions(recommendation_version_id),
  analyst_id                         uuid not null references analysts(analyst_id),
  entry_range_low  numeric not null, entry_range_high numeric not null,
  risk_range       text not null,    target_range     text not null,
  trigger_probability numeric not null,
  expected_r       numeric not null,
  coaching_note     text not null,
  shown_at          timestamptz not null default now(),
  constraint uq_coaching_recommendation unique (opportunity_id, analyst_id)
);
create index idx_coaching_recommendations_analyst on coaching_recommendations (analyst_id, shown_at desc);

-- Shadow trades: highest-stakes hidden table in the platform
create table shadow_trades (
  shadow_trade_id           uuid primary key default gen_random_uuid(),
  opportunity_id            uuid not null references opportunities(opportunity_id) on delete cascade,
  recommendation_version_id uuid not null references recommendation_versions(recommendation_version_id),
  entry numeric not null, stop numeric not null, target numeric not null,
  rr numeric not null,
  confidence_label confidence_label not null,
  template_source  text not null,
  visible_to_analyst boolean not null default false,
  created_at timestamptz not null default now(),
  constraint chk_shadow_never_visible check (visible_to_analyst = false)
);

create table shadow_trade_outcomes (
  shadow_outcome_id   uuid primary key default gen_random_uuid(),
  shadow_trade_id     uuid not null references shadow_trades(shadow_trade_id) on delete cascade,
  trade_outcome_status trade_outcome_status not null default 'NOT_TRIGGERED',
  result_r            numeric,
  outcome_timestamp   timestamptz,
  created_at          timestamptz not null default now()
);

create table actual_trades (
  trade_id                  uuid primary key default gen_random_uuid(),
  source_system             source_system not null,
  source_record_id          text not null,
  historical_backfill       boolean not null default false,
  import_batch_id           uuid not null references import_batches(import_batch_id),
  imported_at               timestamptz not null default now(),
  opportunity_id             uuid references opportunities(opportunity_id),
  recommendation_version_id  uuid references recommendation_versions(recommendation_version_id),
  published_at              timestamptz not null,
  analyst_id                uuid not null references analysts(analyst_id),
  market_id                 uuid not null references markets(market_id),
  session                   session_type not null,
  direction                 direction_type not null,
  entry numeric not null, stop numeric, target numeric,
  expiry timestamptz,
  triggered boolean not null default false,
  closed_at timestamptz,
  result_r numeric,
  raw_payload jsonb not null,
  constraint uq_actual_trade_source unique (source_system, source_record_id),
  -- Historical backfill rows must NOT carry platform recommendation linkage; the
  -- platform did not exist at the time, so any link would be fabricated/misleading.
  constraint chk_backfill_no_recommendation_link check (
    historical_backfill = false
    or (opportunity_id is null and recommendation_version_id is null)
  )
);
create index idx_actual_trades_analyst on actual_trades (analyst_id, published_at desc);
create index idx_actual_trades_backfill on actual_trades (historical_backfill);

-- ============================================================================
-- 8. ALLOCATION
-- ============================================================================

create table coverage_allocation (
  allocation_id        uuid primary key default gen_random_uuid(),
  opportunity_id       uuid not null references opportunities(opportunity_id) on delete cascade,
  assigned_analyst_id  uuid not null references analysts(analyst_id),
  team_id              uuid not null references teams(team_id),
  allocation_status    allocation_status not null default 'RECOMMENDED',
  allocation_score     numeric,
  eligible_analysts    jsonb not null,
  assigned_by_type     assigned_by_type not null,
  assigned_by_id       uuid not null,
  assigned_at          timestamptz not null default now(),
  override_reason      text,
  lock_version         int not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint uq_coverage_allocation unique (opportunity_id)
);
create index idx_coverage_allocation_analyst on coverage_allocation (assigned_analyst_id, team_id);

create table allocation_decision_log (
  allocation_decision_id uuid primary key default gen_random_uuid(),
  allocation_id          uuid not null references coverage_allocation(allocation_id) on delete cascade,
  opportunity_id          uuid not null references opportunities(opportunity_id),
  candidate_analyst_id    uuid not null references analysts(analyst_id),
  market_fit_score       numeric,
  regime_fit_score       numeric,
  workload_score         numeric,
  availability_score     numeric,
  final_score            numeric not null,
  reason_summary         text not null,
  created_at              timestamptz not null default now()
);
create index idx_allocation_decision_log_allocation on allocation_decision_log (allocation_id);

-- ============================================================================
-- 9. NOTIFICATIONS / API GOVERNANCE
-- ============================================================================

create table notifications (
  notification_id           uuid primary key default gen_random_uuid(),
  team_id                   uuid references teams(team_id),
  recipient_user_id         uuid references app_users(app_user_id),
  recipient_role            app_role,
  notification_type         notification_type not null,
  severity                  notification_severity not null,
  title                     text not null,
  message                   text not null,
  related_table             text,
  related_id                text,
  notification_status       notification_status not null default 'OPEN',
  sla_due_at                timestamptz,
  escalated_at              timestamptz,
  escalation_target_role    app_role,
  escalation_target_team_id uuid references teams(team_id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index idx_notifications_open on notifications (notification_status, severity, sla_due_at);
create index idx_notifications_recipient on notifications (recipient_user_id, recipient_role, notification_status);

create table api_usage_logs (
  api_usage_id         uuid primary key default gen_random_uuid(),
  provider             text not null,
  endpoint             text,
  used_at              timestamptz not null default now(),
  request_count        int not null default 1,
  tokens_input         int,
  tokens_output        int,
  latency_ms           int,
  estimated_cost       numeric,
  rate_limit_remaining int,
  status               api_usage_status not null,
  related_engine_run_id uuid references engine_runs(engine_run_id),
  error_summary        text
);
create index idx_api_usage_logs_provider on api_usage_logs (provider, used_at desc);

create table api_quota_alerts (
  api_quota_alert_id uuid primary key default gen_random_uuid(),
  provider           text not null,
  alert_type         quota_alert_type not null,
  severity           quota_alert_severity not null,
  threshold_value    numeric,
  observed_value     numeric,
  window_start       timestamptz not null,
  window_end         timestamptz not null,
  notification_id    uuid references notifications(notification_id),
  created_at         timestamptz not null default now()
);

-- ============================================================================
-- 10. REVIEWS / PROFILES
-- ============================================================================

create table coaching_reviews (
  review_id                  uuid primary key default gen_random_uuid(),
  trade_id                   uuid not null references actual_trades(trade_id),
  recommendation_version_id  uuid not null references recommendation_versions(recommendation_version_id),
  review_status              review_status not null default 'PENDING',
  direction_alignment         direction_alignment not null,
  entry_alignment             alignment_level not null,
  risk_alignment               alignment_level not null,
  target_alignment             alignment_level not null,
  alignment_score              numeric not null,
  improvement_opportunity_r    numeric not null,
  analyst_facing_review         text not null,
  acknowledged_at               timestamptz,
  created_at                    timestamptz not null default now()
);
create index idx_coaching_reviews_trade on coaching_reviews (trade_id);

create table analyst_profiles (
  profile_id                       uuid primary key default gen_random_uuid(),
  analyst_id                       uuid not null references analysts(analyst_id) on delete cascade,
  market_id                        uuid references markets(market_id),
  direction                        direction_type,
  zone                             atr_zone,
  includes_historical_backfill     boolean not null default false,
  profile_source_window_start      date,
  profile_source_window_end        date,
  requires_recommendation_version  boolean not null default false,
  profile_data                     jsonb not null,
  generated_at                     timestamptz not null default now()
);
create index idx_analyst_profiles_analyst on analyst_profiles (analyst_id, market_id);

create table template_profiles (
  template_id     uuid primary key default gen_random_uuid(),
  market_id       uuid references markets(market_id),
  zone            atr_zone,
  direction       direction_type,
  sample_size     int not null,
  strength_score  numeric,
  template_data   jsonb,
  generated_at    timestamptz not null default now()
);

create table trigger_probability_profiles (
  trigger_profile_id uuid primary key default gen_random_uuid(),
  market_id          uuid references markets(market_id),
  zone               atr_zone,
  session            session_type,
  sample_size        int not null,
  trigger_probability numeric not null,
  generated_at       timestamptz not null default now()
);

-- ============================================================================
-- 11. CLAUDE GOVERNANCE
-- ============================================================================

create table golden_set_scenarios (
  golden_scenario_id  uuid primary key default gen_random_uuid(),
  scenario_name       text not null,
  prompt_type         prompt_type not null,
  structured_input    jsonb not null,
  expected_constraints jsonb not null,
  active              boolean not null default true,
  created_by          uuid not null references app_users(app_user_id),
  approved_by         uuid references app_users(app_user_id),
  approved_at         timestamptz
);

create table prompt_templates (
  prompt_template_id       uuid primary key default gen_random_uuid(),
  prompt_type              prompt_type not null,
  version                  int not null,
  template_body            text not null,
  active                   boolean not null default false,
  requires_regression_pass boolean not null default true,
  latest_regression_run_id uuid, -- fk added after prompt_regression_runs exists
  approved_by              uuid references app_users(app_user_id),
  approved_at              timestamptz,
  constraint uq_prompt_template_version unique (prompt_type, version),
  -- A prompt cannot be marked active unless it has passed regression, per Sheet 30/34.
  constraint chk_active_requires_regression check (
    active = false or requires_regression_pass = false or latest_regression_run_id is not null
  )
);

create table prompt_regression_runs (
  prompt_regression_run_id  uuid primary key default gen_random_uuid(),
  prompt_template_id        uuid not null references prompt_templates(prompt_template_id) on delete cascade,
  run_started_at             timestamptz not null default now(),
  run_finished_at             timestamptz,
  status                      regression_status not null default 'RUNNING',
  scenarios_tested            int not null default 0,
  scenarios_passed            int not null default 0,
  scenarios_failed            int not null default 0,
  failure_summary             text,
  approved_for_activation     boolean not null default false,
  approved_by                 uuid references app_users(app_user_id),
  approved_at                 timestamptz
);

alter table prompt_templates
  add constraint fk_prompt_templates_latest_run
  foreign key (latest_regression_run_id) references prompt_regression_runs(prompt_regression_run_id);

create table fallback_templates (
  fallback_template_id uuid primary key default gen_random_uuid(),
  fallback_type         fallback_type not null,
  template_body         text not null,
  active                boolean not null default true
);

create table claude_generation_logs (
  claude_generation_id      uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  prompt_type               prompt_type not null,
  prompt_template_id        uuid references prompt_templates(prompt_template_id),
  fallback_template_id      uuid references fallback_templates(fallback_template_id),
  related_table             text,
  related_id                text,
  recommendation_version_id uuid references recommendation_versions(recommendation_version_id),
  review_id                 uuid references coaching_reviews(review_id),
  latency_ms                int,
  success                   boolean not null,
  used_fallback             boolean not null default false,
  lint_status               lint_status not null default 'NOT_RUN',
  input_hash                text,
  output_hash                text,
  error_message              text,
  -- Per Sheet 30: failed-lint output must never be the saved/displayed text.
  -- This is enforced in application code; the flag here makes the invariant auditable.
  constraint chk_lint_failed_requires_fallback check (
    lint_status <> 'FAILED' or used_fallback = true
  )
);
create index idx_claude_generation_logs_related on claude_generation_logs (related_table, related_id);

-- ============================================================================
-- 12. KPIs / AUTOMATION READINESS
-- ============================================================================

create table executive_kpis (
  kpi_id                      uuid primary key default gen_random_uuid(),
  period_start                date not null,
  period_end                  date not null,
  team_id                      uuid references teams(team_id),
  analyst_id                   uuid references analysts(analyst_id),
  kpi_name                     text not null,
  kpi_value                    jsonb not null,
  kpi_visibility                kpi_visibility not null,
  includes_historical_backfill  boolean not null default false,
  requires_recommendation_version boolean not null default false,
  data_freshness                kpi_freshness not null,
  generated_at                   timestamptz not null default now()
);
create index idx_executive_kpis_lookup on executive_kpis (kpi_name, period_start, period_end, team_id, analyst_id);

create table automation_readiness_metrics (
  automation_metric_id uuid primary key default gen_random_uuid(),
  market_id            uuid references markets(market_id),
  analyst_id            uuid references analysts(analyst_id),
  period_start          date not null,
  period_end            date not null,
  shadow_avg_r          numeric not null,
  actual_avg_r          numeric not null,
  framework_advantage_r numeric not null,
  trigger_accuracy      numeric,
  opportunity_accuracy  numeric,
  automation_readiness_index numeric not null,
  generated_at          timestamptz not null default now()
);

-- ============================================================================
-- 13. AUDIT LOG
-- ============================================================================

create table audit_events (
  audit_event_id uuid primary key default gen_random_uuid(),
  actor_type      actor_type not null,
  actor_id        uuid not null,
  action          audit_action not null,
  table_name      text not null,
  record_id       text not null,
  before_value    jsonb,
  after_value     jsonb,
  created_at      timestamptz not null default now()
);
create index idx_audit_events_lookup on audit_events (table_name, record_id, created_at desc);
create index idx_audit_events_actor on audit_events (actor_id, created_at desc);

-- ============================================================================
-- 14. PARTITIONING NOTES (Sheet 32) — apply at volume, not Phase 1 launch
-- ============================================================================
-- market_state_intraday: strong candidate for monthly partition by captured_at
-- recommendation_versions: consider monthly partition by generated_at before high volume
-- actual_trades: consider monthly partition by published_at if high volume
-- audit_events: consider quarterly/monthly partition by created_at
-- Deferred until real volume data exists; indexes above are sufficient for Phase 1.
