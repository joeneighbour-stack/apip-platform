-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.7 prep -- RLS policies for post_trade_reviews
-- ============================================================================
-- post_trade_reviews was created in migration 033, after 002_rls.sql.
-- RLS is already ENABLED (confirmed via pg_tables) but has zero policies --
-- default-deny means nobody can currently read it.
--
-- Uses the same helper functions as 002_rls.sql:
--   current_app_role() -- returns the role of the current auth user
--   current_analyst_id() -- returns analyst_id for the current auth user
--   manages_analyst(analyst_id) -- true if the current user manages that analyst
-- ============================================================================

-- Analysts see only reviews linked to their own trades
create policy post_trade_reviews_select_own on post_trade_reviews
  for select using (
    current_app_role() = 'ANALYST'
    and exists (
      select 1 from actual_trades at_
      where at_.trade_id = post_trade_reviews.trade_id
        and at_.analyst_id = current_analyst_id()
    )
  );

-- Analysts can update review_status to ACKNOWLEDGED on their own reviews
create policy post_trade_reviews_update_own on post_trade_reviews
  for update using (
    current_app_role() = 'ANALYST'
    and exists (
      select 1 from actual_trades at_
      where at_.trade_id = post_trade_reviews.trade_id
        and at_.analyst_id = current_analyst_id()
    )
  )
  with check (review_status = 'ACKNOWLEDGED');

-- Managers see reviews for analysts they manage
create policy post_trade_reviews_select_manager on post_trade_reviews
  for select using (
    current_app_role() = 'MANAGER'
    and exists (
      select 1 from actual_trades at_
      where at_.trade_id = post_trade_reviews.trade_id
        and manages_analyst(at_.analyst_id)
    )
  );

-- Managers can update review_status (to MANAGER_REVIEWED or CLOSED)
create policy post_trade_reviews_update_manager on post_trade_reviews
  for update using (
    current_app_role() in ('MANAGER', 'ADMIN')
  );

-- Research and admin unrestricted read
create policy post_trade_reviews_select_research_admin on post_trade_reviews
  for select using (
    current_app_role() in ('RESEARCH', 'ADMIN')
  );
