# Performance Audit — Phase 6 Pre-Launch QA

**Date:** 2026-08-19
**Scope:** Static analysis only, `apps/web` (all 15 dashboard pages, their `lib/` data helpers, and `components/analytics/`), cross-referenced against `migrations/`. No code changes made — audit only, per the task's instruction.

## Summary

| Check | Result |
|---|---|
| 1. Sequential vs. parallel queries | Every page is 100% sequential. `Promise.all` is used in exactly 2 files in the whole app, and only 1 of those (`lib/analyticsCache.ts`) parallelizes Supabase calls. `lib/workspaceData.ts` — the analyst workspace's core data source, the hottest page in the app — makes 11 sequential round-trips where at most 2 sequential "waves" are actually required. |
| 2. N+1 patterns | No classic per-row N+1 found. Two files batch a Supabase query inside a loop over chunked ID arrays (a deliberate, documented pattern to stay under PostgREST's URL length limit) — technically matches the search, but scales at O(n/100), not O(n). |
| 3. Missing indexes | 4 real gaps: `trade_disputes`, `analyst_availability`, `shadow_trade_outcomes`, and `post_trade_reviews` have **zero** indexes beyond their primary key, despite all four being queried on non-PK columns in hot paths. |
| 4. Bundle size | Only `recharts` is a heavy dependency, used in 4+ chart components across both `components/analytics/` and `components/analyst/`. `next/dynamic` is used nowhere in the app — recharts loads eagerly on every performance-related page. |
| 5. Query limits | One `.limit(1000)` query has a comment that already admits it's a ticking time bomb ("headroom against future growth, not a real cap") on a table with no date/scope filter and no `.order()`. Several paginated full-history fetches are strong candidates for a server-side aggregate instead. |
| 6. Cache opportunities | The single biggest opportunity: shadow/actual-trades history is independently re-fetched in full by 3 different code paths across 2 pages, with zero sharing or caching between them. |

---

## Check 1 — Page data fetching

Read all 15 `page.tsx` files under `apps/web/app/dashboard/`. Counted Supabase query call sites per page and checked for `Promise.all`.

**`Promise.all` is used in exactly 2 files in all of `apps/web`**: `app/api/prices/live/route.ts` (parallelizing external Finnhub HTTP calls, not Supabase) and `lib/analyticsCache.ts` (the one place that actually parallelizes Supabase queries). Every one of the 15 dashboard pages — and every `lib/` helper they call — issues its Supabase queries one `await` at a time, even when consecutive queries have no dependency on each other.

| Page | Sequential Supabase queries | Notes |
|---|---|---|
| `admin/page.tsx` | 5 (`engine_runs`, `app_users`, `markets`, `analysts`, `notifications`) | All 5 are fully independent of each other. Textbook `Promise.all` candidate. |
| `management/page.tsx` | 9 top-level + 2 batched loops | See below — the worst single page in the app. |
| `management/performance/page.tsx` | 7 top-level + 3 pagination loops + 1 call to `getShadowBreakdownData()` (itself 3 more queries + 3 more pagination loops) | See Check 6 — much of this duplicates work `getShadowBreakdownData()` already does. |
| `management/shadow/page.tsx` | 2 top-level + 2 pagination loops + 1 call to `getShadowBreakdownData()` | Same duplication as above. |
| `analyst/monitor/page.tsx` | 5 (`actual_trades` ×2, conditional `actual_trades` detail, `post_trade_reviews`, `trade_disputes`) | 4 of 5 have no real dependency on each other (only the conditional detail fetch needs an earlier result). |
| `opportunities/page.tsx` | 2 (`opportunities`, conditional `coaching_recommendations`) | Independent, parallelizable. |
| `analyst/performance/page.tsx` | 2 (`analysts`, `markets`) | Independent, parallelizable. |
| `analytics/page.tsx` | 2 (`analysts`, `markets`) | Independent, parallelizable. |
| `analyst/availability/page.tsx` | 1 | Trivial. |
| `management/analyst/[analystId]/page.tsx` | 0 direct (delegates to `getAnalystProfileData()`) | See below. |
| `executive/page.tsx`, `research/page.tsx`, `dashboard/page.tsx` | 0 | Redirect-only stubs. |
| `analyst/page.tsx`, `management/analyst/[analystId]/workspace/page.tsx` | 1 direct + 1 call to `getWorkspaceData()` | See below — the headline finding. |

### The headline finding: `lib/workspaceData.ts`'s `getWorkspaceData()`

This function is the data source for `/dashboard/analyst` (every analyst's default landing page) and `/dashboard/management/analyst/[analystId]/workspace` — almost certainly the single most frequently-loaded query path in the entire app. It issues **11 sequential `await`s**, entirely without `Promise.all`:

1. `coaching_recommendations` — must go first, its result (`marketIds`) feeds everything else
2. `market_event_risk` — depends only on `marketIds`
3. `market_regime_state` — depends only on `marketIds`
4. `market_state_daily` (prior day) — depends only on `marketIds`
5. `market_state_daily` (10-day price history) — depends only on `marketIds`
6. `market_state_intraday` — depends only on `marketIds`
7. `actual_trades` (market history) — depends only on `marketIds` + `analystId`
8. `analyst_profiles` (scoped) — depends only on `marketIds` + `analystId`
9. `analyst_profiles` (full, unscoped) — depends only on `analystId`, **not on `marketIds` at all**
10. `actual_trades` (yesterday) — depends only on `analystId` + today's date
11. `opportunities` count — depends only on today's date

Steps 2 through 8 (seven queries) depend on nothing but the `marketIds` resolved in step 1 and could all run inside a single `Promise.all` immediately after it. Steps 9, 10, and 11 depend on nothing from step 1 at all and could run in parallel with it from the very start. Restructured, this could plausibly collapse from 11 sequential round-trips into roughly 2 sequential "waves" — a very large latency win on the page every analyst sees first.

### `management/page.tsx` — the worst single page

9 independent top-level queries (`coverage_allocation`, `trade_disputes`, `analyst_availability` ×2, `analysts`, `actual_trades` ×2, `opportunities`), all sequential, plus two batched loops (`post_trade_reviews` and `trade_disputes`, each chunked over `allTradeIds` — see Check 2). Only the two batched loops have a genuine dependency (on `allTrades`' IDs from query #8); the first 7 have no dependency on each other or on anything else and could all run in one `Promise.all`.

---

## Check 2 — N+1 query patterns

Searched for `.from(` inside `for`, `forEach`, `map`, and `while` loops across `apps/web`.

**No classic N+1 (one query per row of an outer result set) was found.** What the search does surface is a different, more deliberate pattern: **5 files batch a Supabase query inside a loop over a chunked ID or page-offset array** — `management/page.tsx` (×2: `post_trade_reviews`, `trade_disputes`, both chunked in batches of 100 over `allTradeIds`), `management/performance/page.tsx` (×3 pagination loops), `management/shadow/page.tsx` (×2), `lib/shadowBreakdown.ts` (×3), and `lib/analystProfile.ts` (×1, but see below).

These are explicitly documented as intentional — the `management/page.tsx` comment states the batching exists because "a single `.in()` with up to 500 UUIDs can exceed PostgREST/Supabase's URL length limit," and the `while (hasMore)` pagination loops exist because "Supabase/PostgREST caps responses at 1000 rows server-side regardless of `.limit()`." Both scale at **O(n/100)** or **O(n/1000)** — a few extra round-trips for a large dataset, not one round-trip per row. Not a bug in the classic N+1 sense, but still real, cumulative latency worth being aware of, especially the pagination loops fetching full history (see Check 6).

One nuance: `lib/analystProfile.ts`'s pagination loop lives in `getAnalystProfileData()`'s `mode === 'full'` branch, which the Phase 4 dead-code audit (`docs/qa/dead-code-audit.md`) already confirmed is unreachable — both real callers always pass `mode="kpi-only"`. This loop matches the search pattern but currently costs nothing in production.

---

## Check 3 — Missing database indexes

Cross-referenced every column filtered/joined-on in the hot-path queries above (workspace, monitor, management overview, shadow monitoring) against every `create index` statement in `migrations/001_schema.sql` and subsequent migrations.

**Well-indexed**: `coaching_recommendations (analyst_id, shown_at desc)`, `actual_trades (analyst_id, published_at desc)`, `market_regime_state (market_id, captured_at desc)`, `market_state_intraday (market_id, session, captured_at desc)`, `analyst_profiles (analyst_id, market_id)`, `analyst_publications (analyst_id, published_at)` / `(market_id, published_at)` — all match their real query shapes well.

**4 tables have zero indexes beyond their primary key**, confirmed by reading their `create table` statements directly (`001_schema.sql` for the first two, `033_post_trade_reviews.sql` and `036_trade_disputes_and_audit_log.sql` for the other two):

| Table | Queried by | Missing index |
|---|---|---|
| `trade_disputes` | `management/page.tsx` (`.in('status', [...])`), `.in('trade_id', batch)` joins elsewhere | No index on `status` or `trade_id`. |
| `analyst_availability` | `management/page.tsx` (`.eq('date', today)`, `.gte/.lte('date', ...)`, no `analyst_id` filter — team-wide) | Has a unique constraint on `(analyst_id, date, session)`, but that only helps queries filtering by `analyst_id` first. Every team-wide, date-only query gets no benefit from it. |
| `shadow_trade_outcomes` | `ShadowMonitoringPanel`, `getShadowBreakdownData()`, `TeamPerformanceGrid` — every one of these joins through `shadow_trade_id` | No index on `shadow_trade_id`, the FK every single query here joins on. |
| `post_trade_reviews` | `management/page.tsx` (`.in('trade_id', batch)`), `monitor/page.tsx` (`trade:trade_id!inner`) | No index on `trade_id`, the FK column that's the entire access pattern for this table. |

Two smaller, partial gaps also worth noting:
- `opportunities` has `idx_opportunities_status (opportunity_lifecycle_status, session, date)`, but `management/page.tsx` and `getWorkspaceData()` both filter on `date` alone (`.eq('date', today)`) with no `opportunity_lifecycle_status`/`session` filter — a composite index's later columns don't help a query that doesn't also filter on the earlier ones, so this index doesn't actually serve either query.
- `actual_trades` has no index covering `source_system` alone. Several team-wide (no `analyst_id`) queries filter `.in('source_system', [...])` combined with a `published_at` range (`management/performance/page.tsx`, `management/shadow/page.tsx`, `lib/shadowBreakdown.ts`) — `idx_actual_trades_analyst` doesn't help here since none of these queries filter by analyst.

---

## Check 4 — Bundle size concerns

Checked every import in `apps/web/components/analytics/` for third-party libraries.

**Only `recharts` (^2.12.7)** is a non-trivial dependency, imported directly in `ContributionChart.tsx`, `CumulativePerformanceChart.tsx`, `DrawdownChart.tsx`, and `TradeStatistics.tsx`. The same library is also imported directly in `components/analyst/PerformanceBreakdown.tsx` and `components/analyst/KpiSummary.tsx` (outside the audit's literal scope, but the same finding applies).

**`next/dynamic` is used nowhere in the entire app.** `AnalyticsPage.tsx` statically imports all four recharts-based chart components, and is itself statically imported by both `analytics/page.tsx` (the Team/Executive Analytics page) and `AnalystPerformanceTabs.tsx` (the analyst's own Performance tab). That means recharts and its dependencies ship in the initial JS bundle for every visit to either page, loaded and parsed before any data has even arrived — not lazy-loaded behind a `dynamic(() => import(...), { ssr: false })` boundary the way a heavy charting library typically would be. Wrapping the 4-6 chart components in `next/dynamic` (with a lightweight loading placeholder) would keep recharts out of the initial bundle for anyone who hasn't scrolled to a chart yet, without requiring a different charting library.

---

## Check 5 — Supabase query limits

Searched all `.limit(N)` calls and all pagination (`while (hasMore)`/`.range()`) loops.

**Finding: `management/page.tsx`'s `coachingAlignment` query is a self-documented risk.**
```ts
.limit(1000) // 372 reviews today -- headroom against future growth, not a real cap
```
This query has no date filter (full history) and no `.order()` clause, so once total `post_trade_reviews` rows exceed 1000, this silently returns an arbitrary/inconsistent 1000-row subset rather than an error — and unlike every genuinely-paginated fetch elsewhere in this same file, there's no `.range()` loop backing it up. The comment already identifies the growth risk; it just hasn't been converted to pagination (or better, a server-side aggregate — see below) yet.

Other `.limit()` calls found are all comfortably bounded and not a concern: `.limit(1)` (single latest record), `.limit(20)`/`.limit(50)`/`.limit(100)` (small, page-appropriate caps), `.limit(200)` (single day's allocations), `.limit(500)` (30-day team-wide trades, below the 1000 real cap but with no comment explaining why 500 was chosen as sufficient).

**Candidates for a server-side aggregate instead of paginated raw rows:** every one of the full-history pagination loops found in Check 2 exists purely to compute an aggregate (win rate, total R, trigger rate) in JavaScript after pulling every raw row over the wire. `management/performance/page.tsx`'s `actualTrades`/`rawSinceLaunchTrades` loops, `management/shadow/page.tsx`'s `rawActualTrades` loop, and all three of `lib/shadowBreakdown.ts`'s loops are doing exactly the kind of row-by-row-then-sum-in-JS work a `select analyst_id, sum(result_r), count(*) ... group by analyst_id` query (or a materialized view, refreshed on the same schedule the KPI batch jobs already run on) would do far more cheaply server-side, without shipping thousands of raw rows to a Server Component just to fold them into a handful of numbers.

---

## Check 6 — Cache opportunities

Ranked by data volume (row count × column count, including nested embeds) among fetches that actually run on every relevant page load (excluding the confirmed-dead `mode='full'` path).

1. **`AnalyticsPage.tsx`'s non-default-view fetch** (`/api/analytics/trades` + `/api/analytics/publications`) — "Since Inception" (2017 onward), ~30,000+ trades × ~9 columns plus a market join, plus the matching publications set. This is exactly the volume that justified building `analytics_cache` for the *default* view (`lib/analyticsCache.ts`) — but every other filter combination (any analyst, market, date-range, or product filter) still pays this exact cost, fully uncached, on every single request. **Highest-value target**, since the caching pattern to copy already exists in this same codebase.

2. **`getShadowBreakdownData()`** (`lib/shadowBreakdown.ts`) — 3 full "since shadow launch" pagination loops (`shadow_trade_outcomes` with a 3-level nested join, `analyst_publications`, `actual_trades`), growing every day since launch. Called by *two different pages*.

3. **`management/performance/page.tsx`'s own `actualTrades`/`rawSinceLaunchTrades` pagination** — largely the same `actual_trades` rows `getShadowBreakdownData()` (called from the same page, item 2) already fetched moments earlier. This page fetches overlapping `actual_trades` history through two independent, uncoordinated code paths in a single request.

4. **`management/shadow/page.tsx`'s own `rawActualTrades`/`rawActualPublications` pagination** — the same redundancy as #3, on the sibling page: `getShadowBreakdownData()` fetches its own `actual_trades`/`analyst_publications` history, and this page separately fetches its own overlapping copies of the same two tables for the same "since launch" window.

5. **`management/page.tsx`'s Monitor tab** — 30-day team-wide `actual_trades` (up to 500 rows × 10 columns with 2 joins) plus the batched `post_trade_reviews`/`trade_disputes` lookups keyed off it. Smaller in raw volume than 1-4, but re-fetched fresh on every page load with no caching, on a page managers are likely to revisit often during a session.

**The clearest, single most concrete opportunity**: items 2, 3, and 4 amount to the *same underlying `actual_trades`/`analyst_publications`/`shadow_trade_outcomes` "since launch" history* being independently pulled in full **up to three separate times** across two pages, with zero sharing between them — despite `getShadowBreakdownData()` already existing specifically so both pages "agree on the same numbers." A cache keyed on shadow-breakdown data (refreshed on whatever schedule the underlying KPI batch jobs already run on, the same design `analytics_cache` uses) would collapse three full-history fetches into one, and remove the redundant direct fetches from both `management/performance/page.tsx` and `management/shadow/page.tsx` entirely by having them read the same cached result `getShadowBreakdownData()` already computes.
