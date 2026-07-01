-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.7 prep -- review_status on post_trade_reviews
-- ============================================================================
-- Per spec sheet 21 (Status State Machine) and product clarification:
-- the analyst acknowledgement workflow requires review_status on the
-- post_trade_reviews table.
--
-- Values: PENDING (generated but analyst not yet notified), GENERATED
-- (coaching review generated and shown), ACKNOWLEDGED (analyst has
-- read/acknowledged), MANAGER_REVIEWED (manager has reviewed), CLOSED.
-- ============================================================================

alter table post_trade_reviews
  add column review_status text not null default 'PENDING'
  check (review_status in ('PENDING', 'GENERATED', 'ACKNOWLEDGED', 'MANAGER_REVIEWED', 'CLOSED'));

comment on column post_trade_reviews.review_status is
  'Lifecycle status of this post-trade review. PENDING: generated, analyst not yet notified. GENERATED: shown to analyst. ACKNOWLEDGED: analyst has read it. MANAGER_REVIEWED: manager has reviewed. CLOSED: no further action required.';
