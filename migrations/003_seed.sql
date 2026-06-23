-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.1 — Minimum Seed Data for First Deployment
-- ============================================================================

-- Service principals (one per system actor named in Sheet 39/43)
insert into service_principals (name, credential_mode, purpose, active) values
  ('SYSTEM_ENGINE',                 'SERVICE_ROLE_SHARED',     'Orchestrates engine_runs/engine_run_steps for session-aware generation.', true),
  ('SYSTEM_IMPORTER',               'SERVICE_ROLE_SHARED',     'Generic import orchestration actor for ingestion jobs.', true),
  ('SYSTEM_MONITOR',                'SERVICE_ROLE_SHARED',     'Watchdog/reconciliation jobs for stuck engine steps and notifications.', true),
  ('SYSTEM_CLAUDE',                 'EXTERNAL_WORKER_SECRET',  'Claude API coaching/review generation.', true),
  ('SYSTEM_RESEARCH',               'SERVICE_ROLE_SHARED',     'Research/automation-readiness aggregation jobs.', true),
  ('FINNHUB_IMPORTER',              'EXTERNAL_WORKER_SECRET',  'Market data ingestion from Finnhub.', true),
  ('ACUITY_CALENDAR_IMPORTER',      'EXTERNAL_WORKER_SECRET',  'Economic calendar ingestion from Acuity Calendar API.', true),
  ('ACUITY_PERFORMANCE_IMPORTER',   'EXTERNAL_WORKER_SECRET',  'Actual trade/performance ingestion from Acuity Performance API.', true);

-- Default team (Sheet 41: "start with one default APIP team unless business decides otherwise")
insert into teams (team_name, team_type, active) values
  ('APIP', 'APIP', true);

-- Session configuration (Sheet 00 V1.1 Locked Decisions / Sheet 18)
insert into session_configuration
  (session, publication_window_start_uk, publication_window_end_uk, engine_run_time_uk, expiry_rule, active)
values
  ('EUROPEAN', '06:00', '07:00', '05:45', 'European/US same day 21:00 UK', true),
  ('US',       '12:00', '14:00', '11:45', 'European/US same day 21:00 UK', true),
  ('APAC',     '16:00', '18:00', '15:45', 'APAC expiry next day 16:00 UK unless changed', true);

-- Model parameters: condition-awareness thresholds (Sheet 19)
insert into model_parameters (parameter_group, parameter_name, parameter_value, changed_by_type, changed_by_id)
select 'freshness', 'stale_price_atr_threshold', '{"value": 0.25, "unit": "atr_multiple"}'::jsonb,
       'SYSTEM', service_principal_id
from service_principals where name = 'SYSTEM_ENGINE';

insert into model_parameters (parameter_group, parameter_name, parameter_value, changed_by_type, changed_by_id)
select 'freshness', 'force_recalc_atr_threshold', '{"value": 0.50, "unit": "atr_multiple"}'::jsonb,
       'SYSTEM', service_principal_id
from service_principals where name = 'SYSTEM_ENGINE';

insert into model_parameters (parameter_group, parameter_name, parameter_value, changed_by_type, changed_by_id)
select 'rr', 'minimum_rr_floor', '{"value": 2.0, "unit": "risk_reward_ratio"}'::jsonb,
       'SYSTEM', service_principal_id
from service_principals where name = 'SYSTEM_ENGINE';

-- Fallback templates (Sheet 24/30 — used when Claude fails/times out/lints fail)
insert into fallback_templates (fallback_type, template_body, active) values
  ('COACHING_NOTE', 'This opportunity is within your suggested range. Review the entry, risk and target levels shown and apply your own judgement before acting.', true),
  ('REVIEW_NOTE',   'Your trade has been reviewed against the coaching recommendation shown at the time. Use this as a development reference alongside your own judgement.', true),
  ('WARNING_NOTE',  'Market conditions have shifted since this recommendation was generated. Treat the suggested levels with extra care.', true);

-- Notification SLA reference is enforced in application logic using these
-- severities (Sheet 29); seeding the enum values themselves is implicit in
-- the notification_severity type, no additional seed table required.
