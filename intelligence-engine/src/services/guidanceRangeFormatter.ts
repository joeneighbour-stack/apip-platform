// ============================================================================
// guidanceRangeFormatter
// Produces analyst-facing TEXT guidance ranges (risk_range, target_range).
//
// V2: Uses ATR-normalised distance ranges (q25–q75) from historical
// distributions, NOT arbitrary tolerance bands around hidden shadow prices.
//
// The analyst sees distances expressed in the correct market unit:
//   risk_range:   "23–35 pips" or "1.3320–1.3337" depending on format
//   target_range: "65–105 pips"
//
// PRECISION RULE: display precision is MARKET-AWARE, sourced from
// markets.display_precision, never hardcoded.
// ============================================================================

export type GuidanceType = 'risk' | 'target';

const FALLBACK_DISPLAY_PRECISION = 4;

export function formatMarketPrice(price: number, displayPrecision: number | null | undefined): string {
  const precision = displayPrecision ?? FALLBACK_DISPLAY_PRECISION;
  return price.toFixed(precision);
}

export interface FormatGuidanceRangeInput {
  entryMid: number;          // shadow entry midpoint
  distanceLow: number;       // q25 ATR-normalised distance (absolute, positive)
  distanceHigh: number;      // q75 ATR-normalised distance (absolute, positive)
  direction: 'BUY' | 'SELL';
  type: GuidanceType;        // 'risk' (stop side) or 'target' (profit side)
  displayPrecision: number | null | undefined;
}

export function formatGuidanceRange(input: FormatGuidanceRangeInput): string {
  const { entryMid, distanceLow, distanceHigh, direction, type, displayPrecision } = input;

  if (
    Number.isNaN(entryMid) || Number.isNaN(distanceLow) || Number.isNaN(distanceHigh) ||
    distanceLow <= 0 || distanceHigh <= 0
  ) {
    return '';
  }

  // For risk (stop): BUY stop is below entry, SELL stop is above entry
  // For target:      BUY target is above entry, SELL target is below entry
  let low: number, high: number;

  if (type === 'risk') {
    if (direction === 'BUY') {
      // Stop range is BELOW entry: entry - q75 to entry - q25
      low  = entryMid - distanceHigh;
      high = entryMid - distanceLow;
    } else {
      // Stop range is ABOVE entry: entry + q25 to entry + q75
      low  = entryMid + distanceLow;
      high = entryMid + distanceHigh;
    }
  } else {
    if (direction === 'BUY') {
      // Target range is ABOVE entry: entry + q25 to entry + q75
      low  = entryMid + distanceLow;
      high = entryMid + distanceHigh;
    } else {
      // Target range is BELOW entry: entry - q75 to entry - q25
      low  = entryMid - distanceHigh;
      high = entryMid - distanceLow;
    }
  }

  const lowStr  = formatMarketPrice(low,  displayPrecision);
  const highStr = formatMarketPrice(high, displayPrecision);

  return `${lowStr}\u2013${highStr}`;
}
