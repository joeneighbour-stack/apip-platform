# Design & UX Audit — Phase 5 Pre-Launch QA

**Date:** 2026-08-18
**Scope:** Static analysis only, `apps/web`. No code changes made — audit only, per the task's instruction.

## Summary

| Check | Result |
|---|---|
| 1. Loading states | 1 genuine gap found (`CoverageStrip.tsx`'s news fetch) out of 14 client components with their own `fetch()` calls. Everything else checked has real loading feedback. |
| 2. Error states | `AnalyticsPage.tsx` — the app's most-used data page — silently swallows fetch failures on all four of its fetch paths; renders an all-zero/empty page instead of an error. |
| 3. Empty states | Consistently good everywhere *except* three admin-only tables, which render straight into `.map()` with no "no results" message. |
| 4. Mobile responsiveness | Very low breakpoint adoption (10 of ~78 files); 19 of 23 table-rendering components have no horizontal-scroll wrapper. |
| 5. Colour consistency | Green/red for profit/loss is consistent everywhere it's checked (`#22c55e`/`#ef4444`, ~13 occurrences), but duplicated inline rather than shared from one place. |
| 6. Typography consistency | Very consistent (`text-xl font-semibold` for h1, `text-sm font-medium` for h2/h3) with a small number of specific, named exceptions. |
| 7. Button consistency | Primary/secondary patterns are consistent and widely reused; destructive/success actions are consistent in value but not centralised. |
| 8. Accessibility | No `<img>` elements exist (so no alt-text gap), but a systemic one: 7+ components use a non-semantic `<tr>`/`<div onClick>` for expand/collapse instead of a real button, making them mouse-only. |

---

## Check 1 — Loading states

38 `'use client'` components exist; 14 of them make their own `fetch()` call (the rest receive data as props from a server component). Checked all 14 for loading feedback during that fetch.

**13 of 14 have real loading feedback** — either a `status: 'loading' | 'error' | 'ready'` state machine (`InlineAnalystWorkspace.tsx`, `InlineAnalystProfile.tsx`), or a per-item `saving`/`actioning`/`retrying`/`submitting` id that disables the triggering button and swaps its label to "Saving...", "Retrying...", "Submitting…" etc. (`EngineRunsPanel.tsx`, `NotificationsPanel.tsx`, `MarketManagementPanel.tsx`, `AbsenceQueue.tsx`, `UserManagementPanel.tsx`, `AnalystManagementPanel.tsx`, `EmergencyAbsence.tsx`, `AbsenceBooking.tsx`, `ManualTradeEntryPanel.tsx`, `DisputeModal.tsx`, `DisputeQueue.tsx`).

**Finding: `CoverageStrip.tsx`'s news headline fetch has no loading state.** When an analyst expands a market row, a `useEffect` fetches `/api/news/acuity` and stores the result in `newsBySymbol[symbol]` (`undefined` = not fetched, `null` = fetched, nothing found). There's no loading indicator during that fetch, and the consuming component (`MarketContext.tsx`) does `if (!newsHeadline) return null` — so "still loading" and "no news exists for this market" render identically: nothing at all. An analyst has no way to tell whether the news section is empty because there's genuinely no news, or because it hasn't loaded yet.

---

## Check 2 — Error states

**Finding: `AnalyticsPage.tsx` has no user-facing error state at all**, despite being the highest-traffic data page in the app. All four of its fetch call sites end in `.catch(() => setLoading(false))` (or, for the manual refresh button, no `.catch()` at all):

1. Initial default-view load: `fetch('/api/analytics/summary')...catch(() => setLoading(false))`
2. Initial non-default-view load: `fetchRawData()...catch(() => setLoading(false))`
3. Lazy raw-data load on first filter change: same `.catch(() => setLoading(false))`
4. `handleRefresh()` (the "Refresh" button): no `.catch()` at all — a network failure here just leaves the promise to reject silently once `finally` runs.

In every one of these cases, a genuine failure (network error, 500, RLS denial) doesn't surface anything to the analyst — `loading` just becomes `false` and the page renders through to its normal layout with whatever data it has (typically none), which reads as *"this analyst/market has zero trades"* rather than *"something failed to load."* This is the single highest-value fix candidate from this whole check: it's the busiest page in the app, and a real failure there is indistinguishable from an empty result.

Everything else that has its own fetch (`InlineAnalystWorkspace.tsx`, `InlineAnalystProfile.tsx`) does show a distinct, real error message ("Couldn't load workspace data." / "Couldn't load KPI data.") — this is a targeted gap in one file, not a codebase-wide absence of the pattern.

*Cross-reference:* the Phase 3 functional audit (`docs/qa/functional-audit.md`, Check 4) already found that 54% of Supabase query call sites across `apps/web` never check their `error` result at all. That's the server-side half of this same problem — a failed query on a Server Component page renders as an empty page, with nothing to catch or display an error even if this check's client-side fetches were fixed.

---

## Check 3 — Empty states

Checked every list/table/card component with a `.map()` over server- or fetch-provided data.

**The overwhelming majority handle this well**, with specific, on-brand messages: "No open disputes.", "No pending requests or upcoming absences.", "No open notifications.", "No recommendations for today's session yet.", "No shadow outcomes for the selected period.", "No comparison data yet.", "No trade history available..." / "No trades match the current filters." (two different messages depending on *why* it's empty, in `TradeHistoryTable.tsx`).

**Finding: three admin-only tables have no empty-state message** — they render `{rows.map(...)}` directly into a `<tbody>` with nothing before it:

| Component | What's missing |
|---|---|
| `EngineRunsPanel.tsx` | No "no engine runs" message if `runs` is empty. |
| `MarketManagementPanel.tsx` | No "no markets match your search" message — if a search/filter combination matches zero markets, the table just shows headers and nothing else. |
| `UserManagementPanel.tsx` | No explicit empty message (low real-world likelihood, since there will always be at least one user, but technically unguarded). |

Worth noting: every one of these is in `components/admin/`. Every management- and analyst-facing table checked handles the empty case; the admin panels are the one place this slipped.

---

## Check 4 — Mobile responsiveness

Checked every `.tsx` file for `sm:`/`md:`/`lg:`/`xl:` breakpoint classes.

**Only 10 of roughly 78 `.tsx` files (~13%) use any responsive breakpoint class at all.** The few `min-w-[80px]` fixed-minimum-width instances found (`dashboard/analyst/page.tsx`, `management/analyst/[analystId]/workspace/page.tsx`) are small KPI tiles inside a `flex flex-wrap` container, so they degrade gracefully — not a real risk on their own.

**The more concrete risk is tables.** 23 components render a `<table>`. Only 4 wrap it in `overflow-x-auto` (`CoverageStrip.tsx`, `ShadowMonitoringPanel.tsx`, `MonthlyPerformanceMatrix.tsx`, `AnalystShadowBreakdown.tsx`). The other **19 have a bare `<table>` with no horizontal-scroll wrapper and no responsive column handling**:

`TeamPerformanceGrid.tsx`, `TradeHistoryTable.tsx`, `ManagementMonitor.tsx`, `AttributionTable.tsx`, `TradeStatistics.tsx`, `CompliancePanel.tsx`, `EngineRunsPanel.tsx`, `KpiSummary.tsx`, `ReportBestPerformers.tsx`, `RollingPerformanceTable.tsx`, `BestPerformers.tsx`, `LiveTradesPanel.tsx`, `app/dashboard/opportunities/page.tsx`, `MarketManagementPanel.tsx`, `AbsenceQueue.tsx`, `PerformanceBreakdown.tsx`, `AbsenceBooking.tsx`, `AnalystManagementPanel.tsx`, `UserManagementPanel.tsx`.

Many of these tables have 6-9 columns of tabular financial data — on a narrow viewport, that either forces the whole page to scroll horizontally or squeezes cell text illegibly, since browsers don't reflow table columns on their own. Given this is presented as an internal analyst/management tool, it's worth confirming with stakeholders whether phone/tablet use is actually expected before treating this as a blocker — if it is, `overflow-x-auto` on the table wrapper (the fix already used in 4 of these 23 components) is the same pattern, just not applied everywhere.

---

## Check 5 — Colour consistency

Searched for hardcoded `#hex`, `rgb(`/`rgba(`, and inline `style={{ color: ... }}` across all `.tsx` files (excluding HTML numeric entities like `&#10003;`, which superficially match a hex pattern but aren't colours).

**Green/red for profit and loss is consistent everywhere it appears**, all using the exact same pair: `#22c55e` (green) / `#ef4444` (red). Found in `TradeStatistics.tsx`, `ContributionChart.tsx`, `TeamPerformanceGrid.tsx` (×3), `PerformanceBreakdown.tsx`, `KpiSummary.tsx` (×2), `MonthlyPerformanceMatrix.tsx` (as `rgba(34,197,94,α)`/`rgba(239,68,68,α)` for its heatmap, needing dynamic opacity Tailwind classes can't easily express). These are all Recharts `<Cell fill=...>`/`<Area>`/`<Line>` props, which require real colour values rather than Tailwind classes — that's *why* they're hardcoded, not an oversight.

**Finding: the same colour pair is duplicated ~13 times across 6 files with no shared constant.** The values agree today, but there's nothing enforcing that if the brand's green/red ever changes — someone has to find and update every occurrence by hand. `lib/workspaceUtils.ts` already has a precedent for the right pattern here: `trendHeadlineColor()` is a shared helper that returns a hex string for a given trend state, used from one place (`EvidencePillars.tsx`) with a comment explaining why it's inline style rather than a Tailwind class (dynamic class names aren't reliably picked up by Tailwind's build-time scanner). A similar small helper for the profit/loss pair would remove the duplication the same way.

Outside of chart colours, `ReportHeader.tsx` hardcodes `#f28f25` for an inlined SVG logo path — expected and appropriate, since that's brand-mark artwork, not a themeable UI colour.

---

## Check 6 — Typography consistency

Checked every `<h1>`, `<h2>`, `<h3>` className across the app.

**`<h1>`: 14 instances, 13 identical.** Every page header uses `text-xl font-semibold` — except **`app/login/page.tsx`**, which uses `text-2xl font-semibold tracking-tight`, one size larger with an extra tracking adjustment no other page's `<h1>` has.

**`<h2>`: 36 instances, 34 identical.** Every section header uses `text-sm font-medium` — except **`components/analytics/report/PerformanceReport.tsx`** (`text-xs font-semibold uppercase tracking-wide mb-2`) and **`components/analytics/report/ReportDisclaimer.tsx`** (`text-xs font-semibold uppercase tracking-wide text-black`). Both exceptions are in the printable performance-report components, a different visual context (a print/PDF-style document, not the interactive dashboard) — likely an intentional, print-appropriate convention rather than an oversight, but flagged since the task asks for exactly this kind of divergence.

**`<h3>`: 6 instances, genuinely inconsistent, not confined to the print context this time:**

| File | Style |
|---|---|
| `ManagementMonitor.tsx` | `text-sm font-medium` |
| `AnalystShadowBreakdown.tsx` | `text-sm font-semibold` |
| `DisputeModal.tsx` | `font-semibold` — **no text-size class at all**, so it renders at the browser's default `<h3>` size rather than any size used elsewhere in the app. |
| `ReportDisclaimer.tsx` (×3) | `text-[9pt] font-semibold text-black` — print context, expected to differ. |

`DisputeModal.tsx`'s unsized `<h3>` ("Flag a trade") is the one worth a second look outside the print context — it's the only heading anywhere in the app with no explicit size class.

---

## Check 7 — Button and interaction consistency

**Primary actions**: `bg-primary text-primary-foreground`, used consistently across 15 files (every "Save"/"Submit"/main-action button checked).

**Secondary/cancel actions**: `rounded-md border border-border hover:bg-muted` (often with `text-muted-foreground`), used 14 times across 9 files — equally consistent.

**Destructive and success actions are consistent in value, not in structure.** `bg-red-600 text-white hover:bg-red-700` appears identically in `EmergencyAbsence.tsx`'s "Confirm absence" button and (as the count badge, not a button) `management/page.tsx`; `bg-green-600 text-white hover:bg-green-700` appears identically in `DisputeQueue.tsx`'s "Apply override & resolve" and `AbsenceQueue.tsx`'s "Approve". These agree with each other today, but — like the chart colours in Check 5 — there's no shared `<Button variant="destructive">`/`variant="success">` component behind them, just the same literal className string copy-pasted into each file. Not a found inconsistency, but the same kind of fragility: correct today by convention, with nothing enforcing it stays that way.

No one-off/rogue button styles were found beyond this.

---

## Check 8 — Accessibility basics

**No `<img>` or `<Image>` elements exist anywhere in the app** — the two matches found are code comments explaining why an `<img>` tag was deliberately avoided in favour of an inlined SVG (to survive `window.print()` reliably). "Missing alt text" doesn't apply — there's no raster image in the app to be missing it.

**Finding: icon-only buttons with no accessible label**, relying entirely on a visual glyph a screen reader either skips or reads unhelpfully (e.g. "multiplication sign"):
- `DisputeModal.tsx` — close button, content is bare `✕`.
- `ReportBuilder.tsx` — delete-preset button, content is bare `×`.
- `NotificationsPanel.tsx` — dismiss button, content is bare `✕`.

**Finding (the most significant one in this check): expand/collapse rows use a non-semantic element with `onClick`, not a real button.** At least 7 instances across 6 files use `<tr onClick={...} className="cursor-pointer ...">` or `<div onClick={...} className="cursor-pointer ...">` for what is functionally a toggle button:

`DisputeQueue.tsx`, `AnalystShadowBreakdown.tsx`, `TradeHistoryTable.tsx`, `CoverageStrip.tsx`, `CompliancePanel.tsx`, `PerformanceBreakdown.tsx` (×2 — both the asset-class table rows and the direction cards).

None of these have `role="button"`, `tabIndex`, an `onKeyDown` handler for Enter/Space, or `aria-expanded` to indicate the toggle state. A mouse user can expand every one of these; a keyboard-only or screen-reader user cannot reach or activate any of them, since a plain `<tr>`/`<div>` isn't focusable or operable by default no matter what `onClick` it carries. This is the same underlying gap repeated across most of the app's expandable-row UI, not six unrelated one-offs — worth fixing with one shared pattern rather than six separate patches.

**Finding: most text/search inputs have no associated `<label>`.** 23 `<input>` elements exist across 11 files; only 9 `<label>` elements exist, across just 4 of those files (and several of those 9 are group labels above a set of radio buttons, e.g. `DisputeModal.tsx`'s "What's the issue?", not `htmlFor`-paired with a single input). `MarketManagementPanel.tsx`'s search box, for example, has only `placeholder="Search markets..."` — no `<label>` at all. Placeholder text is not a reliable substitute for a label: it disappears once the field has a value and isn't consistently exposed as the field's accessible name by assistive tech.

Only 5 of ~78 `.tsx` files use any `aria-*` attribute or `role` at all, which is consistent with everything above — accessibility attributes are the exception in this codebase, not the norm.
