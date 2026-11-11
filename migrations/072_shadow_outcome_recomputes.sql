-- ============================================================================
-- APIP Trading Intelligence & Performance Platform
-- Migration 072 -- shadow_outcome_recomputes audit table
-- ============================================================================
-- Audit trail for historical re-monitoring of shadow trades (see
-- intelligence-engine/src/scripts/recomputeShadowOutcomes.ts). One row per
-- shadow_trade_outcomes row whose outcome a recompute changed, holding the
-- values before and after, so every historical change can be reviewed and
-- reverted.
--
-- Motivating fix: monitorShadowTrades.ts's entry scan (and its sibling
-- co-trigger block) could trigger on 5-min bars from before the trade's own
-- generated_at; both now ignore any bar before max(generated_at, monitor_from).
-- ============================================================================

create table shadow_outcome_recomputes (
  recompute_id         uuid primary key default gen_random_uuid(),
  recompute_batch_id   uuid not null,
  shadow_trade_id      uuid not null references shadow_trades(shadow_trade_id) on delete cascade,
  shadow_outcome_id    uuid not null references shadow_trade_outcomes(shadow_outcome_id) on delete cascade,

  old_status           trade_outcome_status not null,
  old_result_r         numeric,
  old_triggered_at     timestamptz,
  old_closed_at        timestamptz,

  new_status           trade_outcome_status not null,
  new_result_r         numeric,
  new_triggered_at     timestamptz,
  new_closed_at        timestamptz,

  reason               text not null,
  recomputed_at        timestamptz not null default now()
);

create index shadow_outcome_recomputes_trade_idx on shadow_outcome_recomputes (shadow_trade_id);
create index shadow_outcome_recomputes_batch_idx on shadow_outcome_recomputes (recompute_batch_id);

alter table shadow_outcome_recomputes enable row level security;
