# APIP Domain Language V1.1

**Status:** Companion to `APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.2.md`. Read together; this document defines the terms that document assumes.
**Changelog from V1.0:** No definitions changed. Citations updated to reference `APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.2.md` (the architecture document's correction amendment — see that document's own changelog) rather than the now-superseded V1.1. None of this document's existing citations pointed at the sections that were actually corrected, so this is a version-label update only, not a content change.
**Purpose:** One precise definition per core concept, used consistently across the platform's code, documentation, database schema, and conversation with stakeholders. Where a term has historically been used loosely or inconsistently across the spec, the notebook, and the live schema (several are flagged below), this document states the canonical definition going forward and notes the discrepancy, rather than silently picking one without explanation.

**How this document is maintained:** Like the architecture baseline it accompanies, this is a versioned document. A term's definition does not change by editing this file directly — it changes by a proposed amendment, reviewed the same way an architecture amendment is reviewed, because changing what a word means here can silently invalidate reasoning written against the old definition elsewhere in the codebase or in conversation.

---

## Core entities

### Opportunity
A specific market, on a specific date, in a specific session, that the platform has assessed as eligible to receive a recommendation. **As of V1.2 of the architecture, every market assessed produces an Opportunity** — there is no current rejection path (see `APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.2.md` Section 1.4 / Amendment 1). An Opportunity is not itself a trade idea — it is the *occasion* for one. The Recommendation is the trade idea; the Opportunity is the slot it occupies. One Opportunity can have many Recommendation Versions over its lifetime (as conditions change and the recommendation is regenerated), but only one Opportunity per (market, date, session).

### Recommendation
The coaching guidance shown to an analyst for a given Opportunity: a suggested entry range, risk range, target range, trigger probability, and expected R, accompanied by a coaching note. "Recommendation" without qualification refers to the *current, active* guidance an analyst sees — when precision matters (e.g. in code, in audit trails), use **Recommendation Version** instead, since the underlying record is always a specific version.

### Recommendation Version
A specific, immutable, timestamped instance of a Recommendation, tied to the exact market/regime/calendar conditions and parameter snapshot at the moment it was generated. An Opportunity's Recommendation evolves over time by creating new Recommendation Versions, never by editing an existing one — this is what makes post-trade review against "the exact recommendation shown at the time" possible. A Recommendation Version's validity is assessed continuously (see **Recommendation Validity**) but its own content (entry/stop/target/etc.) never changes after creation; a changed assessment produces a new version, not a mutation.

### Coaching Recommendation
The specific, analyst-facing projection of a Recommendation Version: the subset of fields an analyst is permitted to see (entry/stop/target ranges, trigger probability, expected R, event risk warnings, coaching note), explicitly excluding everything in the Hidden Boundary (shadow trades, confidence labels, automation readiness). "Recommendation Version" and "Coaching Recommendation" are not synonyms — a Coaching Recommendation is a *view* of a Recommendation Version, with confidential fields removed, never the other way around.

### Recommendation Validity
The current assessment of whether a Recommendation Version's guidance still reflects real market conditions. Takes one of four values in V1.2's implemented behaviour — `VALID`, `ZONE_CHANGED`, `STALE_PRICE`, `DO_NOT_USE_RECALCULATE` — assessed by comparing live market conditions against the conditions recorded at the Recommendation Version's generation. Four further values exist in the database schema (`CAUTION_VOLATILITY`, `ENTRY_ALREADY_PASSED`, `RECALCULATING`, `ARCHIVED`) as **reserved schema capability** — they are not currently produced by any implemented logic and should not be assumed reachable (see Architecture V1.2 Section 1.1 / Amendment 7). Recommendation Validity is reassessed periodically, not only at generation time (Architecture V1.2 Section 5.1).

### Market State
The computed technical snapshot of a market at a point in time: its ATR(14), the resulting zone bands, and which zone the current price falls into. Market State is the foundational input nearly everything else in the Intelligence Engine derives from — Opportunity assessment, Recommendation generation, and Recommendation Validity re-assessment all read from Market State, directly or indirectly. Market State does not include trend or volatility classification — that is **Market Regime**, a related but distinct concept.

### Market Regime
The classification of a market's directional and volatility character over a recent window: Trend State (`TRENDING_UP` / `TRENDING_DOWN` / `RANGE`) and Volatility State (`LOW_VOL` / `NORMAL_VOL` / `HIGH_VOL` / `UNKNOWN`), accompanied by a Regime Confidence (`LOW` or `MEDIUM` only, in implemented behaviour — `HIGH` is schema-reserved, not produced; see Architecture V1.2 Section 3.2). Market Regime is descriptive context attached to a Recommendation, not currently a factor that gates whether a Recommendation is generated at all (see **Opportunity**'s extension-point note).

### Template Profile
A historical performance summary, grouped by (market, direction, entry zone), built from all available historical trades for that combination — including Historical Backfill trades (see below), since this is raw outcome profiling, not alignment review. Used to select the best-performing (direction, entry zone) combination for a given market when generating a new Recommendation. Distinct from **Analyst Profile**, which performs the same grouping but additionally segments by individual analyst.

### Analyst Profile
The same historical-performance-summary concept as Template Profile, additionally grouped by analyst. Used to select which eligible analyst has the strongest historical track record for a given (market, direction, entry zone), and to assign that analyst to a new Recommendation. "Profile" without qualification is ambiguous between this and Template Profile — always specify which.

### Trigger Probability
The estimated likelihood that a given (market, direction, zone) Recommendation will actually be triggered (i.e., price will reach the suggested entry range) based on historical frequency. Computed via a three-tier fallback (exact history -> market-zone history -> a fixed fallback value) — see Architecture V1.2 Section 3.7 for the exact cascade, which must not be reordered or have its sample-size thresholds changed without research re-validation.

### Expected R
The probability-weighted estimate of a Recommendation's risk-adjusted return: the historical average R-multiple of the selected Template/Analyst Profile combination, multiplied by Trigger Probability. Expected R is shown to analysts as coaching context; it is not a guarantee and is explicitly distinct from **RR** (see below), which is a constructed property of the entry/stop/target geometry, not a probabilistic estimate.

### RR (Risk-Reward Ratio)
The ratio between a Recommendation's target distance and stop distance from the entry midpoint. In V1.2's implemented formula, **RR is constructed to always equal the platform's configured minimum (2.0) by design** — it is not an independently varying measurement of a Recommendation's quality, and must never be treated as one in coaching language or downstream logic (Architecture V1.2 Section 3.6).

### Coverage Allocation
The assignment of a specific analyst to cover a specific Opportunity for a session, based on a score combining (in V1.2) Expected R, profile-based preference, and analyst workload — with Market Fit Score and Regime Fit Score present in the schema but contributing `0` in V1.2 (reserved for future scoring richness, not currently meaningful; see Architecture V1.2 Section 1.7).

### Shadow Trade
A hidden, internally-generated benchmark trade created alongside every Recommendation Version, using the exact same entry/stop/target/probability/expected-R as the analyst-facing Coaching Recommendation. **A Shadow Trade is never shown to any analyst under any circumstance** — this is the platform's core trust boundary (see **Hidden Boundary**). Its purpose is exclusively internal: measuring, over time, whether the platform's own recommendation logic would have performed differently from how analysts actually traded, as input to Automation Readiness assessment. A Shadow Trade's *creation* (entry/stop/target at the moment of generation) is immutable; its *outcome* (whether it triggered, hit target, hit stop, or expired) evolves over time via a separate lifecycle (Architecture V1.2 Section 11, Step 7a).

### Automation Readiness
An internal-only metric assessing how closely a Shadow Trade's outcomes track or exceed actual analyst outcomes for comparable Opportunities, over time — used to inform (eventually) which parts of the analyst workflow might be candidates for increased automation. Automation Readiness is never shown to analysts, and per the platform's stated coaching philosophy, framing this metric to analysts in any form (even indirectly, e.g. "the model would have done better here") is explicitly prohibited coaching language.

### Coaching Note
The plain-language, analyst-facing text accompanying a Coaching Recommendation, generated to support — never instruct or judge — the analyst's own decision. Must never reference Shadow Trades, automation comparisons, or use any term on the platform's forbidden-terms list (`'shadow trade'`, `'model beat you'`, `'non-compliant'`, `'wrong'`, `'failure'`, `'low confidence'`). Coaching Notes are linted against this list before being shown.

### Review (Post-Trade Review)
An assessment comparing an analyst's Actual Trade against the Recommendation Version that was active at the time the trade was made, producing a Direction Alignment and Entry Alignment score. **Historical Backfill trades are explicitly excluded from Review** — a backfill trade produces no Review record at all, since the platform did not exist when that trade occurred and there is no honest recommendation to compare it against (contrast with Template/Analyst Profiles, which *do* include backfill trades, since profiling and review serve different purposes — see Architecture V1.2 Section 3.13).

### Historical Backfill
A trade record imported from data that predates the platform's existence (the 30,825-row spreadsheet covering 2017-2026, or any future similarly-sourced import) — as opposed to a trade generated through the live platform's own recommendation flow. Historical Backfill trades carry `historical_backfill = true` and structurally cannot have an `opportunity_id`/`recommendation_version_id` (the platform did not generate a recommendation for them — any such link would be fabricated). Whether a Historical Backfill trade is *usable* for a given purpose depends on the purpose: usable for Template/Analyst Profiling (raw outcome data), not usable for Review (no real recommendation to compare against).

### Triggered Rate
The proportion of an analyst's published recommendations (per the live Acuity Performance feed, not the Historical Backfill — see Phase 1.4's `analyst_publications` table) that actually triggered, as opposed to expiring unfilled. Distinct from **Trigger Probability**, which is the platform's own *predictive estimate* for a not-yet-published Recommendation — Triggered Rate is a retrospective, measured outcome over actual published recommendations, not a forward-looking estimate.

---

## Process / lifecycle terms

### Session
One of the platform's three (four, including Crypto) fixed publication windows — `EUROPEAN`, `US`, `APAC` (plus `CRYPTO`, which runs continuously rather than on a fixed window) — within which Opportunities are generated and Recommendations published. Note: the research notebook refers to the first of these as `'Europe'`; the canonical, schema-authoritative spelling is `EUROPEAN` (Architecture V1.2 Section 1.3) — use `EUROPEAN` everywhere outside the notebook itself.

### Engine Run
A single execution of the orchestrated pipeline (Architecture V1.2 Section 5) for a given session and date, coordinated by the Phase 1.3 engine framework. Composed of multiple Engine Run Steps, some of which have fan-in dependencies on multiple predecessors (e.g. Recommendation generation depends on Market State, Market Regime, and Event Risk all completing first).

### Validity Check
The periodic (not generation-time-only) re-assessment of every currently-active Recommendation Version's Recommendation Validity, run on the same session cadence as Engine Runs. Distinct from the inline assessment performed once, immediately, at the moment a Recommendation Version is first generated (Architecture V1.2 Section 5.1 names both explicitly to prevent conflating them).

### Behavioural Equivalence
The property that, given identical inputs and an identical parameter snapshot, the production Intelligence Engine and the research notebook (the validated behavioural reference) produce materially identical outputs — assessed via hash comparison and, where drift is detected, a structured Behavioural Difference Report explaining the discrepancy's likely cause and severity (Architecture V1.2 Section 10). Behavioural Equivalence is an ongoing, continuously-checked engineering property, not a one-time migration verification (Architecture V1.2 Section 10.6 / Amendment 4).

### Parameter Snapshot
The complete, hashed record of every configurable engine parameter (ATR period, zone count, validity thresholds, minimum RR, trigger sample floors, etc.) in effect at the moment a specific Recommendation Version (or other engine output) was generated. Persisted verbatim on the output record, never re-derived later — this is what makes a past Recommendation Version's behaviour reproducible even after `model_parameters` has since changed.

---

## Hidden boundary terms (handle with particular care — these names appear in both code and conversation, and the distinction matters for trust)

### Hidden Boundary
The platform's core trust commitment: certain data (Shadow Trades, Automation Readiness metrics, internal confidence/model-reasoning fields) must never be visible to or inferable by any analyst, enforced redundantly at the database, RLS, backend, API, and (eventually) frontend layers (Architecture V1.2 Section 9). The Hidden Boundary is the single most safety-critical property in the entire platform — a failure here is categorically different in severity from a typical bug, since it undermines the coaching relationship the entire product is built on.

### Visible to Analyst
A boolean property (always `false` for Shadow Trades, enforced at the type level in code per Architecture V1.2 Section 3.11, not just as a default) distinguishing what an analyst-facing query is permitted to return. Not to be confused with whether a *field* is sensitive — some tables are entirely hidden (no analyst-facing view exists at all, e.g. `shadow_trades`), while others (e.g. `recommendation_versions`) have both a full internal shape and a restricted analyst-facing projection — "visible to analyst" properly describes the row/table-level property, while the analyst-facing *projection* of a partially-visible table is a separate mechanism (the Coaching Recommendation, defined above).

---

*End of APIP Domain Language V1.1. Companion to `APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.2.md`. Future term additions or redefinitions are proposed as versioned amendments, not direct edits.*
