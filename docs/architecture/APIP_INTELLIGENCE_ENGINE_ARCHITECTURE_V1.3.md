# APIP Intelligence Engine Architecture V1.3 — FROZEN BASELINE

**Status:** Approved baseline. Implementation must conform to this document. Any future architectural change is a versioned amendment proposal against this baseline, not a direct edit to it.
**Supersedes:** V1.2. Unlike V1.1→V1.2 (a correction of factual errors against the notebook), this is a genuine **decision amendment**: two places where the notebook's literal behaviour would surface `NaN` in a production output, and Joe explicitly approved a specific production-side resolution for each. The notebook itself is unchanged and remains correct as research — these are documented departures for production, not corrections of a prior misreading.
**Scope:** Phase 1.5 (Intelligence Engine) only. Coaching layer (1.6) and Dashboard layer (1.7) consume this engine but are out of scope here.
**Inputs to this document:** `APIP_NEXTJS_PLATFORM_SPEC_V1_6.xlsx` (defines WHERE — schema, lifecycle, governance), `APIP_RESEARCH_ENGINE_V1_0.ipynb` (defines HOW — the validated behavioural reference, and a first-class, permanently-compared architectural citizen per Amendment 4), and the as-built Phase 1.1–1.4 schema (44 tables, already live in Supabase staging, `migrations/001`–`029`).

## Changelog: V1.2 → V1.3

Found during Step 4 implementation (`EntryOptimizerService`, `ExpectedRService`): two places where the notebook's exact behaviour produces `NaN` in circumstances that are realistic in production (not edge cases invented for the sake of argument), and a `NaN` recommendation field is never an acceptable real-world output regardless of how faithfully it reproduces the notebook. Both were raised to Joe explicitly rather than silently patched, and both were approved as stated.

| # | Departure | Notebook behaviour | Production behaviour (this amendment) | Section |
|---|---|---|---|---|
| 1 | `zoneBounds` for `TOO_DEEP`/`TOO_HIGH` | Undefined — falls through to `[NaN, NaN]` | **Clamped**: `TOO_DEEP` uses `ZONE_1`'s bounds, `TOO_HIGH` uses `ZONE_4`'s bounds | 3.6 |
| 2 | `ExpectedRService` weighting when a component's `avgR` is `NaN` | Included anyway (`trades > 0` is the only filter) — `NaN` propagates through the whole weighted average | **Excluded**: a `NaN`-`avgR` component is treated as if it had zero trades. If both components end up excluded this way, falls through to the existing `rawExpectedR = 0.0` case | 3.8 |

**Why these were treated as decisions, not bug fixes:** both are the notebook working exactly as designed — they are not implementation mistakes. A different, equally defensible choice existed for each (e.g. extrapolating `TOO_DEEP`/`TOO_HIGH` by a fixed zone-width instead of clamping; or surfacing a `LOW`-confidence-flagged zero instead of silently excluding a `NaN` component) — Joe chose the simpler option in both cases, specifically because it introduces no new arbitrary parameter needing its own justification. Recorded here so neither choice is mistaken for "the only possible fix" later.

No other section is affected. V1.2's corrections (Sections 3.4, 3.5, 12 item 1) remain in force exactly as stated there.

---

## Changelog: V1.1 → V1.2 (preserved for history)

**This was a correction amendment.** During Step 3 implementation (`TemplateService`/`AnalystProfileService`), the actual notebook source for cells 8 and 9 was re-read directly rather than relied on from an earlier summary — and V1.1's own Sections 3.4 and 3.5 turned out to be factually wrong in several specific, checkable ways. This is exactly the kind of drift the versioned-amendment process exists to catch; corrected then rather than silently patched in code without updating the document that's supposed to be the contract.

| # | Correction | What V1.1 said | What the notebook actually does |
|---|---|---|---|
| 1 | `min_template_trades` value | 20 | **10** |
| 2 | Template/profile quality logic | Trade-count threshold alone | Trade-count threshold **AND** `avgR > 0` — both required |
| 3 | `AnalystProfile` shape | "Same shape... as TemplateService" | Has **no `triggerRate` field at all** — a real structural difference, not cosmetic |
| 4 | `selectBestAnalyst` algorithm | Implied same single-threshold-filter shape as `selectBestTemplate` | A genuinely different **three-tier cascade**: exact match → market-only match → literal first-eligible-analyst with zero scoring |
| 5 | Section 12 item 1 (null-zone grouping) | Listed as an unresolved open question | **Resolved**: null-zone trades are pooled into their own group (not excluded); if that group wins selection, the *output* zone defaults to `ZONE_1` rather than propagating null |

No other section of V1.1 was affected. Sections 1.1–1.4, 1.6–1.7, 2, 3.1–3.3, 3.6–3.14, 4–11, and items 2–8 of Section 12 carried forward unchanged.

---



---

## 0. How to read this document

This is the approved, frozen baseline (V1.1) — the seven resolutions in Section 1 and the eight amendments incorporated throughout (see Changelog above) have already been reviewed and approved. Section 1 is still the most important section to read first, since every other section depends on its resolutions, but it is no longer a set of open recommendations awaiting sign-off — it is the contract. Any future disagreement with a resolution here is a proposed amendment against this baseline (a new versioned document, V1.2 and onward), not an in-place edit.

---

## 1. Resolved Ambiguities (read first)

### 1.1 — The recommendation lifecycle has three different vocabularies. This is the most consequential conflict in the whole document.

Three sources, three different state lists:

| Source | States |
|---|---|
| Build prompt (Phase 1.5.5) | `VALID`, `WATCH`, `STALE`, `ZONE_CHANGED`, `EVENT_RISK`, `RECALCULATE`, `DO_NOT_USE` |
| Database enum (`recommendation_validity_status`, `001_schema.sql`) | `VALID`, `CAUTION_VOLATILITY`, `STALE_PRICE`, `ZONE_CHANGED`, `ENTRY_ALREADY_PASSED`, `DO_NOT_USE_RECALCULATE`, `RECALCULATING`, `ARCHIVED` |
| Notebook (`assess_condition`, cell 10) — what's actually *implemented* | Only ever produces: `VALID`, `ZONE_CHANGED`, `STALE_PRICE`, `DO_NOT_USE_RECALCULATE` |

The notebook — the validated behavioural reference — only ever emits **four** of the eight states the database already supports, and uses none of the build prompt's seven-state vocabulary at all. Critically, **the notebook never produces an event-risk-driven validity state** — `event_risk_status` is tracked as a separate field on the recommendation and never escalates `recommendation_validity_status`, even when `event_risk_status = EVENT_ACTIVE`.

**Resolution:** The database enum is authoritative (it's already live, already has RLS policies and audit triggers built against it, and a schema migration to rename it now would touch everything downstream). The notebook's four implemented states map directly onto four of the eight DB values with no translation needed. The remaining four DB values (`CAUTION_VOLATILITY`, `ENTRY_ALREADY_PASSED`, `RECALCULATING`, `ARCHIVED`) are **not currently produced by any validated logic** — they exist in the schema as forward-provision, not as behaviour to implement in 1.5. Treat them as out of scope for the first implementation pass; flag in code comments exactly which states are "schema-ready, logic-pending" so nobody mistakes their absence for an oversight later. The build prompt's `WATCH`/`RECALCULATE`/`DO_NOT_USE` vocabulary is **not used anywhere in implementation** — it was descriptive shorthand in the prompt, not a contract.

**Mapping table (canonical, use this everywhere downstream):**

| Notebook output | DB enum value | Implemented in 1.5 v1? |
|---|---|---|
| `VALID` | `VALID` | Yes |
| `ZONE_CHANGED` | `ZONE_CHANGED` | Yes |
| `STALE_PRICE` | `STALE_PRICE` | Yes |
| `DO_NOT_USE_RECALCULATE` | `DO_NOT_USE_RECALCULATE` | Yes |
| — | `CAUTION_VOLATILITY` | No — reserved |
| — | `ENTRY_ALREADY_PASSED` | No — reserved |
| — | `RECALCULATING` | No — reserved (this is an orchestration *transition* state, not a condition-assessment output; see 5.3) |
| — | `ARCHIVED` | No — reserved (set when a new version supersedes this one, not by condition assessment) |

**Amendment 7 — code-level convention, not just documentation.** Documentation alone has a half-life; a developer six months from now reading the `recommendation_validity_status` enum definition has no way to tell, from the database schema itself, which of the 8 values are reachable by any code path today. This must be encoded in code, not only in this document:

```typescript
// One file, one source of truth, imported everywhere RecommendationValidityStatus
// is referenced -- never re-derive this list inline at a call site.
export const IMPLEMENTED_VALIDITY_STATES = [
  'VALID', 'ZONE_CHANGED', 'STALE_PRICE', 'DO_NOT_USE_RECALCULATE',
] as const;

export const RESERVED_VALIDITY_STATES = [
  'CAUTION_VOLATILITY', 'ENTRY_ALREADY_PASSED', 'RECALCULATING', 'ARCHIVED',
] as const;

// A runtime assertion, not just a type -- if RecommendationLifecycleService
// ever returns a reserved state, this should be impossible by construction,
// and if it somehow happens (e.g. a future careless edit), fail loudly in
// every environment, not just in a type-checker that a build script ignored.
export function assertImplementedState(status: string): asserts status is ImplementedValidityState {
  if (!IMPLEMENTED_VALIDITY_STATES.includes(status as any)) {
    throw new Error(
      `RecommendationLifecycleService produced '${status}', which is a RESERVED schema ` +
      `capability, not an implemented one. This indicates either a bug or an undocumented ` +
      `behaviour change that needs its own architecture amendment.`
    );
  }
}
```

`RecommendationLifecycleService`'s actual return type (Section 3.10) should be narrowed to the implemented-states union, not the full 8-value DB enum — TypeScript itself should make it a compile error to return a reserved state from that service, with the runtime assertion above as a backstop for any path that constructs the value dynamically rather than through a literal.

### 1.2 — Zone naming convention differs between notebook and database.

Notebook: `'Too Deep'`, `'Zone 1'`, `'Zone 2'`, `'Zone 3'`, `'Zone 4'`, `'Too High'` (mixed case, spaces).
Database (`atr_zone` enum): `TOO_DEEP`, `ZONE_1`, `ZONE_2`, `ZONE_3`, `ZONE_4`, `TOO_HIGH`.

**Resolution:** Trivial but must be explicit and centralized. One pure function, `toDbZone(notebookZone: string): AtrZone`, used at every boundary where a zone value crosses from computation into persistence. Never inline a string transform at a call site — this exact class of bug (silent mismatch between two equivalent-looking string formats) has cost real debugging time multiple times already in this project's ingestion phase.

### 1.3 — Session naming convention differs between notebook and database.

Notebook: `'Europe'`, `'US'`, `'APAC'`, `'Crypto'` (mixed case).
Database (`session_type` enum): `EUROPEAN`, `US`, `APAC`, `CRYPTO`.

Note `'Europe'` → `EUROPEAN` is not a case change, it's a different word. A naive `.toUpperCase()` will not catch this one and will silently produce an invalid enum value that PostgreSQL rejects at insert time (a loud failure, at least — but worth naming explicitly so nobody "fixes" it by adding a `EUROPE` value to the enum instead of fixing the mapping).

**Resolution:** Same pattern as 1.2 — one `toDbSession()` function, explicit lookup table, no inline transforms.

### 1.4 — The "Opportunity Engine" described in the build prompt does not exist as a distinct step in the notebook.

The build prompt describes Phase 1.5.1 as a gate: "Determine whether a market currently represents a meaningful opportunity," with explicit outputs `Opportunity`, `Opportunity Quality`, `No Recommendation` + `Reason`. This implies a pass/fail decision *before* recommendation generation — some markets should produce no opportunity at all.

The notebook does not do this. `build_recommendations` (cell 10) iterates every row in `market_state` and **always** produces a recommendation — there is no quality gate, no rejection path, no "no opportunity today" outcome anywhere in the implemented logic. `minimum_rr` (2.0) is used only as an *input* to `construct_stop_target`'s target-distance formula (the target is placed at exactly `minimum_rr × risk` from entry, guaranteeing RR=2.0 by construction) — it is never used as a filter that could reject a setup for having insufficient RR. Similarly there is no `template_quality` or `expected_r` threshold that suppresses a recommendation.

**Resolution:** This is a genuine gap between the validated research and the described production architecture, not a naming nuance, and it needs a product decision, not just an engineering one. Two honest options:

- **(A) Match the notebook exactly for v1**: every market in `market_state` produces an opportunity and a recommendation, every session. `OpportunityService` becomes a thin pass-through that always returns "yes, opportunity exists."
- **(B) Add a quality gate now**, going beyond what the notebook validates.

**Decision (per Amendment 1): (A), with `OpportunityService` documented explicitly as a permanent extension point, not a temporary pass-through that happens to do nothing yet.** The distinction matters: a "temporary pass-through" invites a future developer to delete the service and inline `hasOpportunity: true` directly into `RecommendationService`, on the reasonable assumption that an indirection doing nothing is dead weight. That would be the wrong outcome here. `OpportunityService` exists as a named seam specifically so that when qualification rules are research-validated, they have a home that doesn't require restructuring the pipeline around them.

**Contract for v1 (unchanged from the original recommendation):**

```typescript
interface OpportunityInput { marketState: MarketStateOutput; }
interface OpportunityOutput {
  hasOpportunity: true;          // v1: always true, literal type, not boolean -- see note
  qualityScore: null;            // reserved, see below
  noRecommendationReason: null;  // reserved, see below
}
```

**Documented future qualification rule categories (reserved, not built, not even stubbed with placeholder logic — each requires its own research validation pass against the notebook's methodology before being added to this service):**

| Category | What it would gate on | Research dependency |
|---|---|---|
| Minimum expected R | `ExpectedRService` output below a threshold | Needs a validated threshold, not an arbitrary one — `ExpectedRService`'s output distribution across real historical data would need characterizing first |
| Minimum trigger probability | `TriggerProbabilityService` output below a threshold | Same — needs the trigger-probability distribution characterized, not an assumed cutoff |
| Event-risk suppression | `EconomicCalendarService` returning `EVENT_ACTIVE`/`HIGH_RISK` for the market | Conceptually simple, but needs a decision on whether suppression means "no recommendation at all" or "recommendation generated but flagged" (the latter is closer to what `event_risk_status` already does on the recommendation today, per Section 3.3 — so this category may turn out to already be handled, just not as a *rejection*) |
| Volatility suppression | `MarketRegimeService.volatilityState === 'HIGH_VOL'` | Needs validation against whether high-volatility setups have historically been worse, not assumed |
| Market quality scoring | A composite score combining several of the above | Needs the individual components validated first; a composite of unvalidated components is not itself validated by combination |
| Regime suitability | `MarketRegimeService.trendState` vs. the selected template's directional bias | Needs validation of whether trend-counter setups have historically underperformed for this specific platform's templates, not assumed from general trading theory |

**The common thread:** every one of these categories requires evidence from the platform's own historical data (the 30,825-row backfill, going forward enriched per Amendment 2 below) run back through a notebook-equivalent validation process *before* it becomes production logic — not because the ideas are bad, but because the entire premise of this architecture (Sections 7, 10) is that production behaviour traces back to validated research, and a qualification rule invented during implementation would be exactly the kind of silent drift this whole document exists to prevent.


### 1.5 — `actual_trades` has no entry-zone-at-time-of-trade field, which silently degrades template/profile quality.

The notebook's `build_template_profiles` / `build_analyst_profiles` group historical trades by `(market, direction, entry_zone)`. The notebook's own `add_entry_zone_if_missing` helper reveals the gap: it only populates `entry_zone` if an `atr_zone` column already exists on the input; otherwise every row gets `NaN`. **Our live `actual_trades` table has no column recording which ATR zone a trade was entered in** — not in the original schema, not in the 30,825-row historical backfill, not in the Acuity Performance importer.

Without this field, every template/profile group collapses to a single `(market, direction, NaN)` bucket — the entire zone-conditioning premise of the templating engine (the actual mechanism that decides "Zone 2 entries have historically outperformed Zone 3 entries on EURUSD BUY") silently degrades to "all EURUSD BUY trades, regardless of where they entered," for the entire 30,825-row backfill and 43,434-row publication history.

**Resolution (Amendment 2 — feasibility assessed, not assumed):**

The ATR/zone math itself is not the obstacle — `MarketStateService` (Section 3.1) already implements the exact validated formula, and applying it retroactively to a historical date is computationally identical to applying it to today. **The actual blocker is data coverage, specifically `markets.finnhub_symbol`.** Of the ~280 markets now in the live schema (217 from the original spreadsheet classification, plus roughly 80 more discovered and added during the five alias-mapping rounds in Phase 1.4), **exactly one — `EURUSD` — has `finnhub_symbol` populated**, set during the original Finnhub live test. Every other market, including every equity, every index, every commodity beyond `EURUSD`, has never had its Finnhub symbol resolved. Historical OHLC cannot be pulled for a market Finnhub cannot be asked about, regardless of how good the ATR formula is.

This reframes the real question from "can we compute historical ATR" (yes, trivially) to "for how many of our ~280 markets, across how much of 2017–2026, does Finnhub actually have daily OHLC depth, and can we map our internal symbol to Finnhub's for each one" — which is itself a research question requiring investigation, not something this document can answer from memory. What can be stated with confidence, by category:

| Market category | Expected Finnhub historical depth | Confidence this is reconstructable |
|---|---|---|
| Major FX pairs (`EURUSD`, `GBPUSD`, `USDJPY`, etc.) | Typically very deep, often 10+ years, via OANDA-sourced candles (as already proven for `EURUSD`) | High |
| Major indices (`SP500`, `NASDAQ`, `DOW`, `FTSE`, `DAX`, etc.) | Generally good depth for major benchmark indices | Medium-High — needs per-symbol confirmation, not assumed |
| Liquid large-cap equities (`AAPL`, `MSFT`, `AMZN`, etc.) | Generally good depth, often back to listing or further | Medium-High |
| Commodities (`Gold`, `Oil`, `Brent`, `Natural Gas`, `Copper`) | Variable — depends on which underlying instrument Finnhub maps these to (spot vs. futures vs. CFD proxy) | Medium — needs verification, the underlying instrument matters for whether the price series is even the right one |
| Smaller/regional equities (`Solutions 30`, `Engie`, `ASM International`, and similar names surfaced during the alias work) | Unknown, plausibly limited or entirely absent on Finnhub's free/standard tier | Low — should not be assumed without checking |
| Crypto (`Bitcoin`, `Binance Coin`/`BNBUSD`) | Generally good depth on major exchanges Finnhub covers | Medium-High |

**A second, independent limitation, even where Finnhub coverage exists:** `MarketStateService`'s `currentZone` classification is computed against a live intraday price at the moment of generation, not the daily close. For historical reconstruction, the best available stand-in for "the price at the moment this trade was published" is the trade's own recorded `entry` price — but that price already reflects the analyst's own zone judgement at the time (an analyst choosing to enter is itself evidence of where they believed the zone was), which introduces a mild circularity that doesn't exist for live, forward-looking zone classification. This isn't disqualifying, but it means a reconstructed historical zone is a **lower-fidelity estimate**, not an equivalent-confidence equal of a live-computed one, and the two should never be presented or treated identically downstream.

**Recommendation:**

1. **Do not commit to reconstructing all ~74,000 historical records (30,825 backfilled trades + 43,434 publications) up front.** The Finnhub coverage question is genuinely unknown for the majority of markets and needs to be checked, not assumed favourable.
2. **Run a scoped pilot first**: pick the 10–15 highest-volume markets by trade count (almost certainly the major FX pairs and a handful of large-cap equities, based on the analyst coverage patterns already visible in the backfilled data), attempt the Finnhub historical pull + symbol mapping for just those, and measure actual coverage and depth before deciding whether to extend further.
3. **If reconstruction proceeds, mark its provenance explicitly, never silently.** Add `actual_trades.entry_zone_source` (`'LIVE_COMPUTED'` | `'HISTORICAL_RECONSTRUCTED'` | `null`) alongside `entry_zone` itself, so `TemplateService`/`AnalystProfileService` (and any future code) can distinguish reconstructed-zone confidence from live-zone confidence rather than treating a 2019 estimate and a 2026 live measurement as equivalent inputs to `template_quality`/`profile_quality`.
4. **NULL remains the honest fallback** for any market/period where Finnhub coverage doesn't exist or symbol mapping can't be confirmed — per the original resolution, this is not a regression, it's the correct behaviour when reconstruction genuinely isn't possible.

This pilot is scoped as its own roadmap item (Section 11, new Step 2a) — it should run *before* committing to the full `entry_zone` backfill, not as a blocking prerequisite to starting Context 1 work, since `MarketStateService`/`MarketRegimeService`/`EconomicCalendarService` (Section 11, Step 1) have no dependency on historical zone reconstruction at all.

### 1.6 — Shadow trade lifecycle: notebook conflates a two-table design into one field.

Notebook's `shadow_status` (`'ACTIVE'` / `'WATCH'`) lives directly on the shadow trade record and is derived purely from the *recommendation's* validity status at creation time. The live schema deliberately splits this into two tables — `shadow_trades` (immutable: entry/stop/target/confidence at creation) and `shadow_trade_outcomes` (mutable: `trade_outcome_status` evolving from `NOT_TRIGGERED` through `TRIGGERED`/`TARGET_HIT`/`STOP_HIT`/`EXPIRY`/`CANCELLED`/`AMBIGUOUS` as the market actually moves) — because a shadow trade's outcome needs to evolve independently of the recommendation that spawned it, and immutability of the original entry/stop/target matters for audit (Phase 1.1 design intent, predates this document).

**Resolution:** The notebook's `shadow_status` is not a real outcome-tracking field at all — it's a one-time classification at creation time ("was the recommendation valid when I spawned this shadow trade"), which the live schema doesn't need as a separate field because `shadow_trade_outcomes.trade_outcome_status` starts at `NOT_TRIGGERED` for every shadow trade regardless, and the *recommendation's* validity at spawn time is already recoverable by joining to `recommendation_versions.recommendation_validity_status` via the existing FK. `ShadowTradeService` creates a `shadow_trades` row (entry/stop/target only) and a `shadow_trade_outcomes` row initialized to `NOT_TRIGGERED`; it does not need a notebook-equivalent `shadow_status` field at all. Outcome evolution (the actual TRIGGERED/TARGET_HIT/STOP_HIT logic) is **not implemented in the notebook at all** — the notebook only ever creates shadow trades, never evolves their outcomes. This is real, additional logic the production engine needs that has no validated research behind it yet. Flagged as an open implementation gap in Section 12, not silently invented here.

### 1.7 — Coverage allocation: notebook's algorithm is workload + expected-R only; live schema has richer scoring fields already designed for more.

Notebook's `allocate_coverage` scores each eligible analyst as `expected_r + (0.2 if already-assigned-by-profile else 0) − workload×0.1`, then assigns the single highest scorer, updating an in-memory workload counter as it goes. The live schema's `allocation_decision_log` already has dedicated columns for `market_fit_score`, `regime_fit_score`, `workload_score`, `availability_score`, and `final_score` — clearly designed for a richer multi-factor scoring model than the notebook implements.

**Resolution:** Implement exactly the notebook's formula for v1 — `final_score` = the notebook's single combined score, and populate `workload_score` with the `-workload×0.1` component and `market_fit_score`/`regime_fit_score` with `0` (not `NULL` — `0` documents "this factor exists in the schema but contributes nothing in v1," whereas `NULL` would look like a bug). `availability_score` should genuinely reflect `analyst_availability` for that date/session (already a live table, unused by the notebook, but trivial to incorporate as a hard eligibility filter rather than a score — an unavailable analyst should not appear in `eligible_analysts` at all, which is a stricter and more correct interpretation than the notebook's static `ACTIVE_ANALYSTS` table, which has no per-day availability concept). This is a case where extending slightly beyond the notebook is justified: `analyst_availability` already exists in production and ignoring it would be actively worse than what we already have, not just "not yet as rich as it could be."

---

## 2. Bounded Contexts

Six bounded contexts, matching the build prompt's six sub-phases, but drawn with boundaries based on what actually changes independently of what else — not just the notebook's section headers.

```
+---------------------------------------------------------------------------+
| CONTEXT 1: MARKET INTELLIGENCE                                           |
|   Owns: market state, ATR/zones, regime, event risk                      |
|   Changes when: a new data source is added, ATR formula changes          |
|   Services: MarketStateService, MarketRegimeService,                     |
|              EconomicCalendarService                                     |
+---------------------------------------------------------------------------+
| CONTEXT 2: HISTORICAL PROFILING                                          |
|   Owns: template profiles, analyst profiles                              |
|   Changes when: profiling methodology changes, new trade data arrives    |
|   Services: TemplateService, AnalystProfileService                       |
+---------------------------------------------------------------------------+
| CONTEXT 3: OPPORTUNITY & RECOMMENDATION                                  |
|   Owns: opportunities, recommendation versions, condition awareness      |
|   Changes when: selection/entry/trigger/expected-R formulas change       |
|   Services: OpportunityService, EntryOptimizerService,                   |
|              TriggerProbabilityService, ExpectedRService,                |
|              RecommendationService, RecommendationLifecycleService       |
+---------------------------------------------------------------------------+
| CONTEXT 4: HIDDEN EVALUATION  (the trust boundary -- see Section 9)      |
|   Owns: shadow trades, shadow outcomes, automation readiness             |
|   Changes when: benchmarking methodology changes                         |
|   Services: ShadowTradeService                                           |
|   NEVER consumed by: any analyst-facing service                          |
+---------------------------------------------------------------------------+
| CONTEXT 5: COACHING & REVIEW                                             |
|   Owns: coaching notes, post-trade reviews, allocation                   |
|   Changes when: coaching tone/lint rules change, allocation policy       |
|     changes                                                              |
|   Services: CoachingService, ReviewService, AllocationService           |
|   (Phase 1.6 builds most of this; 1.5 only needs AllocationService       |
|    since it's upstream of coaching, not downstream)                      |
+---------------------------------------------------------------------------+
| CONTEXT 6: BEHAVIOURAL EQUIVALENCE                                       |
|   Owns: nothing domain-specific -- cross-cutting verification layer      |
|     that reads from every other context                                  |
|   Services: ValidationService                                            |
+---------------------------------------------------------------------------+
```

**Why this grouping, not a 1:1 service-per-context mapping:** Context 3 deliberately bundles five services together rather than treating `RecommendationService` as its own context, because — per the notebook's `build_recommendations` (cell 10) — these five are never invoked independently in production usage. `EntryOptimizerService` has no meaning without an `OpportunityService` decision and a `TemplateService` zone already resolved; splitting them into separate bounded contexts would create five services that always change together, which is the textbook anti-pattern DDD bounded contexts exist to avoid. They remain separate *services* (Section 3) for testability and single-responsibility, but they share a context because they share a lifecycle and a release cadence.

---

## 3. Service Contracts

Every service below follows the same contract shape: pure-function-style `execute(input) -> output`, no hidden state, no direct database writes from "calculation" services (writes are isolated to a small number of explicitly-named persistence services, listed at the end of this section). This is what makes Section 8 (testing) and Section 10 (behavioural equivalence) tractable — a service that both calculates and persists cannot be unit tested without a database, and cannot be hash-compared against the notebook's pure-calculation cells.

### 3.1 MarketStateService

**Maps to:** notebook cell 6 (`calculate_atr`, `calculate_atr_zones`, `build_market_state`).

```typescript
interface MarketStateInput {
  marketId: string;
  ohlcSeries: OhlcBar[];        // ordered oldest -> newest, >= atrPeriod+1 bars
  currentPrice: { price: number; capturedAt: string };
  parameters: { atrPeriod: number; zoneCount: number };
}

interface MarketStateOutput {
  marketId: string;
  atr14: number | null;
  lowerBand: number | null;
  zone1Top: number | null;
  zone2Top: number | null;
  zone3Top: number | null;
  upperBand: number | null;
  currentZone: AtrZone | null;   // DB enum value, post-1.2 mapping
  stateGeneratedAt: string;
  parameterSnapshotHash: string;
}
```

**Invariants:**
- If `atr14` cannot be computed (insufficient bars) or is `<= 0`, every band/zone field is `null` and `currentZone` is `null` — never a fabricated default. Downstream services must treat `currentZone: null` as "cannot assess this market right now," not as `TOO_DEEP`/`TOO_HIGH`.
- Band collapse guard from the notebook (`if upper_band <= lower_band: lower_band, upper_band = close - atr/2, close + atr/2`) is preserved exactly — this is a real edge case the notebook explicitly handles and must not be "cleaned up" away.
- Pure function. No I/O. Caller is responsible for fetching `ohlcSeries`/`currentPrice` from `market_state_daily`/`market_state_intraday` and persisting the output.

### 3.2 MarketRegimeService

**Maps to:** notebook cell 7, `derive_market_regime`.

```typescript
interface MarketRegimeInput {
  marketId: string;
  closeSeries: { date: string; close: number }[]; // >= 60 bars for vol60 to be meaningful
}

interface MarketRegimeOutput {
  marketId: string;
  trendState: 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGE';
  volatilityState: 'LOW_VOL' | 'NORMAL_VOL' | 'HIGH_VOL' | 'UNKNOWN';
  regimeTags: string[];           // lowercase [trendState, volatilityState], matches notebook exactly
  regimeConfidence: 'LOW' | 'MEDIUM'; // notebook never produces 'HIGH' -- see note below
  capturedAt: string;
}
```

**Invariant — do not "improve" `regimeConfidence`:** the notebook's confidence logic is exactly `'LOW' if volatilityState == 'UNKNOWN' else 'MEDIUM'` — it never assigns `'HIGH'` under any input, even with abundant clean data. The DB enum (`regime_confidence`) supports `HIGH`, but the notebook does not produce it. Resist the urge to add a `HIGH` threshold during implementation; that would be exactly the kind of "alternative approach" the build prompt prohibits.

### 3.3 EconomicCalendarService

**Maps to:** notebook cell 7, `map_event_risk`.

```typescript
interface EconomicCalendarInput {
  events: { eventTimeUk: string; currency: string; eventName: string; impact: 'HIGH'|'MEDIUM'|'LOW' }[];
  currencyMarketMap: Record<string, string[]>; // which markets each currency affects
  now: string;
}

interface MarketEventRiskOutput {
  marketId: string;
  eventName: string;
  currency: string;
  impact: string;
  eventTimeUk: string;
  eventRiskStatus: 'NONE' | 'WATCH' | 'HIGH_RISK' | 'EVENT_ACTIVE';
  riskScore: number;
  analystWarning: string;
}
```

**Invariant — the exact time-window thresholds are research IP, not arbitrary:** `HIGH` impact within `[-1h, +3h]` -> `EVENT_ACTIVE` (score 0.9) if already past, `HIGH_RISK` if upcoming; `HIGH` or `MEDIUM` within `(0h, 8h]` -> `WATCH` (score 0.7 for HIGH, 0.5 for MEDIUM); otherwise `NONE` (score 0). These thresholds came from the notebook verbatim and must not be rounded, "simplified," or made configurable away from these exact values without a research re-validation. **`CURRENCY_MARKET_MAP` in the notebook is a hardcoded 4-entry sample table** — this is sample-data scaffolding, not a validated mapping, and production needs a real mapping derived from `markets.asset_class`/currency exposure, which does not exist as a concept in the schema yet (flagged in Section 12).

### 3.4 TemplateService

**Maps to:** notebook cell 8, `build_template_profiles`, `select_best_template`.

**[CORRECTED in V1.2 — see Changelog items 1, 2, 5. The contract and invariants below replace V1.1's text, which was checked against source during Step 3 implementation and found inaccurate in the ways the changelog describes.]**

```typescript
interface BuildTemplateProfilesInput {
  trades: HistoricalTradeForProfiling[]; // includes historical_backfill rows -- see invariant
}
interface TemplateProfile {
  market: string; direction: 'BUY'|'SELL'; entryZone: AtrZone | null;
  trades: number; avgR: number; winRate: number; triggerRate: number;
  templateQuality: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface SelectBestTemplateOutput {
  templateSource: 'historical_template' | 'fallback';
  direction: 'BUY' | 'SELL'; preferredEntryZone: AtrZone;
  templateAvgR: number; templateWinRate: number | null; templateTrades: number;
  templateQuality: 'HIGH'|'MEDIUM'|'LOW';
}
```

**Invariants:**
- **Includes `historical_backfill = true` rows.** Per the spec's own locked rule ("Historical backfill rows can support raw outcome profiling but cannot be used for coaching-alignment reviews") and the notebook's explicit comment in cell 0, template/profile building is raw-outcome profiling, not alignment review — backfill rows belong here. `ReviewService` (Section 3.13) is the one place backfill rows must be excluded; do not apply that exclusion here by mistake.
- **Grouping is by `(market, direction, entryZone)`, and `entryZone = null` is its own group, not excluded.** This resolves V1.1 Section 12 item 1: the notebook does not drop unknown-zone trades, it pools them.
- **`templateQuality` requires BOTH a trade-count threshold AND `avgR > 0`** — not trade count alone. `HIGH` needs `trades >= 50 AND avgR > 0`; `MEDIUM` needs `trades >= 20 AND avgR > 0`; otherwise `LOW`. A group with hundreds of trades and a negative or zero average return is `LOW`, not `HIGH` — this is real, checkable notebook behaviour, not a conservative simplification.
- **`avgR` can legitimately be `NaN`** when every trade in a group has a `null` result (pandas' `mean()` skips nulls; if none remain, the result is `NaN`, not `0`). `winRate`, by contrast, is always a real number in `[0,1]` — pandas comparison operators (`resultR > 0`) yield `false` for a null/NaN comparand, never propagate NaN, so a null result simply counts as a non-win rather than corrupting the rate. Implementations must replicate this asymmetry exactly, including using a NaN-aware comparator for any sort over `avgR` — a naive subtraction comparator's behaviour with NaN operands is undefined per the `Array.sort` specification, not merely "probably fine."
- Selection criteria for `selectBestTemplate`: `trades >= 10` (`min_template_trades`, **not 20**), sorted by `(avgR desc, trades desc, winRate desc)` with NaN sorted last regardless of direction (matching pandas' `na_position='last'` default), take the first. If no group clears the trade-count floor, return the exact fallback (`templateSource: 'fallback'`, `direction: 'BUY'`, `preferredEntryZone: 'ZONE_1'`, `templateAvgR: 0`, `templateWinRate: null`, `templateTrades: 0`, `templateQuality: 'LOW'`) — this fallback is itself part of the validated behaviour, not a placeholder to improve on.
- **If the winning group's `entryZone` is `null`, the output `preferredEntryZone` defaults to `'ZONE_1'`, never propagating `null` downstream.** This is the notebook's actual resolution of the null-zone question, not an implementation choice made independently of it.

### 3.5 AnalystProfileService

**Maps to:** notebook cell 8, `build_analyst_profiles`, `select_best_analyst`.

**[CORRECTED in V1.2 — see Changelog items 3, 4. V1.1 stated this service was "same shape and same invariants" as TemplateService — that was wrong in two structural ways, not just a missing detail, corrected below.]**

```typescript
interface AnalystProfile {
  analyst: string; market: string; direction: 'BUY'|'SELL'; entryZone: AtrZone | null;
  trades: number; avgR: number; winRate: number;
  profileQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  // NOTE: no triggerRate field. TemplateProfile has one; AnalystProfile does not.
}

type ProfileSource = 'exact_profile' | 'market_profile' | 'fallback';
interface SelectBestAnalystOutput {
  assignedAnalyst: string | null; // a PREFERENCE signal -- see note below, AllocationService may pick differently
  profileSource: ProfileSource;
  profileAvgR: number; profileWinRate: number | null; profileTrades: number;
  profileQuality: 'HIGH'|'MEDIUM'|'LOW';
  eligibleAnalysts: string[];
}
```

**Invariants:**
- **Grouping adds `analyst` to the key** (`analyst, market, direction, entryZone`), with the same null-pooling, `avgR`-can-be-NaN, and dual-condition quality logic as `TemplateService` (Section 3.4) — that part of the original "same as TemplateService" claim was correct.
- **No `triggerRate` field exists on `AnalystProfile` at all.** This is a real structural difference from `TemplateProfile`, not an oversight to fix — the notebook's `build_analyst_profiles` simply never computes one.
- **`selectBestAnalyst` is a three-tier cascade, structurally different from `selectBestTemplate`'s single-threshold filter:**
  1. Compute `eligible` = analysts where `active === true` AND `sessionEligibility[session] === true`.
  2. **Tier 1 (`exact_profile`):** among profiles for this market belonging to an eligible analyst, filter to `direction` AND `entryZone` both matching exactly. If any exist, pick the best by `(avgR desc, trades desc, winRate desc)` (same NaN-last sort discipline as Section 3.4).
  3. **Tier 2 (`market_profile`):** if tier 1 is empty, fall back to any profile for this market belonging to an eligible analyst, regardless of direction/zone. Pick the best by the same sort.
  4. **Tier 3 (`fallback`):** if both tiers are empty, assign the **literal first analyst in the eligible list, with zero scoring** — not the analyst with the best general track record, not a random choice, just positional first. `profileQuality` is forced to `'LOW'`, `profileAvgR` to `0`, `profileWinRate` to `null`, `profileTrades` to `0`. `assignedAnalyst` is `null` only if `eligible` itself is empty.
- **Production mapping for `sessionEligibility`:** the notebook's `ACTIVE_ANALYSTS` table is sample data with static per-session booleans. The live equivalent is `analysts.sessions` (which sessions an analyst generally covers) joined against `analyst_availability` for the specific date (whether they're actually available that day) — the latter is a real production refinement beyond what the notebook validates, justified because `analyst_availability` already exists in the live schema and ignoring it would be worse than using it, consistent with V1.1 Section 1.7's reasoning for the same kind of justified extension.
- **This service's output is a preference, not AllocationService's final word.** `select_best_analyst`'s choice becomes a `+0.2` scoring bonus inside `allocate_coverage` (Section 3.12 / notebook cell 12), alongside `expected_r` and live workload tracking — `AllocationService` can and does pick a different analyst than this service preferred, if workload balancing outweighs the preference bonus. Treat `assignedAnalyst` here as "preferred_analyst" in spirit, even though the notebook field is literally named `assigned_analyst` at this stage. This relationship was correctly described in V1.1 Section 1.7's resolution; what was missing was stating it explicitly here too, next to the service it actually concerns.



### 3.6 EntryOptimizerService

**Maps to:** notebook cell 9, `zone_bounds`, `optimise_entry_range`, `construct_stop_target`.

```typescript
interface EntryOptimizerInput {
  marketState: MarketStateOutput; direction: 'BUY'|'SELL'; preferredZone: AtrZone;
  minimumRr: number; // 2.0, from model_parameters
}
interface EntryOptimizerOutput {
  entryRangeLow: number; entryRangeHigh: number; entryMid: number;
  stop: number; target: number; rr: number;
}
```

**Invariant — RR is constructed, not measured:** `risk = atr14 * 0.25`; stop is `entryMid -+ risk`; target is `entryMid +- minimumRr * risk`. This means **every recommendation this service produces has `rr` exactly equal to `minimumRr` by construction** (subject to floating-point rounding). Do not build any downstream logic that treats `rr` as if it varied meaningfully between recommendations — it doesn't, in v1.

**Invariant — `TOO_DEEP`/`TOO_HIGH` clamp to `ZONE_1`/`ZONE_4` respectively [V1.3, approved departure from the notebook].** The notebook leaves these two zones with no defined entry range at all (falls through to `NaN`). In production, every recommendation must publish a real, usable entry range — `TOO_DEEP` is clamped to use `ZONE_1`'s bounds, `TOO_HIGH` to `ZONE_4`'s bounds, rather than extrapolating a new range or surfacing `NaN`. This was an explicit decision, not a bug fix — see the V1.3 changelog for why clamping was chosen over extrapolation.

### 3.7 TriggerProbabilityService

**Maps to:** notebook cell 9, `estimate_trigger_probability`.

```typescript
interface TriggerProbabilityInput {
  market: string; direction: 'BUY'|'SELL'; zone: AtrZone;
  trades: HistoricalTradeForProfiling[]; minTriggerSample: number; fallbackProbability: number;
}
interface TriggerProbabilityOutput {
  triggerProbability: number; triggerSample: number;
  triggerSource: 'exact_history' | 'market_zone_history' | 'fallback';
}
```

**Invariant — three-tier fallback, exact order matters:** try `(market, direction, zone)` exact match first (needs `>= minTriggerSample`, 20); if insufficient, broaden to `(market, zone)` regardless of direction; if still insufficient, fall back to the fixed `fallbackProbability` (0.50). Do not reorder these tiers or change the sample floor without research re-validation.

### 3.8 ExpectedRService

**Maps to:** notebook cell 9, `calculate_expected_r`.

```typescript
interface ExpectedRInput {
  template: { templateAvgR: number; templateTrades: number };
  profile: { profileAvgR: number; profileTrades: number };
  trigger: { triggerProbability: number };
}
interface ExpectedROutput { rawExpectedR: number; expectedR: number; }
```

**Invariant — weighting, and the trade-count cap:** `expectedR = weightedAverage([templateAvgR, profileAvgR], weights=[min(templateTrades,100), min(profileTrades,100)]) * triggerProbability`. A component with `trades == 0` is excluded from the average entirely. If neither template nor profile has any trades, `rawExpectedR` is exactly `0.0`, not `NaN` and not an exception. Implementations must replicate this exact zero-trades fallback.

**Invariant — a `NaN`-`avgR` component is also excluded, treated identically to a zero-trades component [V1.3, approved departure from the notebook].** The notebook's only exclusion filter is `trades > 0`; it does not check whether `avgR` itself is a real number, so a winning template/profile group with nonzero trades but every trade having a null result (`avgR = NaN`, per Sections 3.4/3.5) would, in the notebook, propagate `NaN` through the entire weighted average and into `expectedR`. Production must never surface a `NaN` recommendation field, so this component is excluded from the blend instead — falling back to whichever component remains real, or to the existing `rawExpectedR = 0.0` case if both are excluded this way. This was an explicit decision, not a bug fix — see the V1.3 changelog for the alternative considered (surfacing a flagged zero instead) and why exclusion was chosen.

### 3.9 RecommendationService

**Maps to:** notebook cell 10, `build_recommendations` (the orchestrating function — calls most of the others above and assembles the final recommendation).

```typescript
interface BuildRecommendationInput {
  marketState: MarketStateOutput;
  marketRegime: MarketRegimeOutput | null;
  eventRisk: MarketEventRiskOutput[]; // for this market; take highest riskScore if multiple
  templates: TemplateProfile[];
  analystProfiles: AnalystProfile[];
  trades: HistoricalTradeForProfiling[];
  eligibleAnalysts: string[]; // already filtered by session + availability
  session: SessionType;
  parameters: EngineParameters; // full snapshot, persisted verbatim
}

interface RecommendationVersionOutput {
  recommendationVersionId: string;     // generated, not derived from inputs
  opportunityId: string;               // see Section 1.4 -- always produced in v1
  versionNumber: number;
  direction: 'BUY' | 'SELL';
  preferredEntryZone: AtrZone;
  currentZone: AtrZone;
  analystAction: 'ENTER_NOW' | 'WAIT_FOR_PREFERRED_ZONE';
  assignedAnalyst: string | null;
  eligibleAnalysts: string[];
  entryRangeLow: number; entryRangeHigh: number;
  riskRange: string; targetRange: string;      // DB schema text fields, formatted from stop/target
  triggerProbability: number; expectedR: number;
  priceAtGeneration: number; zoneAtGeneration: AtrZone;
  eventRiskStatus: string; regimeTags: string[];
  recommendationValidityStatus: RecommendationValidityStatus; // from RecommendationLifecycleService, see 3.10
  requiresRefresh: boolean;
  parameterSnapshot: Record<string, unknown>;   // full PARAMETERS object, exact
  parameterSnapshotHash: string;
}
```

**Invariant — `analystAction` derivation:** `ENTER_NOW` iff `currentZone === preferredEntryZone`, else `WAIT_FOR_PREFERRED_ZONE`. Do not add tolerance bands without research validation.

### 3.10 RecommendationLifecycleService

**Maps to:** notebook cell 10, `assess_condition`.

```typescript
interface AssessConditionInput {
  recommendation: { priceAtGeneration: number; zoneAtGeneration: AtrZone };
  currentMarketState: { currentPrice: number; atr14: number; currentZone: AtrZone };
  thresholds: { staleAtrThreshold: number; forceRecalcAtrThreshold: number }; // 0.25, 0.50
}
interface AssessConditionOutput {
  recommendationValidityStatus: RecommendationValidityStatus; // see Section 1.1 mapping
  requiresRefresh: boolean;
  volatilityWarning: string;
  atrMoveSinceGeneration: number | null;
}
```

**Invariant — exact precedence order, do not reorder:**
1. If any required input is missing/non-finite or `atr14 <= 0` -> `DO_NOT_USE_RECALCULATE`.
2. Else if `zoneAtGeneration !== currentZone` -> `ZONE_CHANGED`.
3. Else if `atrMove >= forceRecalcAtrThreshold` (0.50) -> `DO_NOT_USE_RECALCULATE`.
4. Else if `atrMove >= staleAtrThreshold` (0.25) -> `STALE_PRICE`.
5. Else -> `VALID`.

Zone change is checked **before** the volatility thresholds. This ordering is not arbitrary; preserve it exactly.

### 3.11 ShadowTradeService

**Maps to:** notebook cell 11, `build_shadow_trades`. Per Section 1.6, outcome evolution beyond creation is **not** covered by validated research and is an open implementation gap (Section 12) — this service's v1 contract covers creation only.

```typescript
interface CreateShadowTradeInput { recommendation: RecommendationVersionOutput; }
interface ShadowTradeOutput {
  shadowTradeId: string; recommendationVersionId: string; opportunityId: string;
  entry: number; stop: number; target: number; rr: number;
  triggerProbability: number; expectedR: number;
  confidenceLabel: 'LOW'|'MEDIUM'|'HIGH'; // see note
  visibleToAnalyst: false; // always, enforced at the type level, not just a default value
}
```

**Invariant — hidden by construction:** `visibleToAnalyst` is typed as the literal `false`, not `boolean`, so a future code change that accidentally flips it produces a compile error, not a silent runtime leak. This mirrors the Phase 1.2 RLS design principle at the application layer too — defense in depth, not redundant caution.
**Open gap:** the notebook never computes `confidenceLabel` for shadow trades. Flagged in Section 12; do not invent a formula for this during implementation.

### 3.12 AllocationService

**Maps to:** notebook cell 12, `allocate_coverage`. Contract and invariants as resolved in Section 1.7.

### 3.13 ReviewService (Phase 1.6 owns the coaching-text generation; 1.5 only needs the alignment-scoring contract it depends on)

**Maps to:** notebook cell 12, `build_post_trade_reviews`.

```typescript
interface AlignmentInput { actualTrade: ActualTrade; recommendation: RecommendationVersionOutput; }
interface AlignmentOutput {
  directionAlignment: 'Aligned' | 'Different';
  entryAlignment: 'High' | 'Low';
  alignmentScore: number; // 0, 1, or 2
}
```

**Invariant — the one place `historical_backfill` rows MUST be excluded** (contrast with 3.4/3.5 where they must be included): a backfill row produces **no** review record at all, not a low-weight one.

### 3.14 ValidationService

Cross-cutting; full contract in Section 10, not repeated here to avoid duplication.

---

### Persistence boundary (explicit, since every service above is intentionally I/O-free)

Exactly three things write to the database in this engine, and nothing else does:

1. **`EngineOrchestrationService`** (Phase 1.3, already built) — calls the pure services above in sequence per the dependency graph (Section 6), and is the only thing that calls persistence functions with their outputs.
2. **The existing Phase 1.4 SQL functions** (`upsert_market_state_daily`, etc.) — already built, already tested, reused here rather than duplicated.
3. **New SQL functions this phase needs**, listed in Section 11 — following the exact same pattern as Phase 1.4's `upsert_*`/`record_*` functions.

This separation is what makes Section 8's unit-test strategy possible: every service in 3.1-3.13 can be tested with plain objects in, plain objects out, zero database, zero mocking framework needed.

---

## 4. Domain Models

Domain models are the live database tables already built in Phase 1.1, plus the in-memory-only shapes services 3.1-3.13 pass between each other before persistence. Rather than re-document 44 tables, this section lists only what's new or materially clarified for Phase 1.5.

### 4.1 Tables already correctly shaped for this phase (no changes needed)

`opportunities`, `recommendation_versions`, `coaching_recommendations`, `shadow_trades`, `shadow_trade_outcomes`, `coverage_allocation`, `allocation_decision_log`, `market_regime_state`, `market_event_risk`, `template_profiles`, `analyst_profiles`, `trigger_probability_profiles`.

### 4.2 Schema change required: `actual_trades.entry_zone` + `entry_zone_source`

Per Section 1.5, amended per Section 1.5's Amendment 2 resolution. Two new nullable columns, not one:

```sql
alter table actual_trades add column entry_zone atr_zone;
alter table actual_trades add column entry_zone_source text check (entry_zone_source in ('LIVE_COMPUTED', 'HISTORICAL_RECONSTRUCTED'));
```

`entry_zone_source` is `NULL` whenever `entry_zone` is `NULL` (no zone, no provenance to record). New `INCREMENTAL` ingestion populates both fields together — `entry_zone` from `market_state_daily`/`market_state_intraday` at `published_at`, `entry_zone_source = 'LIVE_COMPUTED'`. The historical reconstruction pilot (Section 11, Step 2a), if it proceeds past the pilot stage, populates both for whatever subset of backfilled rows the pilot's Finnhub-coverage investigation finds reconstructable, with `entry_zone_source = 'HISTORICAL_RECONSTRUCTED'`. Migration belongs in Phase 1.5's migration set (`028_actual_trades_entry_zone.sql`), not retroactively rewriting Phase 1.4's history.

`TemplateService`/`AnalystProfileService` (Sections 3.4, 3.5) must read `entry_zone_source` and treat `HISTORICAL_RECONSTRUCTED` rows as lower-confidence inputs to `templateQuality`/`profileQuality` than `LIVE_COMPUTED` rows of the same trade count — the exact weighting scheme is not specified here (it has no notebook precedent, since the notebook never distinguishes provenance) and is listed as an open question in Section 12.

### 4.3 In-memory-only domain shapes (never persisted directly; assembled per-request from table reads)

```typescript
// Composed once per engine run, passed through the pipeline -- NOT a table
interface EngineParameters {
  atrPeriod: number; zoneCount: number;
  staleAtrThreshold: number; forceRecalcAtrThreshold: number;
  minimumRr: number; minTriggerSample: number; fallbackTriggerProbability: number;
  minTemplateTrades: number; minProfileTrades: number;
  highConfidenceMinTrades: number; mediumConfidenceMinTrades: number;
  forbiddenAnalystTerms: string[];
}
// Read from model_parameters at run start, snapshotted (hashed + stored verbatim
// on every recommendation_versions row this run produces), never re-read mid-run --
// a parameter change mid-run must not retroactively change in-flight recommendations.

interface HistoricalTradeForProfiling {
  date: string; market: string; analyst: string; direction: 'BUY'|'SELL';
  entry: number; stop: number; target: number; resultR: number | null;
  triggered: boolean; session: SessionType; historicalBackfill: boolean;
  entryZone: AtrZone | null; // see 4.2 -- frequently null
}
```

### 4.4 Field-naming reconciliation table (notebook field -> DB column, the canonical lookup every service implementation must reference)

| Notebook field | DB column / enum | Table |
|---|---|---|
| `market` | `market_id` (FK, not the symbol string) | various |
| `session` (`'Europe'` etc.) | `session` (`EUROPEAN` etc.) | `opportunities`, `actual_trades` |
| `current_zone`, `preferred_entry_zone`, `zone_at_generation` | same names, `atr_zone` enum values | `recommendation_versions` |
| `analyst` (code, e.g. `'TIV'`) | resolved via `analyst_external_codes` to `analyst_id` | `analysts` |
| `recommendation_validity_status` | same name | `recommendation_versions` |
| `assigned_analyst`, `eligible_analysts` | `assigned_analyst_id` / `eligible_analysts` (jsonb) | `coverage_allocation` |
| `coaching_recommendation_id` | `recommendation_id` | `coaching_recommendations` |

---

## 5. Event Flows Between Services

This is a request-scoped pipeline (triggered per market, per session, by the Phase 1.3 engine orchestrator), not a pub/sub event bus — there is no message broker in this architecture, and introducing one would be unjustified complexity given the engine runs on a fixed session schedule (Section 1.3's `session_configuration`), not in response to arbitrary external events.

```
EngineOrchestrationService (Phase 1.3, existing)
  triggers: europe_opportunity_generation / us_opportunity_generation / apac_opportunity_generation
  per market_id in session's market universe:

    1. MarketStateService.execute(ohlc, currentPrice, params)
         -> MarketStateOutput                                    [persist: market_state_daily/intraday]

    2. MarketRegimeService.execute(closeSeries)         -- runs in parallel with step 3 (no dependency)
         -> MarketRegimeOutput                                   [persist: market_regime_state]

    3. EconomicCalendarService.execute(events, now)     -- runs in parallel with step 2
         -> MarketEventRiskOutput[]                              [persist: market_event_risk]

    [fan-in: steps 2 and 3 must both complete before step 4 -- this is the exact
     fan-in pattern Phase 1.3's engine_run_step_dependencies table was built to
     express; see Section 6]

    4. OpportunityService.execute(marketState)
         -> { hasOpportunity: true, reason: null }   (v1: always true, Section 1.4)
                                                                   [persist: opportunities]

    5. TemplateService.buildProfiles(trades) + .selectBest(market, profiles)
         -> SelectBestTemplateOutput                              [persist: template_profiles]

    6. AnalystProfileService.buildProfiles(trades) + .selectBest(market, direction, zone, ...)
         -> SelectBestAnalystOutput                                [persist: analyst_profiles]

    7. EntryOptimizerService.execute(marketState, direction, zone, minimumRr)
         -> EntryOptimizerOutput                                   (no direct persistence --
                                                                     feeds into step 9)

    8. TriggerProbabilityService.execute(market, direction, zone, trades)
         -> TriggerProbabilityOutput                                (no direct persistence --
                                                                      feeds into step 9)

    9. ExpectedRService.execute(template, profile, trigger)
         -> ExpectedROutput                                         (no direct persistence --
                                                                      feeds into step 10)

   10. RecommendationService.execute(all of the above)
         -> RecommendationVersionOutput                            [persist: recommendation_versions]

   11. RecommendationLifecycleService.assessCondition(recommendation, currentMarketState)
         -> AssessConditionOutput
         (called both at generation time, inline within step 10's output, AND on a
          separate periodic schedule per Section 1.3's watchdog/validity-check job --
          see 5.1 below for the two distinct trigger paths)

   12. ShadowTradeService.createShadowTrade(recommendation)
         -> ShadowTradeOutput                                      [persist: shadow_trades,
                                                                      shadow_trade_outcomes]

   13. AllocationService.allocate(recommendations, analysts, availability)
         -> AllocationOutput                                        [persist: coverage_allocation,
                                                                      allocation_decision_log]
```

### 5.1 Two distinct triggers for `RecommendationLifecycleService`, not one

This matters and is easy to get wrong: condition assessment happens **twice**, for different reasons, on different schedules, and conflating them would break the audit trail.

- **At generation time** (step 11 above, inline): assesses the brand-new recommendation against the market state it was *just* generated from. In practice this should almost always yield `VALID` (the recommendation is fresh), but it's not skipped — a market that's already moved during the few seconds of pipeline execution should still be caught.
- **On the periodic validity-check job** (`europe_validity_check` / `us_validity_check` / `apac_validity_check`, already defined in `session_configuration`'s engine run cadence from Phase 1.3): re-runs `RecommendationLifecycleService.assessCondition` against **every currently-active** `recommendation_versions` row for that session, comparing each one's `priceAtGeneration`/`zoneAtGeneration` against fresh `MarketStateService` output. This is what actually produces `STALE_PRICE`/`ZONE_CHANGED`/`DO_NOT_USE_RECALCULATE` transitions in practice — the generation-time check rarely fires anything but `VALID`.

A transition from `VALID` to anything else, found by the periodic check, does **not** mutate the existing `recommendation_versions` row — Phase 1.1's versioning design means a new row is the correct response (or, for `DO_NOT_USE_RECALCULATE`, triggering `RecommendationService` again to produce version N+1, per the regeneration workflow already designed in Sheet 27 of the platform spec). `RecommendationLifecycleService` itself never decides whether to regenerate — it only assesses and reports; the orchestrator decides what to do with that assessment.

### 5.2 Future Event-Driven Evolution (Amendment 5)

Phase 1 deliberately uses a request-scoped, cron-triggered pipeline (Section 5), not an event bus — given the engine's actual cadence is a handful of fixed session windows per day (Phase 1.3's `session_configuration`), introducing message-broker infrastructure now would be complexity with no present payoff. Amendment 5 asks that service boundaries not foreclose a future move toward the chain it describes (economic event → recommendation stale → regenerated → notification → publication update → shadow lifecycle update → dashboard refresh), without requiring that evolution be built now.

**This architecture already supports that evolution, for a specific, checkable reason: every service in Section 3 is already shaped like an event handler, just invoked synchronously today.** Each one takes a typed input, produces a typed output, has no hidden state, and does not call any other service directly (the orchestrator calls them, per Section 5's pipeline) — which is exactly the shape a service needs to be wrapped in a message-queue consumer later, with no change to the service's own internals. Concretely, the migration path from today's architecture to Amendment 5's event-driven illustration would look like:

| Today (request-scoped) | Future (event-driven), same service, no internal change |
|---|---|
| `EngineOrchestrationService` calls `RecommendationLifecycleService.assessCondition()` on a fixed cron schedule | An `economic_calendar_events` insert/update publishes a domain event; a consumer calls the *same* `assessCondition()` function in response, instead of waiting for the next scheduled tick |
| Orchestrator decides synchronously whether to call `RecommendationService` again after a `DO_NOT_USE_RECALCULATE` result | The same decision becomes a queued message (`recommendation.regeneration_required`), consumed asynchronously by the same regeneration logic |
| `notifications` rows are inserted directly by Phase 1.3's existing functions (`record_import_error`, the watchdog, etc.) | The same insert becomes the result of consuming a `recommendation.regenerated` event, rather than a direct call in the same execution context |

**The one thing this architecture does *not* yet have, and would need before any of the above becomes real, is a place to decide "this market state change is significant enough to trigger an out-of-cycle re-check" rather than waiting for the next scheduled validity-check window.** That's a genuinely new piece of logic (a change-significance detector sitting on `MarketStateService`'s output), not a refactor of anything existing — and it's explicitly out of scope for Phase 1.5, listed here only so it's not forgotten as the actual gap between today's architecture and Amendment 5's illustration, rather than assuming the gap is "add a message queue" (which would be necessary but not sufficient).

---

## 6. Dependency Graph

```
MarketStateService ----------+
                              |--> RecommendationService --> RecommendationLifecycleService
MarketRegimeService ---------+         ^        ^                    |
                              |         |        |                    v
EconomicCalendarService -----+         |        |              ShadowTradeService
                                        |        |
TemplateService ------------------------+        |
                                                  |
AnalystProfileService ---------------------------+
         ^
         | (needs eligible analysts, which needs)
         |
   analyst_availability (table read, not a service)

EntryOptimizerService, TriggerProbabilityService, ExpectedRService
   each depend on: MarketStateService output + TemplateService/AnalystProfileService output
   feed into: RecommendationService
   (these three have NO dependency on each other -- can run in parallel)

AllocationService depends on: RecommendationService output (needs expectedR per
   recommendation) + AnalystProfileService output (needs eligible_analysts) +
   analyst_availability (table read)

ValidationService depends on: everything (it's the verification layer, Section 10)
```

**Fan-in points requiring `engine_run_step_dependencies` (Phase 1.3) with multiple REQUIRED predecessors, not a linear chain:**
1. `recommendation_generation` step requires `market_state`, `market_regime`, AND `event_risk_mapping` steps all complete (exactly the example already documented in the platform spec's Sheet 26, and the case `engine_run_step_dependencies` was specifically built to handle).
2. `shadow_generation` requires `recommendation_generation` complete (linear, single predecessor — no fan-in needed here).
3. `allocation` requires `recommendation_generation` AND a fresh `analyst_availability` read for the session date (the latter is a table read, not an engine step, so this is a single-predecessor dependency on `recommendation_generation` plus an inline data check, not a second DAG edge).

**No circular dependencies exist in this graph.** This is worth stating explicitly because `EntryOptimizerService`/`TriggerProbabilityService`/`ExpectedRService` might look like they should depend on each other (they all feed `RecommendationService`) — they do not depend on each other, only on the same two upstream outputs (`MarketStateService`, `TemplateService`/`AnalystProfileService`), which is why they can run concurrently within a single engine step rather than needing three separate DAG nodes.

---

## 7. Determinism Strategy

Per the build prompt's explicit requirement ("two identical inputs must always produce materially equivalent outputs"), every `recommendation_versions` row persists:

| Field | Source |
|---|---|
| `parameter_snapshot` (jsonb) | `EngineParameters`, verbatim, at run start |
| `parameter_snapshot_hash` | `sha256(JSON.stringify(sortedKeys(parameterSnapshot)))` -- exact notebook algorithm, `stable_hash()` cell 2 |
| `regime_tags`, `event_risk_status` | already columns on `recommendation_versions` (Phase 1.1) |
| Market/regime/calendar snapshot | NOT separately columned today -- see Section 12 open item; currently reconstructible only by re-querying `market_state_daily`/`market_regime_state`/`market_event_risk` for the exact `generated_at` timestamp, which is reconstruction, not snapshotting, and is a real gap if those tables get pruned/partitioned later (Sheet 32's partitioning guidance) |
| Engine version | NOT currently a column anywhere -- new requirement, Section 11 |
| Template/analyst profile version | `template_profiles.generated_at` / `analyst_profiles.generated_at` already exist as implicit versions; no explicit version number column exists today -- acceptable for v1 since profiles aren't currently designed to be regenerated and re-compared against old versions, but flagged for Section 12 if that changes |

**The hash must be computed identically to the notebook's `stable_hash()`** (`hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode('utf-8')).hexdigest()`) — a TypeScript implementation using a different JSON serialization order, different float-to-string formatting, or a different hash algorithm will produce a different hash for behaviourally identical input, which would make Section 10's equivalence checking falsely report drift. This is worth a dedicated unit test that feeds the exact same `PARAMETERS` object from the notebook into both implementations and asserts identical hash output, before any recommendation logic is tested at all.

---

## 8. Testing Strategy

Four layers, matching the build prompt's explicit list (unit, integration, regression, behavioural equivalence), each with a distinct purpose — collapsing them into fewer layers would lose the ability to localize a failure to "the formula is wrong" vs. "the formula is right but the database write is wrong" vs. "both are right individually but drifted from research."

### 8.1 Unit tests (per service, 3.1-3.13)

Every service in Section 3 is a pure function — test with plain fixed inputs, assert exact outputs, no database, no network, no test harness beyond the test runner itself. Given every service's invariants are stated explicitly above, each invariant becomes one or more test cases:

- `MarketStateService`: insufficient bars -> all-null output; band-collapse guard fires when `upperBand <= lowerBand`; each of the 6 zone boundaries (`Too Deep` through `Too High`) hit exactly at boundary values, not just comfortably inside a zone.
- `EconomicCalendarService`: each of the 4 risk-status outcomes (`EVENT_ACTIVE`, `HIGH_RISK`, `WATCH`, `NONE`) hit at the exact hour-boundary, not just comfortably inside a window (e.g. exactly `+3h` for `HIGH_RISK`/`EVENT_ACTIVE` boundary).
- `RecommendationLifecycleService`: all 4 precedence branches, including the case where multiple conditions are simultaneously true (zone changed AND large ATR move) to confirm precedence order, not just each condition in isolation.
- `ExpectedRService`: the zero-trades-on-both-sides fallback specifically, since it's the one branch most likely to be "simplified" away by an implementer who doesn't read the notebook closely.

This is, in effect, a TypeScript transliteration of the notebook's own cell-level logic — and that's intentional, not a shortcut. Section 10 layers a second, independent check (hash comparison against the actual notebook) on top of these unit tests; the unit tests alone only prove the TypeScript is internally consistent, not that it matches the research.

### 8.2 Integration tests (engine orchestration + persistence, per the pattern established in `005_engine_functions.sql`/`006_engine_tests.sql`)

Real database (staging), real `engine_runs`/`engine_run_steps` rows, real fan-in dependency resolution exercised exactly as the existing Phase 1.3 test suite does — feed a deliberately constructed `market_state_daily` + `actual_trades` fixture through the full pipeline (steps 1-13 in Section 5) and assert the resulting `recommendation_versions`/`shadow_trades`/`coverage_allocation` rows match hand-calculated expected values. This is the layer that would have caught Section 1.5's zone-naming mismatch or Section 1.2's enum-casing mismatch if they'd been introduced as bugs rather than caught during this architecture review — exactly the failure mode every `005`/`007`/`015` test suite in this project has been built to catch.

### 8.3 Regression tests (golden-output snapshots)

A fixed, version-controlled set of input fixtures (market states, historical trades, economic events) with their expected outputs frozen as golden files. Run on every change to any service in Section 3; any output diff requires an explicit, reviewed decision ("this is an intentional behaviour change, here's the research justification" or "this is a bug, fix it") before the golden file is updated. This is the layer that prevents silent drift over many small refactors — unit tests alone don't catch a change that's internally consistent with itself but has quietly drifted from the original formula over a dozen "small cleanups."

### 8.4 Behavioural equivalence tests — Section 10, not duplicated here.

---

## 9. Hidden Boundary Enforcement (cross-cutting, touches every layer)

Per the build prompt's explicit five-layer requirement (database, RLS, backend, API, frontend), restated specifically for what Phase 1.5 adds:

| Layer | Mechanism | Status |
|---|---|---|
| Database | `shadow_trades.visible_to_analyst` CHECK constraint forcing `false` | Already built, Phase 1.1 |
| RLS | No `ANALYST` policy exists on `shadow_trades`/`shadow_trade_outcomes`/`automation_readiness_metrics` | Already built, Phase 1.2, verified live |
| Backend (NEW, this phase) | `ShadowTradeOutput.visibleToAnalyst` typed as literal `false`; `ShadowTradeService` is never imported by any Context 5 (Coaching & Review) or Context 6 module — enforced by a lint rule / import-boundary check (e.g. ESLint's `no-restricted-imports` scoped per directory), not just convention | To build |
| API (NEW, this phase) | Any API route serving recommendation/coaching data to an analyst-facing client must select an explicit field allowlist, never `select *` from a join that could pull in `shadow_trades`/`automation_readiness_metrics` columns | To build — this is the layer most likely to leak data if built carelessly, since a careless `JOIN shadow_trades` in an analyst-facing query would not be caught by RLS if the query runs under `service_role` (which bypasses RLS by design, per Phase 1.2) |
| Frontend | Out of scope for 1.5 (Phase 1.7) | N/A yet |

**The API layer is the actual risk, not the database layer.** RLS already protects against a buggy analyst-authenticated query. It does *not* protect against a buggy `service_role`-authenticated backend route that joins shadow data into an analyst-facing response and serves it anyway — `service_role` bypasses RLS entirely, by design, for exactly the legitimate server-side writes this whole platform depends on. This means the hidden boundary's actual enforcement, for any code path running as `service_role` (which is most of this engine), is **code review and the field-allowlist discipline above, not RLS.** This should be stated this plainly in code review guidelines for Phase 1.6/1.7, not left implicit.

---

## 10. Behavioural Equivalence Strategy (Phase 1.5.6, `ValidationService`)

### 10.1 What "equivalence" actually means here, precisely

Per the build prompt: "Research Notebook Recommendation ~ Production Platform Recommendation... The implementation can differ. The behaviour should not." This needs a precise definition or it's unfalsifiable. **Equivalence is defined as: given the same `EngineParameters` snapshot and the same input data (market state, historical trades, economic events), the production pipeline's `RecommendationVersionOutput` and the notebook's `recommendations` DataFrame row for the same market/session must agree on every field in the mapping table (Section 4.4), to within floating-point tolerance (`1e-9` relative) for numeric fields, and exactly for categorical/enum fields (after Section 1.1-1.3's naming translation is applied).**

### 10.2 New schema needed: `engine_validation_runs`

Not currently in the live schema. Required new table:

```sql
create table engine_validation_runs (
  validation_run_id        uuid primary key default gen_random_uuid(),
  recommendation_version_id uuid not null references recommendation_versions(recommendation_version_id),
  research_engine_version  text not null,   -- e.g. 'APIP_RESEARCH_ENGINE_V1_0'
  production_engine_version text not null,  -- git commit hash or semver of the deployed service code
  parameter_snapshot_hash  text not null,
  recommendation_hash      text not null,   -- hash of the production output, same stable_hash algorithm
  research_recommendation_hash text,        -- hash of the notebook's equivalent output, when available
  equivalence_status       text not null,   -- 'MATCH' | 'DRIFT_DETECTED' | 'NOT_COMPARABLE'
  drift_detail             jsonb,           -- field-by-field diff when status = DRIFT_DETECTED
  validated_at             timestamptz not null default now()
);
```

This is new, not retrofitted onto `recommendation_versions` — equivalence checking is a verification activity that happens *after* a recommendation is generated and persisted, potentially repeatedly (e.g. re-validated after a notebook update), and conflating it with the recommendation's own row would violate the same single-responsibility principle Section 3's persistence-boundary design is built on.

### 10.3 How comparison actually runs, practically

The notebook is a Jupyter notebook, not a deployed service — there is no live "research engine API" to call at request time. Equivalence checking is therefore necessarily a **batch, offline process**, not an inline check on every production recommendation:

1. Export a fixed set of input fixtures (the same `historical_trades`/`ohlc_data`/`current_prices`/`economic_events` CSVs the notebook's own `EXPORT_DIR` mechanism already produces, cell 13) — these become the shared input contract between notebook and production.
2. Run the notebook against those fixtures, capture its `recommendations` DataFrame, hash each row per Section 7.
3. Run the production pipeline against the *identical* fixtures (not live data — this must be deterministic, so it needs the same frozen inputs), capture its output, hash each row identically.
4. Compare hash-for-hash. Any mismatch triggers field-by-field diffing (not just "they differ") so a human can see exactly which field drifted and judge whether it's a real bug or an intentional, justified divergence.
5. Record the result in `engine_validation_runs` regardless of outcome — a `MATCH` result is itself valuable evidence, not just a failure log.

**This needs to run on every change to any Section 3 service**, ideally as a CI gate before merge, not as a manual occasional audit — the whole point of building this layer is to catch drift automatically, the same way the RLS test suite catches policy regressions automatically.

### 10.4 What this strategy deliberately does NOT attempt

It does not attempt to validate the notebook's `generate_sample_data()` synthetic-data path — that function exists for the notebook to run standalone without real data, and production never needs it. Equivalence fixtures must come from de-identified real data slices (e.g. one month, two markets, a handful of analysts) frozen as CSVs, mirroring the notebook's actual production-data-shaped contract (cell 4), not its synthetic fallback.

### 10.5 Behavioural Difference Engine (Amendment 3 — extends `ValidationService` beyond MATCH/DRIFT)

A bare `MATCH`/`DRIFT_DETECTED` status is correct but not useful on its own — it tells you *that* something differs, not whether the difference matters. Per Amendment 3, every `DRIFT_DETECTED` result must be accompanied by a structured explanation, not just a hash mismatch.

**Extended `engine_validation_runs.drift_detail` shape:**

```typescript
interface FieldDifference {
  field: string;                    // e.g. 'entryRangeLow', 'triggerProbability'
  researchValue: unknown;
  productionValue: unknown;
  delta: number | string;           // numeric difference, or a qualitative description for non-numeric fields
  deltaUnit: 'absolute' | 'atr_multiple' | 'percentage' | 'categorical';
  reason: DriftReason;
  severity: DriftSeverity;
}

type DriftReason =
  | 'FLOATING_POINT_ROUNDING'        // delta within numeric tolerance band, flagged anyway for transparency
  | 'INPUT_DATA_DIFFERENCE'          // the two runs were not actually given identical input data
  | 'PARAMETER_SNAPSHOT_MISMATCH'    // parameter_snapshot_hash differs between the two runs
  | 'ENUM_MAPPING_ERROR'             // a Section 1.2/1.3-style naming mismatch slipped through
  | 'LOGIC_DIVERGENCE'               // the formulas themselves disagree -- the serious case
  | 'UNCLASSIFIED';                  // could not be automatically attributed -- always escalate, never silently accept

type DriftSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface BehaviouralDifferenceReport {
  validationRunId: string;
  overallStatus: 'MATCH' | 'DRIFT_DETECTED';
  differences: FieldDifference[];    // empty array when overallStatus = 'MATCH'
  highestSeverity: DriftSeverity | null;
}
```

**Severity assignment is itself a piece of logic that needs explicit, documented rules — not a judgment call made ad hoc per report:**

| Severity | Criteria |
|---|---|
| `LOW` | Numeric field, delta within 2x the floating-point tolerance band (Section 10.1's `1e-9` relative), reason is `FLOATING_POINT_ROUNDING` |
| `MEDIUM` | Numeric field, delta exceeds tolerance but is small relative to the field's typical magnitude (e.g. `triggerProbability` differs by 1-5 percentage points), OR a categorical field differs but both values are "adjacent" in a meaningful sense (e.g. `STALE_PRICE` vs `VALID` at a near-boundary ATR move) |
| `HIGH` | A categorical field differs with no adjacency justification (e.g. `BUY` vs `SELL` direction, or `ZONE_CHANGED` vs `VALID`), or a numeric field differs by more than the `MEDIUM` band |
| `CRITICAL` | `recommendationValidityStatus` differs in a way that would change whether an analyst sees `DO_NOT_USE_RECALCULATE` vs anything else, or `assignedAnalyst`/`direction` differs (these affect what an analyst actually does, not just the precision of a number) |

**Worked example, matching Amendment 3's own illustration:**

```json
{
  "validationRunId": "...",
  "overallStatus": "DRIFT_DETECTED",
  "differences": [
    { "field": "entryRangeLow", "researchValue": 1.08412, "productionValue": 1.08420,
      "delta": 0.08, "deltaUnit": "atr_multiple", "reason": "FLOATING_POINT_ROUNDING", "severity": "LOW" },
    { "field": "triggerProbability", "researchValue": 0.62, "productionValue": 0.59,
      "delta": -0.03, "deltaUnit": "percentage", "reason": "UNCLASSIFIED", "severity": "MEDIUM" }
  ],
  "highestSeverity": "MEDIUM"
}
```

(`target` and `expectedR`'s "no difference"/"+0.04" entries from Amendment 3's example are omitted here only because a `FieldDifference` with `delta === 0` doesn't need to appear in the array at all — `differences` should only ever list fields that actually differ, so the report stays readable as drift surface area grows, rather than listing every field every time including the ones that matched.)

**Automatic reason classification is a heuristic, not a guarantee — `UNCLASSIFIED` must be a real, visible category, not a bucket that quietly gets reclassified as `LOGIC_DIVERGENCE` by default.** A human reviewing a `MEDIUM`/`HIGH`/`CRITICAL` drift report makes the final call on whether it's an acceptable variance or a real bug; the engine's job is to make that review fast and well-informed, not to make the decision for them.

### 10.6 The Research Notebook as a Permanent, First-Class Architectural Citizen (Amendment 4)

This is a standing engineering principle, not a one-time migration exercise, and should be treated with the same permanence as Phase 1.2's RLS test suite or Phase 1.3's engine test suite — i.e., it runs continuously, not once at the start of the project.

1. **The notebook is version-controlled alongside the production codebase**, not stored separately as a reference document. `APIP_RESEARCH_ENGINE_V1_0.ipynb` (or its successor versions) lives in the same repository, and its version string (`research_engine_version` in `engine_validation_runs`, Section 10.2) is a real, tracked value — not a constant frozen at "V1.0" forever regardless of whether the notebook itself ever changes.
2. **Any change to validated research methodology — a new threshold, a new formula, a new fallback rule — happens in the notebook first**, gets re-validated against historical data there, and only then propagates to the corresponding Section 3 service as an explicit, reviewed change (with its own entry in this document's amendment log, per the versioning discipline this document itself now follows). Production code is never the place a methodology change originates.
3. **The equivalence-fixture set (Section 10.3) is a living asset, refreshed periodically**, not a one-off export frozen at notebook-authoring time. As real production data accumulates (more markets, more analysts, more sessions), the fixture set should be periodically refreshed to cover that growing surface area — otherwise equivalence testing silently narrows in coverage relative to what production actually handles, even though the test suite itself never changes or fails.
4. **A research methodology change and a production bug fix are different categories of event and must be distinguishable in `engine_validation_runs` history** — a `DRIFT_DETECTED` result that's resolved by updating the notebook (a methodology change) should look different in the audit trail from one resolved by fixing a production bug (a behavioural-equivalence violation that needed correcting on the production side). This is a reporting/tagging requirement on top of the schema in Section 10.2, not a new table — `engine_validation_runs` needs a `resolution_type` column (`'NOTEBOOK_UPDATED'` | `'PRODUCTION_BUG_FIXED'` | `'ACCEPTED_AS_INTENTIONAL_VARIANCE'` | `null` while unresolved), populated by whoever reviews a drift report.

---

## 11. Implementation Roadmap, Phases 1.5.1-1.5.6



Ordered by the dependency graph (Section 6), not by the build prompt's numbering, since 1.5.1 ("Opportunity Engine") as literally scoped is nearly trivial per Section 1.4's resolution and shouldn't gate the more substantial work behind it.

| Step | Deliverable | Depends on | New migrations needed |
|---|---|---|---|
| 1 | `MarketStateService`, `MarketRegimeService`, `EconomicCalendarService` (Context 1, fully independent of everything else) | Phase 1.4 ingestion (already live) | None — `market_state_daily`, `market_regime_state`, `market_event_risk` already exist |
| 2 | `028_actual_trades_entry_zone.sql` (Section 4.2) + backfill logic for INCREMENTAL-ingested rows going forward | Step 1 (needs `MarketStateService` to derive zone at import time) | `028_actual_trades_entry_zone.sql` |
| 2a | **Historical Entry Zone Reconstruction pilot** (Amendment 2, Section 1.5): Finnhub symbol-mapping + historical-depth investigation for the 10-15 highest-volume markets only; not a commitment to reconstruct all ~74,000 historical records. Produces a coverage report, not assumed-complete data. | Step 1 (reuses `MarketStateService`'s formula against historical OHLC) | None for the pilot itself; a follow-up migration only if the pilot succeeds and reconstruction proceeds at scale |
| 3 | `TemplateService`, `AnalystProfileService`, including `entry_zone_source`-aware quality weighting (Section 4.2) | Step 2, informed by Step 2a's findings | New `upsert_template_profile`/`upsert_analyst_profile` SQL functions, same pattern as Phase 1.4 |
| 4 | `EntryOptimizerService`, `TriggerProbabilityService`, `ExpectedRService` (can build in parallel — no interdependency, per Section 6) | Steps 1, 3 | None |
| 5 | `OpportunityService` (documented extension point per Amendment 1, trivial logic for v1) + `RecommendationService` | Steps 1-4 | New `insert_opportunity`/`insert_recommendation_version` SQL functions |
| 6 | `RecommendationLifecycleService` + the periodic validity-check engine step (Section 5.1), with the implemented/reserved state guard from Amendment 7 | Step 5 | None — reuses existing `recommendation_versions` versioning |
| 7 | `ShadowTradeService` creation logic | Step 5 | New `insert_shadow_trade` SQL function |
| 7a | **Shadow Outcome Lifecycle** (Amendment 8 — promoted from open ambiguity to a defined work item): the logic that evolves a shadow trade from `NOT_TRIGGERED` through `TRIGGERED`/`TARGET_HIT`/`STOP_HIT`/`EXPIRY` as the market actually moves, modeled on `RecommendationLifecycleService`'s periodic re-assessment pattern (Section 5.1) but applied against shadow entry/stop/target instead of recommendation ranges. Does not need to complete before Step 5/9, per Amendment 8, but is no longer deferrable to an undefined future phase. | Step 7, `MarketStateService` (Step 1) for fresh price checks | New `update_shadow_trade_outcome` SQL function, plus a periodic engine step (`shadow_outcome_check`) alongside the existing validity-check cadence |
| 8 | `AllocationService` | Steps 5, 6 | None — `coverage_allocation`/`allocation_decision_log` already exist |
| 9 | `engine_validation_runs` schema (extended per Amendment 3's `drift_detail`/`resolution_type` fields) + `ValidationService` + Behavioural Difference Engine + the fixture-freezing process (Section 10.3) | Steps 1-8 all functional | `029_engine_validation_runs.sql` |

**Recommended sequencing for actual sprints:** Steps 1-2 first and alone — this closes the entry-zone gap (Section 1.5) that's been silently degrading template quality since Phase 1.4, and is valuable even before any recommendation logic exists. Step 2a runs alongside or immediately after Step 2, since it's an investigation, not a blocking dependency for Step 3 (Step 3 can proceed with `NULL`/`LIVE_COMPUTED`-only zones while 2a's findings are still being evaluated). Steps 3-5 next, as the first point where an actual end-to-end recommendation can be produced and manually sanity-checked against the notebook by eye (before Step 9's automated equivalence checking exists). Steps 6-7a round out the lifecycle — note 7a is explicitly *not* gating Step 9, per Amendment 8's "does not need to be completed before Recommendation Generation" guidance. Step 9 last, deliberately — it needs steps 1-8 to be stable enough that equivalence checking isn't just chasing a moving target.

---

## 12. Remaining Open Ambiguities (not resolved by this document — need a decision before or during implementation)

1. ~~Zone-conditioning for `NULL`-zone historical trades~~ — **RESOLVED in V1.2.** Per the corrected Section 3.4: pooled into their own group, never excluded; if that group wins selection, the output zone defaults to `ZONE_1` rather than propagating null. Confirmed against the actual notebook source during Step 3 implementation, not assumed.
2. **`shadow_trades.confidence_label` derivation** (Section 3.11): no notebook formula exists. Needs either a research-validated formula or an explicit decision to leave it `NULL`/a fixed default until one exists.
3. **Shadow trade outcome evolution — design is still open even though the work item is now scheduled** (Amendment 8, Section 11 Step 7a): promoting this to the roadmap does not answer the actual design question — the exact re-evaluation logic (what counts as the shadow trade hitting its target vs. stop, using intraday vs. daily price checks, how `EXPIRY` is determined) still has zero validated research behind it and needs its own design pass before Step 7a can be implemented, not just scheduled.
4. **`entry_zone_source` confidence weighting** (Section 4.2, added per Amendment 2): the exact discount `TemplateService`/`AnalystProfileService` should apply to `HISTORICAL_RECONSTRUCTED` rows relative to `LIVE_COMPUTED` rows of equal trade count has no notebook precedent and needs an explicit decision. Note this is now a real, present question, not a hypothetical one — Step 2a actually ran (15 markets, 10,263 trades reconstructed, all marked `HISTORICAL_RECONSTRUCTED`), so `TemplateService`/`AnalystProfileService` are right now blending two confidence tiers without distinguishing them, until this is decided.
5. **`CURRENCY_MARKET_MAP`** (Section 3.3): the notebook's 4-currency, 6-market hardcoded sample table needs a real production equivalent. This likely needs a new concept — `markets.currency_exposure` or a join table — that doesn't exist in the schema today. Scoping this properly is its own small piece of design work, not a one-line fix.
6. **`market_state_intraday` vs. `market_state_daily` as `MarketStateService`'s real-time input**: the notebook only ever computes ATR/zones from daily OHLC (cell 6 reads `ohlc_data`, daily bars). The platform spec's `market_state_intraday` table exists for session-aware *intraday* re-checks (the validity-check job, Section 5.1) — but the notebook gives no validated formula for how `currentZone` should be recomputed intraday using `market_state_intraday.current_price` against *yesterday's* ATR14 rather than a fresh intraday ATR calculation. The notebook's `calculate_atr_zones` function does take a separate `current_price` parameter distinct from the OHLC `close` it was fit on (this is exactly how intraday re-checks are meant to work — daily ATR, live price), so this is **likely already resolved** by reading the function signature carefully — flagged here mainly so the implementer doesn't second-guess it and invent a different intraday ATR recalculation.
7. **Engine version / production engine version values** (Section 10.2): needs a concrete versioning scheme decided before `ValidationService` can be built — git commit SHA, semver tag, or something else. Small decision, but blocks Step 9 of the roadmap until made.
8. **Parameter snapshot's relationship to `model_parameters`**: Phase 1.1's `model_parameters` table already supports `effective_from`/`effective_to` versioning. This phase's `EngineParameters` (Section 4.3) needs to read from that table rather than a hardcoded object (the notebook's `PARAMETERS` dict is appropriate for a notebook, not for production, where these values should be admin-configurable per the platform spec's stated design intent). The read-and-snapshot logic itself is straightforward; flagged here only to confirm this is the intended source of truth rather than a new hardcoded production constant.

---

## 13. Companion Document

Per Amendment 6, the platform's ubiquitous language is defined in a separate companion document, **`APIP_DOMAIN_LANGUAGE_V1.md`**, rather than inline here — domain language is referenced by, and needs to remain stable across, more of the platform than just this engine (Phase 1.6 coaching, Phase 1.7 dashboards, and all platform documentation going forward), so it is versioned independently rather than bound to this document's amendment cycle. Both documents should be read together; this document assumes the definitions in the companion document and does not redefine them.

---

*End of APIP Intelligence Engine Architecture V1.1 — frozen baseline. This document, not the notebook directly, is the contract implementation must satisfy. Future architectural changes are proposed as versioned amendments against this baseline (V1.2, V1.3, ...), never as direct edits to this file.*
