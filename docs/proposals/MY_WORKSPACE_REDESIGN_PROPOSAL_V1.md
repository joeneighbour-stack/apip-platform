# My Workspace Redesign Proposal V1

**Status:** Proposal for review — not implemented. No code or component stubs accompany this document.
**Scope:** `apps/web/app/dashboard/analyst/page.tsx` (the analyst's daily "My Workspace" landing page) and its supporting components (`MarketNews.tsx`). Related pages (`monitor`, `performance`, `availability`) are out of scope except where the action-flow proposal touches the handoff between them.
**Inputs read:** `intelligence-engine/src/scripts/runEngineSession.ts`, `populateMarketStateDaily.ts`, `captureIntradaySnapshot.ts`, `deriveMarketRegime.ts`, `intelligence-engine/src/services/recommendationService.ts`; schema for `opportunities`, `recommendation_versions`, `coaching_recommendations`, `market_regime_state`, `market_state_daily`, `market_state_intraday`, `market_event_risk`, `analyst_profiles`, `template_profiles`, `trigger_probability_profiles`, `shadow_trades`/`shadow_trade_outcomes` (`migrations/001_schema.sql`); the current workspace page and `MarketNews.tsx`.

---

## 1. What the engine actually computes, per market, every session

Before critiquing the UI, it's worth being precise about how much the engine already knows for every recommendation it publishes — because the central finding of this review is that almost none of it survives to the screen.

For every market/session combination, `runEngineSession.ts` → `recommendationService.buildRecommendation()` produces three distinct outputs, only one of which reaches the analyst:

| Output | Contents | Where it goes today |
|---|---|---|
| `OpportunityOutput` / `RecommendationVersion` (persisted) | `current_zone`, `preferred_entry_zone`, `direction`, `expected_r`, `trigger_probability` (capped), `entry_range_low/high` (numeric), `risk_range`/`target_range` (**formatted guidance-band text**, not raw numbers), `zone_at_generation`, `volatility_warning`, `atr_move_since_generation`, `recommendation_validity_status` | Table rows → `coaching_recommendations` → workspace card |
| `HiddenExecutionLevels` (persisted only to `shadow_trades`) | `entryMid`, `stop`, `target`, `rr` — the **precise numeric** levels the shadow system trades against | Never surfaced to analysts, by design (`chk_shadow_never_visible`) |
| `RecommendationDiagnostics` (**not persisted anywhere**) | `templateSource` (historical_template / fallback), `templateAvgR`, `templateWinRate`, `templateTrades`, `templateQuality` (HIGH/MED/LOW), `profileSource`, `profileAvgR`, `profileWinRate`, `profileTrades`, `profileQuality`, `eventWarning` | Printed to the engine's console log, then discarded (`runEngineSession.ts:483`) |

Separately, `deriveMarketRegime.ts` computes real technical indicators daily — EMA20/EMA50/EMA200, ADX14, 20-bar directional persistence, 60-bar ATR percentile — and reduces them to `trend_state` / `volatility_state` / `regime_confidence` / `regime_tags` / `derived_from` in `market_regime_state`. `analyst_profiles` separately holds per-analyst, per-market, per-direction, **per-zone** historical performance (`profile_data.avg_r`, `.trigger_rate`) used only for allocation scoring today.

This matters because it reframes the whole critique: the platform isn't missing analytical capability. It's an intelligence engine with a genuinely rich internal model that terminates at a UI built like a generic SaaS notifications feed.

## 2. Critique of the current workspace

### 2.1 Poorly presented

- **Trend/volatility are downgraded to adjectives.** `market_regime_state` gives ADX14, EMA stack, directional persistence, and a confidence tier. The workspace page reduces all of it to two strings — `"Trending up"` / `"High volatility"` — via `trendLabel()`/`volatilityLabel()`, with no numbers and no confidence tier. A "Trending up" derived from `regime_confidence: LOW` looks identical on screen to one derived from `HIGH`. An experienced technical analyst reads ADX and EMA slope, not adjectives.
- **`current_zone` and `preferred_entry_zone` are fetched but never rendered.** The GraphQL-style query on lines 82–84 of the page explicitly selects both fields, but no JSX in the card prints either one. The ATR-zone model (Zone 1–4 / Too Deep / Too High) is the platform's core locked methodology (V1.4) — Pine-style bands, session anchors, 20-period Wilder ATR — and it is completely invisible on the one page whose entire job is to present zone-based opportunities.
- **Risk/target are opaque strings, not usable levels.** `entry_range_low/high` are structured numerics (easy to format, align, and chart), but `risk_range`/`target_range` are pre-formatted guidance-band strings produced by `formatGuidanceRange()`. They render fine as text but can't be plotted on a zone ladder, can't be diffed against current price to compute "X ATRs to stop," and can't be reused in any future visual component without re-parsing a string. The actual precise numeric stop/target (`HiddenExecutionLevels.stop/target`) exist one layer down in the engine and are deliberately withheld from analysts (correctly — they belong to the shadow system) but nothing analogous at entry-level precision is offered as the analyst-facing replacement.
- **Validity/warning states are collapsed into boolean-ish badges.** `isDoNotUse`, `isEntryPassed`, `isStale` are derived from `recommendation_validity_status`, but the actual `volatility_warning` text field (fetched via the `recommendation_version` join) is never printed — only the coarse "High volatility" label survives. Likewise the `ENTRY_ALREADY_PASSED` override is computed from a precise ATR-distance calculation (`distanceInAtrs`, `ENTRY_DISTANCE_THRESHOLD_ATR = 1.5`) in `runEngineSession.ts`, but the number itself never reaches the UI — only a static warning sentence.
- **Historical performance is scoped too coarsely, and inconsistently with what the engine itself uses.** The workspace's "Your record" line (`marketHistoryByMarket`) aggregates the analyst's own trades by `market_id` only — ignoring direction and zone. Yet `analyst_profiles` already stores the analyst's history broken out by `market_id + direction + zone`, and it's this exact granular table that the allocation/profile-scoring logic in `runEngineSession.ts` (`profileScores`, `preferredDirectionByMarketId`) uses to decide direction and analyst fit. The UI recomputes a cruder, market-only version of a number the engine already has at full resolution.
- **No indication of sample size or confidence behind trigger probability / expected R.** `trigger_probability` and `expected_r` are shown as single point numbers, but they're built from `template.templateTrades`/`templateQuality` and `profile.profileTrades`/`profileQuality` — i.e., the engine knows whether a number is backed by 400 historical trades or 6. That distinction (`RecommendationDiagnostics`) is computed on every single generation and discarded before it ever reaches a table, let alone the screen. An analyst has no way to tell "well-supported edge" from "fallback guess" on any given card.
- **No freshness/expiry signal.** `computeExpiresAt()` writes a real `expires_at` on every `shadow_trades` row (mirroring recommendation lifetime), and `requires_refresh`/`is_active` exist on `recommendation_versions` — but the workspace never shows "generated 40 min ago" or "expires in 2h 15m." For an intraday tool this is a basic trust signal that's currently absent.
- **Cards are presented in arbitrary order.** The query sorts by `shown_at desc` only; there is no ranking by expected R, trigger probability, event risk, or expiry urgency. On a 28-market EUROPEAN session, the analyst scrolls through cards in insertion order, not priority order.
- **"Why this allocation?" conflates two different questions.** `coaching_note` explains why the *system* assigned this market to *this analyst* (allocation reasoning) but is presented as if it were trade thesis. An experienced analyst cares primarily about *why this zone, this direction, this R* — the allocation-fit explanation is a secondary, management-facing concern that's currently given the same visual weight as the trade rationale.

### 2.2 Collected, but never shown at all

- `market_regime_state.regime_confidence`, `.regime_tags`, `.derived_from` (raw EMA20/50/200, ADX14, directional persistence %, ATR percentile).
- `opportunities.current_zone` / `.preferred_entry_zone` (fetched, unrendered).
- `recommendation_versions.volatility_warning` (specific text), `.atr_move_since_generation`.
- `RecommendationDiagnostics` in full — `templateSource`, `templateAvgR`, `templateWinRate`, `templateTrades`, `templateQuality`, `profileSource`, `profileAvgR`, `profileWinRate`, `profileTrades`, `profileQuality` — never persisted, so structurally unavailable to any future UI without a schema change.
- `analyst_profiles.profile_data` at market+direction+**zone** granularity.
- `template_profiles` / `trigger_probability_profiles` — market+zone+direction level sample sizes and strength scores, i.e. exactly the "how much do we trust this" data an analyst would want.
- `market_event_risk.risk_score` (numeric) and `.analyst_warning` (bespoke text) — only the event name/time/impact/currency are shown; the risk score and the system's own warning text are dropped.
- `market_state_daily` previous-day OHLC — no "yesterday's range/close" context anywhere, despite it being a single indexed lookup away.
- The zone ladder itself as a *visual* object — it exists conceptually everywhere in the schema (`atr_zone` enum: presumably `ZONE_1..ZONE_4`/`TOO_DEEP`/`TOO_HIGH`) but has no visual representation anywhere in the product.

### 2.3 What's missing entirely (no data gap — genuine product gap)

- **No market coverage overview.** No way to scan all of today's markets at a glance (direction, R, trigger%, event risk) before opening a full card. Today's only summary is a row of colored pills with no numeric content — no scan-ability.
- **No closed action loop.** The workspace shows a recommendation and stops. There's no "Entered / Skipped / Watching" affordance anywhere on the card. The only place a decision resurfaces is in `actual_trades`, populated later through an entirely separate reconciliation pipeline (`ACUITY_PERFORMANCE_API` / `MANUAL_BACKFILL`) with no connection back to the recommendation the analyst actually looked at. An analyst reviewing a recommendation today has to go execute in an external system and trust that reconciliation will eventually match it up — there's no in-workspace record of the decision at decision time.
- **No visual chart.** Every signal — zone, ATR bands, EMA relationship, session high/low — is numeric/textual. Nothing plots price against the zone bands, despite the entire methodology being built around a visual band construction (Pine-style, `captureIntradaySnapshot.ts`).

## 3. Redesign proposal

### 3.1 Design direction

Think instrument panel, not notification feed. The reference point should be a Bloomberg/trading-terminal density and information hierarchy: dense, numeric-first, monospace for anything tabular or price-like, color used sparingly and consistently (direction and P&L only — not decoration), minimal prose. Every number the engine already computes and trusts enough to act on should be a number on screen, not a re-encoded adjective. Coaching language (`coaching_note`) stays, but demoted to a secondary/collapsed element — it is guidance, not the headline.

Concretely:
- Dense data rows/tables over card-per-item padding wherever multiple markets are compared.
- Tabular/monospace numerals for price levels, R-multiples, percentages — consistent decimal alignment.
- A visual zone ladder (small horizontal or vertical band widget: Too High · Zone 4 · Zone 3 · Zone 2 · Zone 1 · Too Deep, current price and preferred entry zone both marked) replaces the current invisible `current_zone`/`preferred_entry_zone` fields — this single widget recovers three of the "collected but unshown" findings at once (zone, entry zone, and implicitly how far price has to move).
- Confidence is always paired with its number: never "Trending up" alone — "Trending up · ADX 31 · HIGH confidence." Never "62% trigger" alone — "62% trigger · profile n=340, HIGH quality."

### 3.2 Information hierarchy (top to bottom, coarse to fine)

1. **Session header** (kept, lightly extended): greeting, session status, today's date — plus a live countdown to session close and next session open, since this is an intraday tool.
2. **Market coverage strip** (new — replaces the plain pill row): one compact row per market, sortable/scannable, no scrolling into individual cards required to get the shape of the session.
3. **Per-market detail card** (redesigned): opened either inline (expand) or as the default per-market view — this is where the ATR zone ladder, regime numbers, previous-day summary, historical zone win-rate, and news/event detail live.
4. **Action row** at the foot of each card: Entered / Skipped / Watching, feeding the closed-loop tracking described in 3.4.

### 3.3 Market coverage strip

A single dense table/grid, one row per market with an open recommendation today, sorted by a priority score (expected R × trigger probability, with event-risk and near-expiry markets pinned to the top or flagged). Columns:

| Symbol | Dir | Zone | Trigger % (n) | Expected R | Regime | Event | Expires |
|---|---|---|---|---|---|---|---|
| EURUSD | BUY | Z2→Z1 | 58% (n=210, HIGH) | +1.4R | ↑ ADX 29 | — | 1h 40m |
| GBPJPY | SELL | Z4 | 41% (n=18, LOW) | +0.6R | mixed | ⚠ 14:30 CPI | 3h 10m |

- `Zone` shows current → preferred as a compact transition, not just one value.
- `Trigger %` always carries its sample size and quality tier inline (`RecommendationDiagnostics.templateTrades`/`templateQuality` would need to be persisted — see 3.5 data dependencies).
- `Regime` is an arrow + ADX number, not a word.
- Clicking/expanding a row opens the detail card in place (no page navigation) — keeps the "reviewing → acting" flow on one screen.

### 3.4 Per-market detail card contents (as specified)

- **Current zone**: rendered via the zone ladder widget (3.1), current position and preferred entry zone both marked, plus current price and distance-to-entry in ATRs (this number already exists as `distanceInAtrs` in `runEngineSession.ts` — currently computed and discarded except as a boolean flag).
- **ATR entry/stop/target**: entry range as today (numeric, structured). Stop/target upgraded from opaque text to the same numeric-first treatment: show the formatted guidance range as now, but *also* express it as an R-distance and an ATR-distance from entry, computed client-side from the existing numeric pieces — no new hidden-level exposure required, no change to the shadow-system boundary.
- **Regime**: trend arrow + ADX14 value + EMA20/50/200 stack (e.g. "20 > 50 > 200") + regime confidence tier, sourced from `market_regime_state.derived_from` and `.regime_confidence` (already computed daily, just needs a read path to the workspace).
- **Trend strength**: ADX14 value itself, plus the directional-persistence percentage ("18/20 up days") — both already in `derived_from`.
- **Volatility expansion/contraction**: `volatility_state` plus the actual ATR percentile number, and — new derived signal — whether percentile has risen or fallen vs. yesterday's row (expansion vs. contraction), computed by comparing the two most recent `market_regime_state` rows for the market.
- **Previous-day summary**: prior session's OHLC and range from `market_state_daily` (a single indexed lookup, `market_id + date = yesterday`), plus — if the analyst had a trade in that market yesterday — its outcome inline.
- **News/event flags**: keep `MarketNews` headline and the existing HIGH_RISK badges, but also surface `market_event_risk.risk_score` and the system's own `analyst_warning` text (both already fetched-adjacent, currently dropped), and show forecast/previous/actual from `economic_calendar_events` where available rather than just the event name.
- **Historical win rate by zone**: replace the market-only "Your record" line with the analyst's `analyst_profiles` row scoped to this exact `market_id + direction + zone` (avg R, trigger rate, sample size) — this is a direct read of data that already exists and is already used server-side for allocation; it just needs to reach the client.
- **Trigger probability**: keep the capped percentage, but always paired with `templateSource`/`templateQuality`/`templateTrades` so the analyst can see whether it's a well-supported historical template or a fallback estimate.

### 3.5 Data dependencies this proposal introduces (flagged, not designed here)

Everything in 3.4 is derivable from tables that already exist **except** `RecommendationDiagnostics`, which is currently computed then discarded in-memory. Surfacing template/profile quality and sample size in the UI requires either (a) persisting `RecommendationDiagnostics` onto `recommendation_versions` (new columns) or a new child table at generation time, or (b) recomputing it read-time from `analyst_profiles`/`template_profiles`/`trigger_probability_profiles` directly in the page query. This is a real scoping decision for whoever implements this and is called out here deliberately, since it's the one piece of the proposal that isn't a pure "read what's already stored" change.

### 3.6 Action flow: reviewing a recommendation → placing a trade

1. Analyst scans the **coverage strip**, sorted by priority; event-risk and near-expiry rows are visually pinned.
2. Analyst expands a row into the **detail card** — zone ladder, regime numbers, historical zone edge, and guidance levels are all visible without leaving the strip.
3. Analyst records an **intent** directly on the card — `Entered` / `Skipped` / `Watching` — timestamped immediately. This does not replace the downstream `actual_trades` reconciliation pipeline (API/backfill remain the system of record for realized R), but it closes the loop the workspace currently lacks entirely: a record that the analyst actually looked at and acted on the recommendation at the moment they looked at it, independent of whether reconciliation later confirms it. `Watching` keeps a market pinned to the top of the strip until it triggers or expires; `Skipped` optionally prompts a one-line reason (useful downstream for coaching and for auditing why good setups go untaken).
4. If the analyst enters, the guidance levels (entry/stop/target as ATR-distances) stay visible for reference until `expires_at`, after which the card visually retires (rather than silently vanishing, which is what effectively happens today once a new session's recommendations replace the list).

This keeps the platform's existing shadow/actual-trade architecture completely untouched — no shadow-system boundary is crossed, no new hidden level is exposed — while giving the analyst-facing workspace an honest record of decisions made in the moment, which today only exists implicitly and after the fact.

---

## Summary

The data model is already close to what an experienced technical analyst would want; the workspace just doesn't ask for most of it. The single highest-leverage change is architectural rather than visual: stop reducing computed numbers (ADX, EMA stack, ATR percentile, template sample size/quality, zone) to adjectives and booleans, and let the analyst see the numbers the engine is already trusting enough to act on. The zone ladder, the coverage strip, and the zone-scoped historical edge are the three changes most in the spirit of "Bloomberg terminal, not SaaS dashboard" — dense, numeric, scannable, and honest about confidence.
