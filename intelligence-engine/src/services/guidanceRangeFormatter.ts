// ============================================================================
// guidanceRangeFormatter
// Produces analyst-facing TEXT guidance ranges (risk_range, target_range),
// deliberately distinct from the precise numeric levels used internally and
// by the hidden shadow trade. See Architecture Section 1.8.
//
// PRECISION RULE [updated per clarification]: display precision is
// MARKET-AWARE, sourced from markets.display_precision, never hardcoded to
// a single value (the original V1 default of 4dp was FX-biased and would
// have produced misleadingly-precise text for indices/commodities/equities).
// This affects ONLY analyst-facing text -- it never touches internal
// numeric calculations, shadow trade levels, expected R, trigger
// probability, or validation hashes, all of which continue to operate on
// full-precision floating point numbers regardless of display formatting.
// ============================================================================

export type GuidanceType = 'risk' | 'target';

const GUIDANCE_HALF_WIDTH_ATR_MULTIPLE = 0.125;

/**
 * Last-resort fallback ONLY -- used when a market's display_precision is
 * null/undefined (e.g. a market added before the column existed, or a gap
 * in the backfill). markets.display_precision is the source of truth; this
 * is not a general default to rely on, and should ideally never fire for
 * any market that's been properly backfilled (031_display_precision_and_
 * condition_fields.sql).
 */
const FALLBACK_DISPLAY_PRECISION = 4;

/**
 * Formats a single price to the correct number of decimal places for its
 * market. Presentation only -- the caller is responsible for ensuring
 * `price` itself is never rounded or truncated before any real calculation
 * happens; this function must only ever be called at the final point of
 * producing display text, never partway through a numeric pipeline.
 */
export function formatMarketPrice(price: number, displayPrecision: number | null | undefined): string {
  const precision = displayPrecision ?? FALLBACK_DISPLAY_PRECISION;
  return price.toFixed(precision);
}

export interface FormatGuidanceRangeInput {
  anchorPrice: number;
  atr: number;
  direction: 'BUY' | 'SELL'; // accepted per the suggested signature; NOT used in the V1 symmetric-tolerance formula. Reserved for a future analyst-profile-adjusted (asymmetric) formula.
  type: GuidanceType; // also not currently used to vary the formula (risk and target use identical width in V1). Reserved for future differentiation.
  displayPrecision: number | null | undefined; // from markets.display_precision -- see formatMarketPrice
}

export function formatGuidanceRange(input: FormatGuidanceRangeInput): string {
  const { anchorPrice, atr, displayPrecision } = input;

  if (Number.isNaN(anchorPrice) || Number.isNaN(atr) || atr <= 0) {
    return ''; // no real anchor to build guidance around -- empty text, not a fabricated range
  }

  const halfWidth = atr * GUIDANCE_HALF_WIDTH_ATR_MULTIPLE;
  const low = anchorPrice - halfWidth;
  const high = anchorPrice + halfWidth;

  return `${formatMarketPrice(low, displayPrecision)}\u2013${formatMarketPrice(high, displayPrecision)}`;
}
