# Dead Code Audit — Phase 4 Pre-Launch QA

**Date:** 2026-08-18
**Scope:** Static analysis only, `apps/web` and `intelligence-engine/src`, plus the GitHub Actions workflows and `engine-trigger/index.js` that drive the engine's schedule. No code removed — audit only, per the task's instruction.

## Summary

| Check | Result |
|---|---|
| 1. Unreferenced components | 2 of 63 `.tsx` files in `components/` have zero imports anywhere. |
| 2. Unreferenced lib files | 0 of 16 — every file in `lib/` is imported somewhere. |
| 3. Unreferenced API routes | 0 of 19 — every route has at least one caller (frontend `fetch()` or an external GitHub Actions workflow). |
| 4. Unreferenced intelligence-engine scripts | 7 of 20 scripts are not referenced by any workflow or by another script — 5 are self-documented one-off/manual tools, 1 is a self-documented scheduling gap, 1 appears superseded by another script. |
| 5. `mode='full'` dead code | Confirmed unreachable, exactly as the file's own comment already states — and the dead branch extends into `lib/analystProfile.ts` too. |

---

## Check 1 — Unreferenced components

Extracted every `from '@/components/...'` and relative `from './...'` / `from '../...'` import across all of `apps/web`, and cross-referenced against all 63 `.tsx` files under `apps/web/components/`.

**2 components have zero imports anywhere in the codebase:**

| File | Verified |
|---|---|
| `components/management/AllocationTable.tsx` | Grepped `AllocationTable` across all of `apps/web` — the only match is the file's own definition. |
| `components/management/StaleExceptions.tsx` | Grepped `StaleExceptions` across all of `apps/web` — the only match is the file's own definition. |

Both live in `components/management/`, alongside other panels that *are* wired into `dashboard/management/page.tsx` (`WorkloadPanel`, `DisputeQueue`, `AbsenceQueue`, `EmergencyAbsence`, `LiveTradesPanel`, `ManagementMonitor`, `ManagementTabs` — all confirmed imported). Worth a quick check with whoever built the management dashboard: these read like panels that were built for it and then either swapped for something else or never wired in.

All other 61 components are imported at least once.

---

## Check 2 — Unreferenced lib files

Checked all 16 `.ts` files in `apps/web/lib/` (including the `supabase/` subfolder) against every `@/lib/...` and relative import in the codebase.

**All 16 are referenced.** `lib/supabase/middleware.ts` (only used by the root `middleware.ts`) and `lib/marketGroups.ts` (only used by `AnalyticsFilters.tsx`) each have just one caller, but one caller still counts — no zero-reference files found here.

---

## Check 3 — Unreferenced API routes

Checked all 19 files in `apps/web/app/api/` against every `fetch('/api/...')` call in `apps/web` and every external reference in `.github/workflows/`.

**All 19 have at least one caller.** Every route maps to a real UI component or an external trigger:

| Route | Caller |
|---|---|
| `admin/analysts/update` | `AnalystManagementPanel.tsx` |
| `admin/users/update` | `UserManagementPanel.tsx` |
| `admin/markets/update` | `MarketManagementPanel.tsx` |
| `admin/thresholds/update` | `ThresholdsPanel.tsx` |
| `admin/trades/manual-entry` | `ManualTradeEntryPanel.tsx` |
| `admin/engine/retry` | `EngineRunsPanel.tsx` |
| `notifications/update` | `NotificationsPanel.tsx` |
| `absence/{request,cancel}` | `AbsenceBooking.tsx` |
| `absence/action` | `AbsenceQueue.tsx` |
| `absence/emergency` | `EmergencyAbsence.tsx` |
| `management/analyst/[analystId]/kpis` | `InlineAnalystProfile.tsx` |
| `management/analyst/[analystId]/workspace` | `InlineAnalystWorkspace.tsx` |
| `news/acuity` | `CoverageStrip.tsx` |
| `prices/live` | `useLivePrices.ts` hook |
| `analytics/{trades,publications,summary}` | `AnalyticsPage.tsx` |
| `analytics/warm-cache` | External only — hit by `.github/workflows/analytics-cache-warm.yml` (cron, every 2 hours during market hours), never called from the frontend, which is correct: this endpoint exists specifically so no user request ever pays for the recompute. |

No dead routes found.

---

## Check 4 — Unreferenced intelligence-engine scripts

Checked all 20 files in `intelligence-engine/src/scripts/` against `engine-daily.yml`, `engine-trigger/index.js`, and every other `.github/workflows/*.yml` file (there are 6 total: `engine-daily.yml`, `shadow-monitor.yml`, `monitor-shadow.yml`, `import-trades.yml`, `import-watchdog.yml`, `analytics-cache-warm.yml`), plus a search for script-to-script references within `intelligence-engine/src` itself.

**13 of 20 are referenced** by a workflow: `preallocateDay`, `populateMarketStateDaily`, `deriveMarketRegime`, `captureIntradaySnapshot`, `runEngineSession`, `generateAnalystProfiles`, `generateAtrProfiles`, `calculateKpis`, `calculateShadowKpis`, `runConditionAwareness`, `generatePostTradeReviews`, `monitorShadowTrades`, `importActualTrades`.

**7 of 20 are not referenced by any workflow, `engine-trigger/index.js`, or another script.** These fall into three distinct categories — treating them as one uniform "dead code" bucket would be misleading:

### Genuinely one-off / manual tools (5) — not a gap, working as intended

Each of these has its own header comment confirming it's a manual, run-when-needed catch-up or migration tool, not something meant to run on a schedule:

| Script | Self-documented purpose |
|---|---|
| `importHistoricalTrades.ts` | "Imports triggered trades from the P_L_Data.csv... Safe to re-run — skips existing source_record_ids." A one-time CSV loader for pre-2023 history. |
| `backfillEntryZone.ts` | Backfills `entry_zone` for existing rows from `market_state_daily`, for trades imported before that data existed. |
| `backfillTradeLinks.ts` | Explicitly self-described: "a coarser, one-off catch-up pass" for trades `importActualTrades.ts`'s time-window matching missed. |
| `reconstructZonesFromDaily.ts` | One-time zone reconstruction, bounded to `market_state_daily`'s coverage window (2024-07-20 onward). |
| `reconstructHistoricalEntryZones.ts` | "Phase 1.5 Step 2a" — tied to a specific, now-complete migration phase; bounded to a specific 15-market pilot scope. |

### Self-documented scheduling gap (1) — a real, actionable finding

| Script | Finding |
|---|---|
| `runShadowTriggerProbability.ts` | Its own header comment says: *"Run weekly via GitHub Actions once outcomes accumulate. Add to engine-daily.yml: Monday 05:45 UTC after generate-profiles."* This was never done — the script exists, presumably works, and documents exactly where it belongs in the schedule, but isn't wired in anywhere. |

### Likely superseded (1) — worth confirming, not necessarily still needed

| Script | Finding |
|---|---|
| `runShadowOutcomeLifecycle.ts` | Implements the same shadow-trade state machine (`NOT_TRIGGERED → TRIGGERED → TARGET_HIT/STOP_HIT`, Finnhub-price-driven) that `monitorShadowTrades.ts` — the one actually scheduled every 5 minutes — already implements under a different name ("Shadow Trade Lifecycle Monitor" vs. "Shadow Outcome Lifecycle Service"). Reads like an earlier implementation that was replaced rather than deleted. Worth a quick confirmation before assuming it's safe to remove, but this is a different situation from `runShadowTriggerProbability.ts` above — that one is missing from the schedule; this one looks like it was intentionally replaced. |

### Related finding, not in scope of this check but discovered while checking it: duplicate shadow-monitor workflow

`monitorShadowTrades.ts` is triggered by **two** separate, near-identical workflow files: `shadow-monitor.yml` (cron `*/5 5-21 * * 1-5`) and `monitor-shadow.yml` (cron `*/5 6-22 * * 1-5`), both named "Shadow Trade Monitor," both running the same script. This means the shadow monitor is currently firing roughly twice as often as intended, on two overlapping-but-not-identical schedules. Not a dead-code finding, but directly adjacent to this check and worth flagging: one of these two workflow files should be removed.

---

## Check 5 — `mode='full'` dead code in `AnalystProfileContent.tsx`

**Confirmed unreachable.** `AnalystProfileContent.tsx` has exactly two callers in the entire codebase:

1. `app/dashboard/management/analyst/[analystId]/page.tsx` — passes `mode="kpi-only"`.
2. `app/dashboard/analyst/performance/page.tsx` — passes `mode="kpi-only"`.

Neither caller passes `mode="full"`, and neither omits the `mode` prop (which would fall back to the `mode = 'full'` default). This exactly matches the file's own header comment (lines 19-24), which already documents this precisely: *"The management 'full profile' page (.../[analystId]/full) that used to call this with mode='full' was removed and hasn't come back -- that branch below is therefore currently unreachable; left in place rather than deleted since trimming it wasn't asked for."*

**The dead branch is larger than just the JSX in this file.** `getAnalystProfileData()` (`lib/analystProfile.ts`) takes the same `mode` parameter and has its own early return for `mode === 'kpi-only'` (line 123). Since every real call site is always `'kpi-only'`, the code after that early return — the paginated full `actual_trades` fetch (lines 132-157) and the `post_trade_reviews` fetch (lines 159-170) that only feed the `'full'` render path — is unreachable too, not just the rendering branch in the component.
