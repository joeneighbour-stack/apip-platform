// ============================================================================
// MarketStateService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 6 (calculate_atr, calculate_atr_zones, build_market_state)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md Section 3.1
// ============================================================================
// Pure function. No I/O. Caller fetches ohlcSeries/currentPrice from
// market_state_daily/market_state_intraday and persists the output.

import type { AtrZone } from '../types/domain.js';

export interface OhlcBar {
  date: string;     // ISO date, ascending order expected in the input series
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketStateInput {
  marketId: string;
  ohlcSeries: OhlcBar[];        // ordered oldest -> newest, >= atrPeriod+1 bars
  currentPrice: { price: number; capturedAt: string };
  parameters: { atrPeriod: number; zoneCount: number };
}

export interface MarketStateOutput {
  marketId: string;
  atr14: number | null;
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
 * Matches notebook: tr1 = high-low, tr2 = |high-prevClose|, tr3 = |low-prevClose|, TR = max(tr1,tr2,tr3).
 */
function trueRange(bar: OhlcBar, prevClose: number | undefined): number {
  const tr1 = bar.high - bar.low;
  if (prevClose === undefined) return tr1;
  const tr2 = Math.abs(bar.high - prevClose);
  const tr3 = Math.abs(bar.low - prevClose);
  return Math.max(tr1, tr2, tr3);
}

/**
 * Rolling mean of True Range over `period` bars.
 */
function calculateAtr(ohlcSeries: OhlcBar[], period: number): number | null {
  const trueRanges: number[] = [];
  for (let i = 0; i < ohlcSeries.length; i++) {
    const prevClose = i > 0 ? ohlcSeries[i - 1]!.close : undefined;
    trueRanges.push(trueRange(ohlcSeries[i]!, prevClose));
  }

  if (trueRanges.length < period) return null;
  const window = trueRanges.slice(trueRanges.length - period);
  const sum = window.reduce((acc, v) => acc + v, 0);
  return sum / period;
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
 * ATR band calculation per Pine Script definition:
 *   upperBand = daily_low + ATR14
 *   lowerBand = daily_high - ATR14
 *
 * Zones 1-4 split the band from lowerBand (bottom) to upperBand (top):
 *   ZONE_1 = lowerBand to lowerBand + step       (lowest, near lowerBand)
 *   ZONE_2 = lowerBand + step to lowerBand + 2*step
 *   ZONE_3 = lowerBand + 2*step to lowerBand + 3*step
 *   ZONE_4 = lowerBand + 3*step to upperBand     (highest, near upperBand)
 */
function calculateAtrZones(
  latestHigh: number, latestLow: number, atr14: number | null, latestClose: number,
  currentPrice: number | null, zoneCount: number,
): AtrZoneBands {
  const price = currentPrice ?? latestClose;

  if (atr14 === null || atr14 <= 0 || !Number.isFinite(latestHigh) || !Number.isFinite(latestLow)) {
    return { lowerBand: null, zone1Top: null, zone2Top: null, zone3Top: null, upperBand: null, currentZone: null };
  }

  // Pine Script: upperband = atr + daily_low, lowerband = daily_high - atr
  const lowerBand = latestHigh - atr14;
  const upperBand = latestLow + atr14;

  // Guard against band collapse (high - low < ATR can cause inversion)
  if (upperBand <= lowerBand) {
    return { lowerBand: null, zone1Top: null, zone2Top: null, zone3Top: null, upperBand: null, currentZone: null };
  }

  const step = (upperBand - lowerBand) / zoneCount;
  const zone1Top = lowerBand + step;
  const zone2Top = lowerBand + 2 * step;
  const zone3Top = lowerBand + 3 * step;

  let currentZone: AtrZone;
  if (price < lowerBand) currentZone = 'TOO_DEEP';
  else if (price <= zone1Top) currentZone = 'ZONE_1';
  else if (price <= zone2Top) currentZone = 'ZONE_2';
  else if (price <= zone3Top) currentZone = 'ZONE_3';
  else if (price <= upperBand) currentZone = 'ZONE_4';
  else currentZone = 'TOO_HIGH';

  return { lowerBand, zone1Top, zone2Top, zone3Top, upperBand, currentZone };
}

export function buildMarketState(input: MarketStateInput): MarketStateOutput {
  const { marketId, ohlcSeries, currentPrice, parameters } = input;

  if (ohlcSeries.length === 0) {
    return {
      marketId, atr14: null, lowerBand: null, zone1Top: null, zone2Top: null,
      zone3Top: null, upperBand: null, currentZone: null, currentPrice: currentPrice.price,
      stateGeneratedAt: new Date().toISOString(),
    };
  }

  const atr14 = calculateAtr(ohlcSeries, parameters.atrPeriod);
  const latest = ohlcSeries[ohlcSeries.length - 1]!;
  const zones = calculateAtrZones(latest.high, latest.low, atr14, latest.close, currentPrice.price, parameters.zoneCount);

  return {
    marketId,
    atr14,
    ...zones,
    currentPrice: currentPrice.price,
    stateGeneratedAt: new Date().toISOString(),
  };
}
