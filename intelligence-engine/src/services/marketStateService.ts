// ============================================================================
// MarketStateService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 6 (calculate_atr, calculate_atr_zones, build_market_state)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md Section 3.1
// ============================================================================
// Pure function. No I/O. Caller fetches ohlcSeries/currentPrice from
// market_state_daily/market_state_intraday and persists the output.
//
// ATR METHODOLOGY (V1.4 correction):
//   ATR20 Wilder RMA — period 20, seeded from SMA of first 20 TR values.
//   This matches TradingView/OANDA ATR(20) exactly.
//   ATR14 is retained in output for backward compatibility during transition.
//
// BAND FORMULA (Pine-style, locked):
//   Caller may supply SessionAnchors for the current developing APIP session.
//   When provided:
//     bottom_anchor = min(previousClose, todayLowSoFar)
//     top_anchor    = max(previousClose, todayHighSoFar)
//     upper_band    = bottom_anchor + atr20
//     lower_band    = top_anchor    - atr20
//   When absent (backward-compat, e.g. populateMarketStateDaily):
//     Uses latest bar's raw high/low as top/bottom anchors.
//
// ZONE CONVENTION (authoritative):
//   ZONE_1 = lower_band → q1  (cheapest / bottom)
//   ZONE_2 = q1 → q2
//   ZONE_3 = q2 → q3
//   ZONE_4 = q3 → upper_band  (most expensive / top)
//   TOO_DEEP  = below lower_band
//   TOO_HIGH  = above upper_band
//   Direction does not alter zone geometry.
// ============================================================================
import type { AtrZone } from '../types/domain.js';

export interface OhlcBar {
  date: string;     // ISO date, ascending order expected
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Optional current-session anchors for Pine-style band construction.
 * When supplied, zones use ATR20 + Pine-style min/max anchors.
 * previousClose: close of final 5-min OANDA bar before current APIP session open.
 * todayHighSoFar: max(bar.high) from all 5-min bars since session open.
 * todayLowSoFar:  min(bar.low)  from all 5-min bars since session open.
 * precomputedAtr20: if provided, skips recomputing ATR from ohlcSeries and uses
 *   this value directly (e.g. loaded from market_state_daily.atr20).
 */
export interface SessionAnchors {
  previousClose: number;
  todayHighSoFar: number;
  todayLowSoFar: number;
  precomputedAtr20?: number;
}

export interface MarketStateInput {
  marketId: string;
  ohlcSeries: OhlcBar[];        // ordered oldest -> newest
  currentPrice: { price: number; capturedAt: string };
  parameters: { atrPeriod: number; zoneCount: number };
  sessionAnchors?: SessionAnchors;
}

export interface MarketStateOutput {
  marketId: string;
  atr14: number | null;   // ATR with parameters.atrPeriod (kept for backward compat)
  atr20: number | null;   // ATR20 Wilder RMA — canonical zone input
  lowerBand: number | null;
  zone1Top: number | null;
  zone2Top: number | null;
  zone3Top: number | null;
  upperBand: number | null;
  currentZone: AtrZone | null;
  currentPrice: number;
  stateGeneratedAt: string;
}

/**
 * True Range for a single bar against the previous bar's close.
 * TR = max(high-low, |high-prevClose|, |low-prevClose|)
 */
function trueRange(bar: OhlcBar, prevClose: number | undefined): number {
  const tr1 = bar.high - bar.low;
  if (prevClose === undefined) return tr1;
  const tr2 = Math.abs(bar.high - prevClose);
  const tr3 = Math.abs(bar.low - prevClose);
  return Math.max(tr1, tr2, tr3);
}

/**
 * Wilder RMA (ATR).
 * Seeded from the SMA of the first `period` TR values, then:
 *   atr_i = (atr_{i-1} * (period-1) + TR_i) / period
 * This matches TradingView's ATR(n) with Wilder smoothing exactly.
 * Returns null when fewer than `period` bars are available.
 */
function calculateAtr(ohlcSeries: OhlcBar[], period: number): number | null {
  if (ohlcSeries.length < period) return null;

  // Build complete TR series
  const trs: number[] = ohlcSeries.map((bar, i) => {
    const prevClose = i > 0 ? ohlcSeries[i - 1]!.close : undefined;
    return trueRange(bar, prevClose);
  });

  // Seed: SMA of first `period` TR values
  let rma = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Recurse: Wilder RMA
  for (let i = period; i < trs.length; i++) {
    rma = (rma * (period - 1) + trs[i]!) / period;
  }

  return rma;
}

interface AtrZoneBands {
  lowerBand: number | null;
  zone1Top: number | null;
  zone2Top: number | null;
  zone3Top: number | null;
  upperBand: number | null;
  currentZone: AtrZone | null;
}

/**
 * Constructs ATR bands from pre-computed anchors and classifies current price.
 * bottomAnchor = min(previousClose, todayLowSoFar)  [or raw latestLow]
 * topAnchor    = max(previousClose, todayHighSoFar) [or raw latestHigh]
 * upper_band   = bottomAnchor + atr
 * lower_band   = topAnchor   - atr
 * Zone numbering: ZONE_1 cheapest (near lower_band), ZONE_4 most expensive (near upper_band).
 */
function calculateAtrZones(
  bottomAnchor: number,
  topAnchor: number,
  atr: number | null,
  currentPrice: number,
  zoneCount: number,
): AtrZoneBands {
  if (atr === null || atr <= 0 || !Number.isFinite(bottomAnchor) || !Number.isFinite(topAnchor)) {
    return { lowerBand: null, zone1Top: null, zone2Top: null, zone3Top: null, upperBand: null, currentZone: null };
  }

  const lowerBand = topAnchor    - atr;   // top_anchor    - ATR
  const upperBand = bottomAnchor + atr;   // bottom_anchor + ATR

  // Band-collapse guard: if ATR <= (topAnchor - bottomAnchor) / 2 the bands invert.
  // Fall back to centring on current price.
  if (upperBand <= lowerBand) {
    const centred = currentPrice;
    const halfAtr = atr / 2;
    const fb_lower = centred - halfAtr;
    const fb_upper = centred + halfAtr;
    const step = (fb_upper - fb_lower) / zoneCount;
    return {
      lowerBand: fb_lower,
      zone1Top: fb_lower + step,
      zone2Top: fb_lower + 2 * step,
      zone3Top: fb_lower + 3 * step,
      upperBand: fb_upper,
      currentZone: classifyZone(currentPrice, fb_lower, fb_upper, step),
    };
  }

  const step = (upperBand - lowerBand) / zoneCount;
  const zone1Top = lowerBand + step;
  const zone2Top = lowerBand + 2 * step;
  const zone3Top = lowerBand + 3 * step;

  return {
    lowerBand, zone1Top, zone2Top, zone3Top, upperBand,
    currentZone: classifyZone(currentPrice, lowerBand, upperBand, step),
  };
}

function classifyZone(price: number, lowerBand: number, upperBand: number, step: number): AtrZone {
  if (price < lowerBand)                       return 'TOO_DEEP';
  if (price <= lowerBand + step)               return 'ZONE_1';
  if (price <= lowerBand + 2 * step)           return 'ZONE_2';
  if (price <= lowerBand + 3 * step)           return 'ZONE_3';
  if (price <= upperBand)                      return 'ZONE_4';
  return 'TOO_HIGH';
}

export function buildMarketState(input: MarketStateInput): MarketStateOutput {
  const { marketId, ohlcSeries, currentPrice, parameters, sessionAnchors } = input;

  if (ohlcSeries.length === 0 && !sessionAnchors?.precomputedAtr20) {
    return {
      marketId, atr14: null, atr20: null,
      lowerBand: null, zone1Top: null, zone2Top: null, zone3Top: null,
      upperBand: null, currentZone: null,
      currentPrice: currentPrice.price,
      stateGeneratedAt: new Date().toISOString(),
    };
  }

  // Always compute both ATR values from ohlcSeries for output/storage
  const atr14 = ohlcSeries.length > 0 ? calculateAtr(ohlcSeries, parameters.atrPeriod) : null;
  const atr20Computed = ohlcSeries.length > 0 ? calculateAtr(ohlcSeries, 20) : null;

  // Use precomputed ATR20 from DB when provided (intraday path), else computed
  const atr20 = sessionAnchors?.precomputedAtr20 ?? atr20Computed;

  let bottomAnchor: number;
  let topAnchor: number;
  let atrForZones: number | null;

  if (sessionAnchors) {
    // Pine-style: anchors incorporate previous session close
    bottomAnchor = Math.min(sessionAnchors.previousClose, sessionAnchors.todayLowSoFar);
    topAnchor    = Math.max(sessionAnchors.previousClose, sessionAnchors.todayHighSoFar);
    atrForZones  = atr20;
  } else {
    // Backward-compat: use latest bar's raw high/low
    const latest = ohlcSeries[ohlcSeries.length - 1];
    if (!latest) {
      return {
        marketId, atr14, atr20,
        lowerBand: null, zone1Top: null, zone2Top: null, zone3Top: null,
        upperBand: null, currentZone: null,
        currentPrice: currentPrice.price,
        stateGeneratedAt: new Date().toISOString(),
      };
    }
    // Legacy formula: top=latestHigh, bottom=latestLow
    topAnchor    = latest.high;
    bottomAnchor = latest.low;
    atrForZones  = atr14;   // backward compat: use primary ATR period
  }

  const zones = calculateAtrZones(
    bottomAnchor, topAnchor, atrForZones,
    currentPrice.price, parameters.zoneCount,
  );

  return {
    marketId,
    atr14,
    atr20,
    ...zones,
    currentPrice: currentPrice.price,
    stateGeneratedAt: new Date().toISOString(),
  };
}
