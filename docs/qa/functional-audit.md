# Automated Functional Audit — Phase 3 Pre-Launch QA

**Date:** 2026-08-18
**Scope:** Static analysis only, `apps/web` and `intelligence-engine/src`. No code changes made — audit only, per the task's instruction.

## Summary

| Check | Result |
|---|---|
| 1. Route inventory | 15/15 dashboard routes have a page file. 1 page (`/dashboard/opportunities`) is unreachable from any nav/redirect path. |
| 2. Dead link scan | 0 dead links found — every `href`/`<Link>`/`router.push` target resolves to a real page. |
| 3. API route protection | 16/19 routes explicitly check auth. 1 uses intentional shared-secret auth. 2 have no auth check at all (1 real risk, 1 low-risk stub). |
| 4. Error handling | 41% of files with Supabase queries (14/34) have zero error handling — 54% of all query call sites (56/104). |
| 5. TODO/FIXME/HACK/XXX | 0 found in either codebase. |
| 6. Empty state handling | No gaps found — every list-rendering `.map()` in workspace/monitor components is guarded. |
| 7. TypeScript strict issues | `apps/web`: 0 errors. `intelligence-engine`: 14 errors, all pre-existing, all in one file. |

---

## Check 1 — Route inventory

`apps/web/app/dashboard/` contains 15 `page.tsx` files:

| Route | Page file | Reachable via |
|---|---|---|
| `/dashboard` | ✓ | root `/` and this page both redirect via `defaultDashboardPath(role)` |
| `/dashboard/analyst` | ✓ | nav (ANALYST) |
| `/dashboard/analyst/performance` | ✓ | nav (ANALYST) |
| `/dashboard/analyst/monitor` | ✓ | nav (ANALYST) |
| `/dashboard/analyst/availability` | ✓ | nav (ANALYST) |
| `/dashboard/management` | ✓ | nav (MANAGER, ADMIN) |
| `/dashboard/management/performance` | ✓ | nav (MANAGER, ADMIN, EXECUTIVE) |
| `/dashboard/management/shadow` | ✓ | nav (MANAGER, ADMIN, RESEARCH) |
| `/dashboard/management/analyst/[analystId]` | ✓ | linked from `InlineAnalystProfile.tsx` |
| `/dashboard/management/analyst/[analystId]/workspace` | ✓ | linked from `TeamPerformanceGrid.tsx` |
| `/dashboard/analytics` | ✓ | nav (MANAGER, ADMIN, EXECUTIVE, RESEARCH) |
| `/dashboard/admin` | ✓ | nav (ADMIN, MANAGER) |
| `/dashboard/executive` | ✓ | `defaultDashboardPath('EXECUTIVE')` only — no nav item (page immediately redirects to `/dashboard/management/performance`, so a nav item would be pointless) |
| `/dashboard/research` | ✓ | `defaultDashboardPath('RESEARCH')` only — no nav item (page immediately redirects to `/dashboard/analytics`, same reasoning) |
| `/dashboard/opportunities` | ✓ | **none found** |

**Finding (Medium): `/dashboard/opportunities` is unreachable.** The page file exists, has real role-gating logic (`ANALYST`, `MANAGER`, `ADMIN`), and queries `opportunities`/`coaching_recommendations`. But it is not in `DashboardNav.tsx`'s `NAV_ITEMS`, not a target of `defaultDashboardPath()` for any role, and not linked from any other page or component (`grep`'d for `dashboard/opportunities` across all of `apps/web` — the only match is the Next.js build cache, `tsconfig.tsbuildinfo`, not source). It's a fully built, access-controlled feature with no way to reach it except typing the URL directly. Worth confirming with product/design whether this was intentionally delinked (superseded by something else) or is a missing nav item.

---

## Check 2 — Dead link scan

Searched all `.tsx` files for `href=`, `<Link`, and `router.push(`. Every internal route found resolves to an existing page:

- `DashboardNav.tsx`'s 9 `NAV_ITEMS` — all resolve.
- Static back-links (`<a href="/dashboard/analyst">`, `<a href="/dashboard/management">`) — all resolve.
- Dynamic links: `` `/dashboard/management/analyst/${analyst.analyst_id}/workspace` `` (`TeamPerformanceGrid.tsx`) and `` `/dashboard/management/analyst/${analystId}` `` (`InlineAnalystProfile.tsx`) — both correctly match their `[analystId]` dynamic route folders.
- `router.push('/')` (`login/page.tsx`) — resolves (root redirect).
- `backHref`/`prefillHref` props (`AnalystProfileContent.tsx`, `DisputeQueue.tsx`) — trace back to `/dashboard/management` and `/dashboard/admin?prefill=...`, both real routes.
- In-page anchors (`#disputes`, `#absences` in `management/page.tsx`) — not routes, not in scope for this check.

**No dead links found.**

---

## Check 3 — API route protection

19 route files in `apps/web/app/api/`. Checked each for `getCurrentUser()` (which itself redirects to `/login` if unauthenticated — safe by construction for any caller) or an explicit `supabase.auth.getUser()` + `if (!user) return 401` pair.

| Route | Protection |
|---|---|
| `absence/{request,cancel,action,emergency}` | `getCurrentUser()` |
| `admin/{analysts,users,markets}/update`, `admin/engine/retry` | `getCurrentUser()` |
| `admin/trades/manual-entry` | `getCurrentUser()` |
| `notifications/update` | `getCurrentUser()` |
| `analytics/{summary,trades,publications}` | `auth.getUser()` + explicit `401` check |
| `management/analyst/[analystId]/{kpis,workspace}` | `auth.getUser()` + explicit `401` check |
| `analytics/warm-cache` | Shared secret header (`x-warm-cache-secret`) — **intentional**, this is a GitHub Actions cron target with no user session to check |
| `prices/live` | **No explicit check** — see finding below |
| `news/acuity` | **No auth check at all** — see finding below |
| `admin/thresholds/update` | **No auth check at all** — see finding below |

**Finding (High): `news/acuity` has zero authentication.** `POST /api/news/acuity` takes a `symbols` array from the request body and, with no session check of any kind, proxies to the Acuity MarketInsights API using the app's own server-side credentials (`ACUITY_USERNAME`/`ACUITY_PASSWORD`, cached bearer token). Any unauthenticated caller can invoke this endpoint repeatedly, spending the app's Acuity API quota/rate limit on their behalf. Every other data-serving route in this app checks auth first; this one doesn't.

**Finding (Low): `admin/thresholds/update` has zero authentication.** Currently harmless in practice — the handler is a stub that always returns `501` regardless of input and touches no database or external API (`"Threshold persistence not yet implemented"`). But it lives under `/api/admin/` alongside routes that all require `getCurrentUser()`, and has no auth check itself. Low risk today, but should get the same `getCurrentUser()` gate before it's ever wired up for real, so the auth gap doesn't silently persist once this stub becomes a real write path.

**Finding (Low/informational): `prices/live` has no explicit auth check, but is implicitly gated by RLS.** The route queries `markets` via the regular cookie-based client (`createClient()`, not `createAdminClient()`); `markets`' RLS policy (`markets_select_all`, `002_rls.sql`) requires `auth.uid() is not null`. An unauthenticated caller's `markets` query returns zero rows, so the route falls through to `NextResponse.json({})` before ever calling the (paid, rate-limited) Finnhub API. Functionally protected today, but it's the only data route in the app relying on RLS alone rather than an explicit check — a defense-in-depth gap if that RLS policy is ever loosened, and inconsistent with the explicit-check convention every other route follows.

---

## Check 4 — Error handling on Supabase queries

Searched `apps/web` for `.from(` (Supabase table queries only — one `Array.from()` false positive in `TradeStatistics.tsx` excluded). Found **104 genuine Supabase query call sites across 34 files**. For each file, checked whether the word "error" appears anywhere in it at all (a coarse but fast proxy for "does this file check `{ error }` or use `.catch()` anywhere near a query").

**14 of 34 files (41%) have zero mentions of "error" anywhere** — meaning every `.from()` call in these files discards its `error` result unchecked:

| File | `.from()` calls |
|---|---|
| `lib/workspaceData.ts` | 11 |
| `app/dashboard/management/performance/page.tsx` | 9 |
| `lib/analyticsCache.ts` | 7 |
| `lib/analystProfile.ts` | 6 |
| `app/dashboard/analyst/monitor/page.tsx` | 5 |
| `lib/shadowBreakdown.ts` | 5 |
| `app/dashboard/management/shadow/page.tsx` | 3 |
| `app/dashboard/opportunities/page.tsx` | 2 |
| `app/dashboard/analytics/page.tsx` | 2 |
| `app/dashboard/analyst/performance/page.tsx` | 2 |
| `app/dashboard/analyst/page.tsx` | 1 |
| `app/dashboard/analyst/availability/page.tsx` | 1 |
| `app/dashboard/management/analyst/[analystId]/workspace/page.tsx` | 1 |
| `app/page.tsx` | 1 |

That's **56 of the 104 total call sites (54%) with no error handling** — a majority.

**The pattern is consistent, not random**: every file above is either a Server Component dashboard page or a `lib/` data-fetching helper feeding one — all read paths. Every API route that *writes* data (`admin/*/update`, `absence/*`, `admin/trades/manual-entry`) does check `{ error }` and returns a real error response. The write paths are well-covered; the read paths consistently are not. In a Server Component, an unchecked `const { data } = await supabase.from(...)` on a failed query just silently yields `data: null` (usually coerced to `[]` downstream) — the page renders as if there were no rows, not as a visible error. `lib/workspaceData.ts` is the highest-value target to fix first: it's the analyst workspace's core data source, at 11 unchecked calls.

*Methodology note*: "does the file mention 'error' at all" is a file-level proxy, not a call-by-call verification — a file with e.g. 11 queries and only 2 "error" mentions likely has partial, not full, coverage (`app/dashboard/management/page.tsx`: 11 calls, 2 mentions), but this audit didn't verify each call site individually within files that have *some* error handling.

---

## Check 5 — TODO/FIXME/HACK/XXX inventory

Searched all `.ts`/`.tsx` files in `apps/web` and all `.ts` files in `intelligence-engine/src`, case-insensitive.

**Zero matches in either codebase.** No `TODO`, `FIXME`, `HACK`, or `XXX` comments anywhere.

---

## Check 6 — Empty state handling

Checked all 11 files in `apps/web/components/analyst/workspace/`, both `*Monitor*.tsx` components (`ShadowMonitoringPanel.tsx`, `ManagementMonitor.tsx`), and the two monitor pages (`dashboard/analyst/monitor/page.tsx`).

Every list-rendering `.map()` call across these files is guarded:

- `CoverageStrip.tsx`: `rows.length === 0` → "No recommendations for today's session yet."
- `DetailedEvents.tsx`: `eventRiskItems.length === 0` → returns `null` (correctly hidden, not an empty crash).
- `MajorEventWarning.tsx`: `highImpact.length === 0` → returns `null`.
- `TradeHistoryTable.tsx` (used by both monitor pages): distinguishes "no trade history at all" vs. "no trades match the current filters" — two different, correct messages.
- `ShadowMonitoringPanel.tsx`: every data-driven `.map()` (`filtered`, `marketRows`) is wrapped in a `.length === 0 ? <message> : .map(...)` or `.length > 0 &&` guard; the remaining `.map()` calls are over static constant arrays (`COMPARISON_WINDOWS`, `DATE_RANGES`, table headers), which can't be empty.
- `analyst/monitor/page.tsx`: every section (yesterday's snapshot, coaching compliance, aligned-vs-not-aligned comparison) is wrapped in a `.length > 0 &&` guard before any division or `.map()` that could produce `NaN` or render nothing meaningful.
- Single-record detail components (`RecommendationSynthesis.tsx`, `SupportingEvidence.tsx`, `MarketContext.tsx`) receive an already-resolved row/prop from their parent and use optional chaining (`row.regime?.trendState ?? null`) rather than assuming fields are present — appropriate for a "detail of a known record" component rather than a list.

**No empty-state gaps found.** This check came back clean.

---

## Check 7 — TypeScript strict issues

```
cd apps/web && npx tsc --noEmit
```
**0 errors.**

```
cd intelligence-engine && npx tsc --noEmit
```
**14 errors, all in one file:**

| File | Errors |
|---|---|
| `src/scripts/importHistoricalTrades.ts` | 14 (`TS2532` ×3, `TS18048` ×11 — all "possibly undefined" on array/object access) |

This is the project's known pre-existing baseline (previously 15, tracked across many prior sessions/tasks) — one entry (`importActualTrades.ts:71`, `TS1117` duplicate object-literal property) was fixed in the most recent commit to this repo (`f1589a4`, unrelated cleanup of a duplicate `SYMBOL_OVERRIDES` key) and is correctly gone now. The remaining 14 are all in `importHistoricalTrades.ts` and are unrelated to this audit.
