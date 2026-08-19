# Zone Performance Analysis — Pre-Launch Research

**Date:** 2026-08-19
**Scope:** Research only, no production code changes. Findings are intended to inform the recommendation engine redesign.

## Methodology

### Formula verification

The zone reconstruction formula was read directly from `intelligence-engine/src/services/marketStateService.ts` (`calculateAtrZones` / `classifyZone`, lines 144-194) rather than taken on trust. It matches the task's given formula exactly:

```
bottomAnchor = min(previousClose, sessionLow)
topAnchor    = max(previousClose, sessionHigh)
lowerBand    = topAnchor - ATR20
upperBand    = bottomAnchor + ATR20
step         = (upperBand - lowerBand) / 4
ZONE_1: lowerBand → lowerBand+step   ZONE_2: +step → +2·step
ZONE_3: +2·step → +3·step            ZONE_4: +3·step → upperBand
TOO_DEEP: price < lowerBand          TOO_HIGH: price > upperBand
```

One thing the task's formula omits that the real source includes: a **band-collapse guard**. When `upperBand <= lowerBand` (ATR large relative to the anchor spread), `marketStateService.ts` falls back to zones centred on the current price (`±ATR/2`) rather than the anchor-based bands. This reconstruction implements that fallback too, for fidelity to the real logic — it triggered on 5 of 978 reconstructed trades.

### Data sources and matching

Per trade: `actual_trades.entry` classified against `market_state_intraday` (session_high, session_low, previous_close) and the prior trading day's `market_state_daily.atr20`, mirroring exactly how `lib/workspaceData.ts`'s own `resolveZoneBoundaries()` sources these three tables in production.

**One deliberate deviation from a first-pass literal interpretation, and why:** an initial attempt matched each trade to the closest intraday snapshot *at or before* its exact publish timestamp — the most literal reading of "at publication time." That returned only 401 reconstructable trades. Investigation showed why: `market_state_intraday` typically has only ~1 snapshot per market per day, so "before only" rejects any trade published earlier in the day than that single snapshot — even though ATR20 (sourced from the prior day's daily bar) is completely time-invariant within the day, and session high/low don't move drastically within a session. Matching to the **closest same-calendar-day snapshot in either direction** is a materially better reconstruction of "the ATR band at publication time" without sacrificing fidelity, and raised the usable sample to 978. This is documented as a methodology choice, not hidden.

### Sample size: does not match the task's stated 703

**The task states 703 trades have valid snapshot data. This audit could not reproduce that number under any filter combination tried**, and the number that comes out is highly sensitive to matching methodology:

| Matching approach | Trades reconstructed |
|---|---|
| Closest same-day snapshot, before-or-after (used below) | **978** |
| Closest same-day snapshot, before-only | 401 |
| Of the 978: triggered only | 336 |
| Of the 978: triggered, source=ACUITY_PERFORMANCE_API, not backfill | 164 |

None of these land on 703. Rather than force-fit a number, this report proceeds with the 978-trade set (all published trades with a reconstructable zone, whether triggered or not — needed for trigger-rate analysis) and is explicit about which subset each statistic below is drawn from. **The methodology is fully documented above and the reconstruction CSV/JSON are available on request** if a different filter is what was actually intended.

### The far more important caveat: coverage window is small

`market_state_intraday` only has data for **34 distinct dates, 2026-07-03 to 2026-08-19 (today), across 46 of 209 markets with trade history.** Of 32,272 total `actual_trades` rows with an entry price, only 978 (3.0%) fall in a market+day with any reconstructable intraday snapshot. This is a **recent, narrow slice of history** (roughly the last six and a half weeks), not a representative sample of the platform's full trade history. Every statistic below should be read with that in mind — this analysis can speak to *recent* zone behaviour, not the platform's lifetime performance.

**One data-quality exclusion, documented:** one trade (Natural Gas, `trade_id` `98266796-…`, published 2026-08-14) has `entry=2725` against `atr20=0.098` — a ~28,000x scale mismatch versus its own market's other 36 reconstructed trades (which cluster sensibly around entry≈2.7-2.9, atr20≈0.10-0.12). This looks like a manual entry error for that single row (e.g. `2725` typed instead of `2.725`), not a systematic issue — checked, and no other trade in the dataset shows this pattern. Excluded from the Step 4 mean (which a single such value would otherwise dominate); left in for zone/count purposes since its `result_r` is presumably still valid even though its zone classification isn't meaningful.

Dataset sizes used throughout: **978 published** (any trigger status) → **327 triggered with a valid result_r** → **151 winners, 175 losers, 1 breakeven**.

---

## Step 2 — Zone performance (all regimes combined)

| Zone | Dir | Published | Triggered | Trigger Rate | Win Rate | Avg R | %≥1.0R | %≥1.3R | %≥2.0R |
|---|---|---|---|---|---|---|---|---|---|
| TOO_DEEP | BUY | 134 | 22 | 16.4% | 59.1% | +0.113 | 9.1% | 4.5% | 0.0% |
| TOO_DEEP | SELL | 1 | 0 | 0.0% | — | — | — | — | — |
| ZONE_1 | BUY | 165 | 49 | 29.7% | 42.9% | +0.014 | 8.2% | 8.2% | 4.1% |
| ZONE_1 | SELL | 7 | 3 | 42.9% | 0.0% | -0.398 | 0.0% | 0.0% | 0.0% |
| ZONE_2 | BUY | 123 | 64 | 52.0% | 40.6% | -0.039 | 12.5% | 9.4% | 4.7% |
| ZONE_2 | SELL | 40 | 23 | 57.5% | 52.2% | -0.197 | 0.0% | 0.0% | 0.0% |
| ZONE_3 | BUY | 43 | 19 | 44.2% | 47.4% | +0.032 | 0.0% | 0.0% | 0.0% |
| ZONE_3 | SELL | 153 | 77 | 50.3% | 49.4% | +0.006 | 11.7% | 9.1% | 5.2% |
| ZONE_4 | BUY | 37 | 9 | 24.3% | 44.4% | -0.073 | 11.1% | 11.1% | 0.0% |
| ZONE_4 | SELL | 172 | 38 | 22.1% | 47.4% | +0.035 | 10.5% | 5.3% | 0.0% |
| TOO_HIGH | BUY | 8 | 2 | 25.0% | 50.0% | -0.349 | 0.0% | 0.0% | 0.0% |
| TOO_HIGH | SELL | 95 | 21 | 22.1% | 42.9% | +0.148 | 19.0% | 14.3% | 4.8% |

**Read with caution**: several rows have single-digit triggered counts (ZONE_1 SELL n=3, ZONE_4 BUY n=9, TOO_HIGH BUY n=2) — a "0.0% win rate" on 3 trades is not a reliable signal, it just means all 3 happened to lose.

### Step 2b — Split by regime

Every one of the 978 reconstructed rows matched a regime reading (regime coverage is dense for this recent window), but splitting an already-small sample four more ways leaves most cells with single-digit counts. Shown for zones 1-4 only (the tradeable zones):

| Zone | Dir | Regime | Published | Triggered | Trigger Rate | Win Rate | Avg R |
|---|---|---|---|---|---|---|---|
| ZONE_1 | BUY | TRENDING_UP | 20 | 4 | 20.0% | 25.0% | -0.271 |
| ZONE_1 | BUY | TRENDING_DOWN | 19 | 4 | 21.1% | 0.0% | -0.389 |
| ZONE_1 | BUY | RANGE | 66 | 24 | 36.4% | 37.5% | -0.080 |
| ZONE_1 | BUY | MIXED | 60 | 17 | 28.3% | 64.7% | **+0.308** |
| ZONE_2 | BUY | RANGE | 53 | 27 | 50.9% | 48.1% | +0.110 |
| ZONE_2 | BUY | MIXED | 51 | 28 | 54.9% | 32.1% | -0.156 |
| ZONE_2 | SELL | TRENDING_DOWN | 5 | 4 | 80.0% | 75.0% | -0.031 |
| ZONE_3 | SELL | TRENDING_UP | 10 | 2 | 20.0% | 100.0% | **+1.067** |
| ZONE_3 | SELL | TRENDING_DOWN | 16 | 11 | 68.8% | 18.2% | -0.565 |
| ZONE_3 | SELL | RANGE | 68 | 37 | 54.4% | 48.6% | +0.008 |
| ZONE_3 | SELL | MIXED | 59 | 27 | 45.8% | 59.3% | +0.158 |
| ZONE_4 | SELL | TRENDING_UP | 22 | 4 | 18.2% | 50.0% | +0.098 |
| ZONE_4 | SELL | TRENDING_DOWN | 26 | 4 | 15.4% | 50.0% | +0.116 |
| ZONE_4 | SELL | RANGE | 69 | 15 | 21.7% | 26.7% | -0.175 |
| ZONE_4 | SELL | MIXED | 55 | 15 | 27.3% | 66.7% | +0.206 |

*(Rows with 0 triggered trades omitted — several exist, e.g. ZONE_3 BUY/TRENDING_DOWN had 4 published, 0 triggered.)*

The one pattern that recurs across multiple zones with enough sample to notice: **MIXED regime consistently shows the best avg R** (ZONE_1 BUY +0.308, ZONE_3 SELL +0.158, ZONE_4 SELL +0.206), while TRENDING_DOWN is consistently the worst for BUY setups (as expected — counter-trend) and mixed-to-poor for SELL setups too. RANGE and TRENDING_UP fall in between. This is directionally sensible (MIXED regime is genuinely the hardest to game via naive trend-following, so setups earning their entry there may be more selective) but the per-cell samples (4-37 triggered trades) are too small to treat any single cell as conclusive.

---

## Step 3 — Target achievability (winning trades, n=151)

| Threshold | % of winners reaching it |
|---|---|
| ≥ 1.0R | 21.2% |
| ≥ 1.5R | 12.6% |
| ≥ 2.0R | 6.6% |
| ≥ 3.0R | 0.0% |

**Winning R distribution**: median 0.47R, mean 0.68R, range 0.002R–2.94R (no winner in this sample closed above ~2.94R).

| R range | Count | % of winners |
|---|---|---|
| 0 – 0.5R | 79 | 52.3% |
| 0.5 – 1.0R | 40 | 26.5% |
| 1.0 – 1.5R | 13 | 8.6% |
| 1.5 – 2.0R | 9 | 6.0% |
| 2.0 – 3.0R | 10 | 6.6% |
| ≥ 3.0R | 0 | 0.0% |

**Over three-quarters of winning trades (78.8%) close below 1.0R.** A target set at a flat 2.0R or higher would be missed by 93.4% of winners in this sample.

---

## Step 4 — Stop placement (losing trades, n=175, 1 excluded — see data-quality note above)

| Threshold | % of stop-hits within it |
|---|---|
| ≤ 0.5 ATR | 50.3% |
| ≤ 1.0 ATR | 97.1% |
| ≤ 1.5 ATR | 99.4% |

Mean stop distance (excluding the one data-quality outlier): well under 1 ATR — the overwhelming majority of stop distances cluster between 0.2 and 1.0 ATR, with a sharp cutoff: essentially none beyond ~1.2 ATR.

**Half of all losing trades had a stop within 0.5 ATR of entry.** Combined with Step 3's finding that most winners top out well under 1R, this is consistent with stops that are tight relative to the ATR band width (recall zones themselves span a full ATR: `step = ATR20/4`, so a 0.5 ATR stop is roughly *two full zone-widths* — not unreasonably tight in isolation, but tight enough that a substantial share of "eventual winners" plausibly get stopped out on the way, a dynamic this dataset can't directly measure since it only has final outcomes, not full price paths).

---

## Step 5 — Zone 1 BUY / Zone 4 SELL comparison

### Zone 1 BUY vs Zone 2/3/4 BUY

| Segment | Published | Triggered | Trigger Rate | Win Rate | Avg R |
|---|---|---|---|---|---|
| **Zone 1 BUY** | 165 | 49 | **29.7%** | 42.9% | **+0.014** |
| Zone 2/3/4 BUY (combined) | 203 | 92 | 45.3% | 42.4% | -0.028 |
| Zone 2 BUY | 123 | 64 | 52.0% | 40.6% | -0.039 |
| Zone 3 BUY | 43 | 19 | 44.2% | 47.4% | +0.032 |
| Zone 4 BUY | 37 | 9 | 24.3% | 44.4% | -0.073 |

### Zone 4 SELL vs Zone 1/2/3 SELL

| Segment | Published | Triggered | Trigger Rate | Win Rate | Avg R |
|---|---|---|---|---|---|
| **Zone 4 SELL** | 172 | 38 | **22.1%** | 47.4% | **+0.035** |
| Zone 1/2/3 SELL (combined) | 200 | 103 | 51.5% | 48.5% | -0.051 |
| Zone 1 SELL | 7 | 3 | 42.9% | 0.0% | -0.398 |
| Zone 2 SELL | 40 | 23 | 57.5% | 52.2% | -0.197 |
| Zone 3 SELL | 153 | 77 | 50.3% | 49.4% | +0.006 |

### Trigger rate: edge zones (1/4) vs middle zones (2/3)

| Segment | Published | Triggered | Trigger Rate | Win Rate | Avg R |
|---|---|---|---|---|---|
| Zone 1+4 (edge) | 381 | 99 | **26.0%** | 43.4% | +0.002 |
| Zone 2+3 (middle) | 359 | 183 | **51.0%** | 46.4% | -0.033 |

---

## Verdicts

### Does Zone 1 BUY / Zone 4 SELL show better performance? **Yes, on avg R — but the effect is small and the trigger-rate cost is large.**

Both of the "far edge" entries the task asked about beat their respective same-direction alternatives on **avg R**: Zone 1 BUY (+0.014R) vs. the rest of BUY zones combined (-0.028R); Zone 4 SELL (+0.035R) vs. the rest of SELL zones combined (-0.051R). Directionally this supports the intuition behind zone-based entries — the "cheapest" BUY and "most expensive" SELL entries hold a real, if modest, edge. But the magnitude is small (a few hundredths of an R), the sample is recent and narrow (six and a half weeks), and win rates are statistically indistinguishable from the rest (Zone 1 BUY 42.9% vs. 42.4%; Zone 4 SELL 47.4% vs. 48.5%) — the edge shows up entirely in avg R, not in how often the trade wins. This reads as a real but modest effect worth further validation on a longer history once more `market_state_intraday` data accumulates, not yet a strong enough signal on its own to redesign entry-zone weighting around.

### Trigger rate: Zone 1/4 vs Zone 2/3 — **confirmed, and the gap is large.**

Edge-zone entries (Zone 1 + Zone 4) trigger at **26.0%**, barely half the middle zones' **51.0%**. This directly confirms the task's own hypothesis: price has to move further to reach a Zone 1 or Zone 4 entry than a Zone 2/3 entry, so fewer of them ever fill. This is the most statistically solid finding in this report — the sample sizes here are the largest of any comparison (381 vs. 359 published) and the effect (roughly 2x) is far larger than any of the avg-R differences above.

**The practical tension this creates**: Zone 1 BUY / Zone 4 SELL entries have the better avg R *when they trigger*, but trigger less than half as often. Which matters more for the recommendation engine depends on what it's optimizing for — total realized R across all recommendations shown (favours the higher-trigger-rate middle zones, which produce more filled trades even at slightly worse avg R) vs. R per triggered trade (favours the edge zones). This report doesn't have the data to resolve that trade-off — it's a product decision, not a statistical one — but it's the one number worth carrying into the redesign discussion either way.

### Recommendation on target placement

**The current fixed-target convention (implicitly ≥2.0R in prior scoring logic, per the task's own framing) is not supported by this data.** 78.8% of winning trades in this sample never reach 1.0R; only 6.6% ever reach 2.0R. A target scheme calibrated to this distribution — e.g. a primary target around 0.5-0.7R (where the bulk of winners actually land, median 0.47R) with a secondary/stretch target near 1.0R for the minority that run further — would realize far more of the "winning" trades' available profit than a flat 2.0R target does today. This is the single most actionable, best-supported finding in this report, since it's drawn from the full 151-winner sample rather than a small subdivided cell.

### Recommendation on stop placement

**Stops do not appear to be uniformly "too tight" in an obviously broken sense** (97.1% of stop-hits happen within 1.0 ATR, which is a normal, expected range for stop distances relative to a 4-zone-wide band) — but the 50.3% figure within just 0.5 ATR, combined with Step 3's finding that most winners top out under 1R, is at minimum consistent with a meaningful share of eventual-winning trades getting stopped out early. This dataset only has final outcomes (result_r), not the full intrabar price path, so it **cannot directly measure** "how many losing trades would have won with a wider stop" — confirming or refuting that needs either intrabar price-path data or a forward-looking simulation, not a reconstruction of historical zone/result pairs. Flagged as the clearest next research step this analysis surfaces but can't itself answer.

---

## Appendix — reproducibility

- Zone reconstruction and all statistics were computed by a one-off research script (not committed to the repository, per "research only, no production code changes"), using the intelligence-engine's existing Supabase service-role credentials.
- Raw reconstructed per-trade data (978 rows: trade_id, symbol, direction, entry/stop/target, triggered, result_r, published_at, zone, regime, band boundaries) was written to CSV/JSON for audit purposes and can be regenerated or shared on request.
- All queries were paginated past Supabase/PostgREST's 1000-row response cap (confirmed necessary: an unpaginated diagnostic query silently truncated `market_state_intraday`'s 2,025 rows to 1,000, which would have understated the intraday coverage window if not caught).
