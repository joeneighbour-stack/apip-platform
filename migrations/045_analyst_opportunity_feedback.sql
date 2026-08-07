-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- My Workspace redesign -- lightweight per-opportunity analyst feedback
-- ============================================================================
-- One feedback row per (analyst, opportunity) -- "was this recommendation
-- useful", not a review or a dispute. Written by the analyst themselves via
-- POST /api/analyst/feedback, upserted on (analyst_id, opportunity_id) so
-- clicking the other button just changes the analyst's mind rather than
-- creating a second row.
-- ============================================================================

create table analyst_opportunity_feedback (
  feedback_id   uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(opportunity_id),
  analyst_id    uuid not null references analysts(analyst_id),
  feedback      text not null check (feedback in ('useful', 'not_useful')),
  created_at    timestamptz not null default now(),
  constraint uq_analyst_opportunity_feedback unique (analyst_id, opportunity_id)
);

comment on table analyst_opportunity_feedback is
  'Lightweight "was this opportunity useful" feedback from the analyst workspace card, one row per analyst per opportunity (upserted).';

alter table analyst_opportunity_feedback enable row level security;

-- Analysts manage only their own feedback rows.
create policy analyst_opportunity_feedback_select_own on analyst_opportunity_feedback
  for select using (
    current_app_role() = 'ANALYST' and analyst_id = current_analyst_id()
  );

create policy analyst_opportunity_feedback_insert_own on analyst_opportunity_feedback
  for insert with check (
    current_app_role() = 'ANALYST' and analyst_id = current_analyst_id()
  );

create policy analyst_opportunity_feedback_update_own on analyst_opportunity_feedback
  for update using (
    current_app_role() = 'ANALYST' and analyst_id = current_analyst_id()
  );

-- Research and admin unrestricted read, same pattern as post_trade_reviews
-- (035_post_trade_reviews_rls.sql) and other analyst-authored tables.
create policy analyst_opportunity_feedback_select_research_admin on analyst_opportunity_feedback
  for select using (current_app_role() in ('RESEARCH', 'ADMIN'));
