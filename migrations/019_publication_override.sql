-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Phase 1.4 — Manual override workflow for analyst_publications
-- ============================================================================
-- Joe's requirement: ability to review untriggered publications and correct
-- them when they actually did trigger (or, symmetrically, undo a wrong
-- auto-trigger) -- circumstances the automatic (date, market_id) match
-- against actual_trades won't catch (e.g. data lag, a trade recorded
-- outside the normal flow). This is a human-in-the-loop correction on top
-- of the automatic reconciliation already built, not a replacement for it.
-- ============================================================================

alter type reconciliation_status add value 'MANUAL_OVERRIDE_TRIGGERED';
alter type reconciliation_status add value 'MANUAL_OVERRIDE_UNTRIGGERED';

alter table analyst_publications add column overridden_by_user_id uuid references app_users(app_user_id);
alter table analyst_publications add column overridden_at timestamptz;
alter table analyst_publications add column override_reason text;

-- SECURITY DEFINER + an internal role check, rather than relying solely on
-- a table-level UPDATE policy -- this keeps the authorization decision in
-- one place (this function) regardless of which RLS policies exist on the
-- table, mirroring how shadow_trades' protections don't depend on any
-- single policy being correct.
create or replace function override_publication_triggered(
  p_publication_id     uuid,
  p_new_effective_triggered boolean,
  p_override_reason    text,
  p_matched_trade_id   uuid default null
) returns void language plpgsql security definer as $$
declare
  v_actor_role app_role;
  v_actor_user_id uuid;
  v_new_status reconciliation_status;
begin
  v_actor_role := current_app_role();
  v_actor_user_id := current_app_user_id();

  if v_actor_role not in ('ADMIN', 'RESEARCH') then
    raise exception 'override_publication_triggered: role % is not permitted to override publication reconciliation', v_actor_role;
  end if;

  if p_override_reason is null or length(trim(p_override_reason)) = 0 then
    raise exception 'override_publication_triggered: override_reason is required, not optional -- this is an audit-sensitive action';
  end if;

  v_new_status := case when p_new_effective_triggered then 'MANUAL_OVERRIDE_TRIGGERED'::reconciliation_status
                       else 'MANUAL_OVERRIDE_UNTRIGGERED'::reconciliation_status end;

  update analyst_publications set
    effective_triggered = p_new_effective_triggered,
    reconciliation_status = v_new_status,
    matched_trade_id = coalesce(p_matched_trade_id, matched_trade_id),
    overridden_by_user_id = v_actor_user_id,
    overridden_at = now(),
    override_reason = p_override_reason
  where publication_id = p_publication_id;

  if not found then
    raise exception 'override_publication_triggered: no analyst_publications row found for id %', p_publication_id;
  end if;

  insert into audit_events (actor_type, actor_id, action, table_name, record_id, after_value)
    values ('USER', v_actor_user_id, 'OVERRIDE', 'analyst_publications', p_publication_id::text,
            jsonb_build_object('effective_triggered', p_new_effective_triggered, 'reason', p_override_reason, 'matched_trade_id', p_matched_trade_id));
end;
$$;

-- Convenience view for the review workflow: untriggered publications that
-- have NOT already been through any reconciliation override, ordered most
-- recent first. This is what a review UI would query rather than the raw
-- table, so the "needs review" definition lives in one place.
create view publications_needing_review as
  select publication_id, source_record_id, analyst_id, market_id, published_at,
         direction, entry, stop, target, original_triggered, effective_triggered,
         reconciliation_status
  from analyst_publications
  where effective_triggered = false
    and reconciliation_status in ('WEBHOOK_FALSE_CONFIRMED', 'AMBIGUOUS_MULTIPLE_MATCHES')
  order by published_at desc;
grant select on publications_needing_review to authenticated;
