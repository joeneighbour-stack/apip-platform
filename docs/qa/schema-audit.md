# Schema & Migration Audit — Phase 1 of Pre-Launch QA

**Date:** 2026-08-18
**Scope:** Cross-reference of the 55 live Supabase tables against `migrations/001`–`050` and code references in `apps/web` and `intelligence-engine/src`.
**Method:** Static analysis only — no live database queries were run (no direct Postgres connection is available to this audit, only the PostgREST service-role client used elsewhere in this repo, which doesn't expose `pg_catalog`/`information_schema`). "Referenced in code" means a direct `.from('table_name')` call, or — where that returned nothing — a manual check for RPC calls, comments, and alternate access patterns before concluding a table is unreferenced. `apps/web/types/database.ts` is Supabase's auto-generated type mirror of the *entire* live schema; a table appearing only there does not count as a code reference, since every one of the 55 tables appears there by construction.

## Summary

| Finding | Count |
|---|---|
| Live tables | 55 |
| Documented by a `create table` in migrations 001–050 | 55 |
| **Undocumented tables (Section C + D)** | **0** |
| Active in code (Section A) | 30 |
| Documented but zero direct code references (Section B) | 25 |
| Tables with RLS enabled + policies documented in migrations | 47 (+2 enabled outside migrations, see §5) |
| Tables with **no RLS enable statement and no policy** anywhere in migrations | 6 |

The headline result: **every live table traces to a `create table` statement in the migration history** — there is no schema drift where the live DB has tables the migrations don't know about. The real finding is the opposite direction: roughly half the schema (25 of 55 tables) has no code path reading or writing it today, per §B below.

---

## A. Fully documented and active

Table exists in migrations **and** is queried (`.from(...)`) by real application code in `apps/web` or `intelligence-engine/src`.

| Table | Migration | Referenced in |
|---|---|---|
| actual_trades | 001 | apps/web (multiple), intelligence-engine (multiple) |
| analyst_atr_profiles | 046 | intelligence-engine (`generateAtrProfiles.ts`, `runEngineSession.ts`, `analystAtrProfileService.ts`) |
| analyst_availability | 001 | apps/web (`management/page.tsx`, `analyst/availability`, `api/absence/*`), intelligence-engine (`runEngineSession.ts`, `preallocateDay.ts`) |
| analyst_profiles | 001 | apps/web (`workspaceData.ts`), intelligence-engine (`generateAnalystProfiles.ts`, `runShadowTriggerProbability.ts`, `preallocateDay.ts`) |
| analyst_publications | 014 | apps/web (`analyticsCache.ts`, `shadowBreakdown.ts`, management pages), intelligence-engine (`importActualTrades.ts`, `calculateKpis.ts`, `importHistoricalTrades.ts`) |
| analysts | 001 | apps/web (multiple), intelligence-engine (multiple) |
| analytics_cache | 050 | apps/web (`analyticsCache.ts`) |
| app_users | 001 | apps/web (`auth.ts` and most API routes) |
| audit_events | 001 | apps/web (`app/actions/disputes.ts`) |
| coaching_recommendations | 001 | apps/web (`workspaceData.ts`, `opportunities/page.tsx`), intelligence-engine (`importActualTrades.ts`, `runEngineSession.ts`, `generatePostTradeReviews.ts`, `backfillTradeLinks.ts`) |
| coverage_allocation | 001 | apps/web (`management/page.tsx`), intelligence-engine (`runEngineSession.ts`) |
| daily_coverage_plan | 049 | apps/web (`dashboard/analyst/page.tsx`), intelligence-engine (`preallocateDay.ts`) |
| engine_run_steps | 001 | intelligence-engine (`runEngineSession.ts`) |
| engine_runs | 001 | apps/web (`admin/page.tsx`, `admin/engine/retry`), intelligence-engine (`runEngineSession.ts`) |
| executive_kpis | 001 | apps/web (`analystProfile.ts`, management/performance), intelligence-engine (`calculateKpis.ts`, `calculateShadowKpis.ts`, `runEngineSession.ts`) |
| import_batches | 001 | intelligence-engine (`importActualTrades.ts`, `importHistoricalTrades.ts`) |
| market_event_risk | 001 | apps/web (`workspaceData.ts`) — **see caveat below** |
| market_regime_state | 001 | apps/web (`workspaceData.ts`), intelligence-engine (`generateAnalystProfiles.ts`, `deriveMarketRegime.ts`, `runEngineSession.ts`, `preallocateDay.ts`) |
| market_state_daily | 001 | apps/web (`workspaceData.ts`), intelligence-engine (multiple) |
| market_state_intraday | 001 | apps/web (`workspaceData.ts`), intelligence-engine (`captureIntradaySnapshot.ts`, `runEngineSession.ts`, `runConditionAwareness.ts`) |
| markets | 001 | apps/web (multiple), intelligence-engine (multiple) |
| notifications | 001 | apps/web (`admin/page.tsx`, `api/notifications/update`), intelligence-engine (`runConditionAwareness.ts`) |
| opportunities | 001 | apps/web (`workspaceData.ts`, `opportunities/page.tsx`, `management/page.tsx`), intelligence-engine (multiple) |
| post_trade_reviews | 033 | apps/web (`analystProfile.ts`, `management/page.tsx`, `analyst/monitor/page.tsx`), intelligence-engine (`generatePostTradeReviews.ts`, `calculateKpis.ts`) |
| recommendation_versions | 001 | intelligence-engine (`runEngineSession.ts`, `runConditionAwareness.ts`) |
| service_principals | 001 | intelligence-engine (`importActualTrades.ts`) |
| shadow_trade_outcomes | 001 | apps/web (`shadowBreakdown.ts`, `management/shadow/page.tsx`, `management/performance/page.tsx`), intelligence-engine (`runShadowTriggerProbability.ts`, `runShadowOutcomeLifecycle.ts`, `monitorShadowTrades.ts`) |
| shadow_trades | 001 | apps/web (`shadowBreakdown.ts`), intelligence-engine (`runEngineSession.ts`, `calculateShadowKpis.ts`, `monitorShadowTrades.ts`) |
| teams | 001 | intelligence-engine (`runEngineSession.ts`, `calculateShadowKpis.ts`) |
| trade_disputes | 036 (+048) | apps/web (`management/page.tsx`, `analyst/monitor/page.tsx`, `app/actions/disputes.ts`) |

**Caveat — `market_event_risk`:** confirmed read by `apps/web/lib/workspaceData.ts`, so it correctly belongs in Section A by the letter of the audit criterion. But no write path was found: the only logic that computes event-risk rows (`intelligence-engine/src/services/economicCalendarService.ts`'s `mapEventRisk`) is called exclusively from a unit test (`__tests__/marketRegimeAndCalendar.test.ts`), never from a production script (`runEngineSession.ts`, `preallocateDay.ts`, etc.), and never fed by a query against `economic_calendar_events`. In practice this table is very likely always empty in production — worth a follow-up ticket, not just a documentation note.

---

## B. Documented but potentially dead (zero direct code references)

Table exists in migrations, but no `.from('table_name')` call (or other real usage) was found anywhere in `apps/web` or `intelligence-engine/src`. Each was cross-checked beyond the initial `.from()` scan (RPC calls, comments, related service files) before being placed here.

### B1 — Genuinely load-bearing despite no direct query (do not treat as removal candidates)

| Table | Migration | Why it's not actually dead |
|---|---|---|
| team_managers | 001 | Never queried via `.from()` by app code, but read *inside* the `manages_analyst()` Postgres function (`migrations/002_rls.sql`), which every manager-scoped RLS policy across the schema depends on (e.g. `post_trade_reviews_select_manager`, `actual_trades_select_manager`). Access is enforced transparently by Postgres RLS, not by an application-level query. |
| team_members | 001 | Same as above — read by `manages_analyst()` and by RLS policies gating `app_users`, `notifications`, `coverage_allocation`. |

### B2 — No code reference and no clear indirect usage (candidates for review)

| Table | Migration | Notes |
|---|---|---|
| allocation_decision_log | 001 | Audit-log style table for `coverage_allocation` decisions; has RLS + a select policy, but nothing writes or reads it in either codebase. |
| analyst_external_codes | 010 | Seeded with real data (migration 011) for cross-system ID mapping, but never queried in code — importer scripts appear to match on other fields directly. |
| analyst_opportunity_feedback | 045 | Full RLS policy set (select/insert/update, own + research/admin), but no `.from()` call in either codebase. Feature scaffolding that doesn't appear wired to a UI yet. |
| api_quota_alerts | 001 | No producer or consumer found. |
| api_usage_logs | 001 | No producer or consumer found — no rate-limiting/usage-tracking code references it. |
| audit_log | 036 | Distinct from `audit_events` (which *is* active, Section A). Has RLS + a manager-select policy (038) but no code writes to it. |
| automation_readiness_metrics | 001 | No producer or consumer found. |
| claude_generation_logs | 001 | No producer or consumer found — no Claude/LLM generation call site logs to this table. |
| coaching_reviews | 001 (RLS refreshed 037/038) | Notable: earlier work in this repo fixed this table's `direction_alignment`/`alignment_level` enum types, but no code in either app currently reads or writes it. Possibly mid-migration to/from `coaching_recommendations`, or a planned feature not yet built. |
| economic_calendar_events | 001 | See the `market_event_risk` caveat above — the ingestion + consumption pipeline for this table doesn't appear wired up. `mapEventRisk()` exists and is tested, but isn't called from production code. |
| economic_event_revisions | 001 | Same story as `economic_calendar_events`. |
| engine_run_step_dependencies | 001 | `engine_run_steps` (parent) is actively used by `runEngineSession.ts`, but the dependencies table itself is never queried. |
| engine_validation_runs | 032 | No code reference in either codebase; also has no RLS (see §5). |
| fallback_templates | 001 | Part of the prompt-template/Claude-generation cluster below — none of that cluster is referenced in code. |
| golden_set_scenarios | 001 | Same cluster. |
| import_errors | 001 | `import_batches` (parent) is actively used by the importer scripts, but nothing writes error rows to this table — errors appear to be handled some other way (logs/console) today. |
| market_symbol_aliases | 017 | The most surprising finding here: this table has real, substantial seed data across **six** migrations (017, 021, 023–027, "waves" 1–5), and its own header comment says *"Lookup order in importer code: try market_symbol_aliases for the calling..."* — but `importActualTrades.ts` and `importHistoricalTrades.ts` contain no mention of "alias" at all, and no RPC call resolves through it either. The intended fallback-lookup behavior described in the migration was seemingly never implemented, or was implemented differently and later reverted. Worth checking with whoever owns the importer pipeline before assuming this is safe to ignore. |
| model_parameters | 001 | Confirmed orphaned directly by the app's own comments: `apps/web/components/admin/ThresholdsPanel.tsx` — *"thresholds are currently hardcoded in the engine. This UI is a placeholder for future model_parameters table integration"* — and `apps/web/app/api/admin/thresholds/update/route.ts` — *"This endpoint is NOT wired to model_parameters yet -- it returns a 501."* |
| prompt_regression_runs | 001 | Prompt-template/Claude-generation cluster, unused. |
| prompt_templates | 001 | Same cluster. |
| session_configuration | 001 | No code reference found; session logic (EUROPEAN/US/APAC) appears to be hardcoded in `engine-trigger/index.js`'s cron schedule and script logic rather than read from this table. |
| template_profiles | 001 | Related in name/RLS grouping to `analyst_profiles` (which is active) and to `intelligence-engine/src/services/templateService.ts` (whose header comment references "build_template_profiles"), but that service computes template profiles in memory — no `.from('template_profiles')` call exists anywhere. |
| trigger_probability_profiles | 001 | `runShadowTriggerProbability.ts` computes and writes trigger probabilities into `analyst_profiles` instead — this table appears to be an earlier or alternate design that was superseded. |

---

## C. Undocumented but active (table in DB, used in code, no migration)

**None.** Every one of the 55 live tables has a `create table` statement in migrations 001–050 (see the mapping in Section A/B above). No schema drift found in this direction.

## D. Undocumented and unreferenced (candidates for removal)

**None**, for the same reason as C — there is no live table without a corresponding migration. Section B above is the closest equivalent (documented, but no code reference); those are candidates for a *usage* review, not a *schema drift* cleanup, since removing them means dropping a table migrations still describe.

---

## 5. RLS audit

Checked `migrations/002_rls.sql` (the primary RLS migration) plus every later migration that touches RLS: `004_rls_tests.sql`, `018_publication_rls.sql`, `035_post_trade_reviews_rls.sql`, `038_disputes_and_reviews_rls.sql`, `040_fix_opportunities_rls_manager.sql`, `042_fix_management_rls.sql`, `045_analyst_opportunity_feedback.sql` (§RLS block), `046_analyst_atr_profiles.sql` (§RLS block), `049_daily_coverage_plan.sql` (§RLS block).

### Tables with no RLS enable statement and no policy documented anywhere in migrations

| Table | Notes |
|---|---|
| analyst_availability | Actively used (Section A) — holds analyst absence/availability data. No RLS found in any migration. Worth prioritizing given it's live-queried by both the analyst-facing and management UI. |
| analyst_external_codes | Cross-system ID mapping (Section B2, unused in code) — lower urgency but still a gap. |
| market_symbol_aliases | Symbol alias mapping (Section B2, unused in code) — lower urgency. |
| service_principals | Actively used (Section A) — identity table for system/service accounts (`importActualTrades.ts`). No RLS found. |
| engine_validation_runs | Unused in code (Section B2). |
| analytics_cache | **Intentional, not a gap** — this table's own migration (`050_analytics_cache.sql`) documents *"No RLS needed: accessed only via the service-role client (`createAdminClient()`), never from a user session."* Listed here for completeness only. |

Excluding the intentional `analytics_cache` case, **5 tables have a genuine RLS documentation gap**: `analyst_availability`, `analyst_external_codes`, `market_symbol_aliases`, `service_principals`, `engine_validation_runs`. Two of these (`analyst_availability`, `service_principals`) are actively queried in production code, which makes them the higher-priority gap to close first.

### Tables with policies but no `enable row level security` statement in migrations (RLS enabled outside tracked migrations)

| Table | Notes |
|---|---|
| post_trade_reviews | `035_post_trade_reviews_rls.sql`'s own header comment explains this directly: *"post_trade_reviews was created in migration 033, after 002_rls.sql. RLS is already ENABLED (confirmed via pg_tables) but has zero policies."* I.e. RLS was turned on outside the tracked migration history (likely via the Supabase dashboard at table-creation time), and 035 only adds the missing policies. Not a gap — just a case where the migration files don't tell the full story. |
| analysts | `042_fix_management_rls.sql` adds `analysts_select_authenticated`, but no migration file contains `alter table analysts enable row level security`. Given the `post_trade_reviews` precedent above, RLS was most likely enabled directly on this table too, outside of any tracked migration. **This should be confirmed against the live database** (e.g. `select relrowsecurity from pg_class where relname = 'analysts'`) rather than assumed, since this audit has no live DB access to verify it directly. |

### Caveat on this section

This audit is migration-file-only, per the task's own framing ("List any tables that have no RLS policy **documented**"). The `post_trade_reviews` case above is direct proof that live RLS state and the migration history can diverge — RLS was enabled on that table by some means outside the 50 tracked migration files. That means the 5 tables flagged as "no RLS enable statement and no policy documented" might still have RLS enabled live; this audit can only confirm what is and isn't *written down*. A live check (`pg_class.relrowsecurity` / `pg_policies`) is recommended as a fast follow-up before treating any of these as confirmed-open security gaps.

---

## Appendix — full table → migration map

| Table | Migration(s) |
|---|---|
| actual_trades | 001 |
| allocation_decision_log | 001 |
| analyst_atr_profiles | 046 |
| analyst_availability | 001 |
| analyst_external_codes | 010 |
| analyst_opportunity_feedback | 045 |
| analyst_profiles | 001 |
| analyst_publications | 014 |
| analysts | 001 |
| analytics_cache | 050 |
| api_quota_alerts | 001 |
| api_usage_logs | 001 |
| app_users | 001 |
| audit_events | 001 |
| audit_log | 036 |
| automation_readiness_metrics | 001 |
| claude_generation_logs | 001 |
| coaching_recommendations | 001 |
| coaching_reviews | 001 (037 no-op re-create, 038 RLS) |
| coverage_allocation | 001 |
| daily_coverage_plan | 049 |
| economic_calendar_events | 001 |
| economic_event_revisions | 001 |
| engine_run_step_dependencies | 001 |
| engine_run_steps | 001 |
| engine_runs | 001 |
| engine_validation_runs | 032 |
| executive_kpis | 001 |
| fallback_templates | 001 |
| golden_set_scenarios | 001 |
| import_batches | 001 |
| import_errors | 001 |
| market_event_risk | 001 |
| market_regime_state | 001 |
| market_state_daily | 001 |
| market_state_intraday | 001 |
| market_symbol_aliases | 017 |
| markets | 001 |
| model_parameters | 001 |
| notifications | 001 |
| opportunities | 001 |
| post_trade_reviews | 033 |
| prompt_regression_runs | 001 |
| prompt_templates | 001 |
| recommendation_versions | 001 |
| service_principals | 001 |
| session_configuration | 001 |
| shadow_trade_outcomes | 001 |
| shadow_trades | 001 |
| team_managers | 001 |
| team_members | 001 |
| teams | 001 |
| template_profiles | 001 |
| trade_disputes | 036 (048 re-create no-op) |
| trigger_probability_profiles | 001 |
