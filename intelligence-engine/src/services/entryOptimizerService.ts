// ============================================================================
// EntryOptimizerService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 9
//          (zone_bounds, optimise_entry_range, construct_stop_target)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.2.md Section 3.6
// ============================================================================
//
// V3 REDESIGN (regime-conditional zone, band-boundary target, band-exterior stop):
//
// Zone selection is now regime-conditional (selectEntryZone()), not derived from
// historical ATR-multiplier profiles or the caller's own preferredEntryZone --
// this service now OWNS zone selection and returns it, rather than accepting it
// as an input. Entry price is the edge of the selected zone nearest the outer
// band (zone low for BUY, zone high for SELL), not the zone midpoint, to
// maximise room to target. Target is the outer band boundary itself (always
// inside the band by construction); stop is placed one full zone width outside
// the OPPOSITE band boundary -- geometrically consistent and ATR-scaled by
// construction, since zone width is itself derived from ATR20 (marketStateService.ts).
// A 2:1 RR floor still applies: if the natural band-boundary target doesn't
// reach 2:1, it's expanded to exactly 2x the stop distance.
//
// Zone selection (regime-conditional):
//   BUY:  TRENDING_UP -> ZONE_2 (trend may not pull back to the extreme)
//         TRENDING_DOWN / RANGE / MIXED -> ZONE_1 (favourable low-risk entry)
//   SELL: TRENDING_UP / RANGE / MIXED -> ZONE_4 (favourable high-risk entry)
//         TRENDING_DOWN -> ZONE_3 (trend may not rally back to the extreme)
// ============================================================================

import type { AtrZone, Direction } from '../types/domain.js';
import type { MarketStateOutput } from './marketStateService.js';

export interface AtrProfile {
  stopAtrQ25: number;
  stopAtrMedian: number;
  stopAtrQ75: number;
  targetAtrQ25: number;
  targetAtrMedian: number;
  targetAtrQ75: number;
}

export interface EntryOptimizerInput {
  marketState: MarketStateOutput;
  direction: Direction;
  minimumRr: number;
  trendState: string | null; // drives regime-conditional zone selection
  // Kept for interface compatibility -- still used for zone preference in
  // allocation scoring (analystScoringService.ts). Not consumed here: stop/
  // target geometry is now purely band-boundary/zone-width derived, not
  // ATR-multiplier-profile derived.
  atrProfile?: AtrProfile;
}

export interface EntryOptimizerOutput {
  preferredZone: AtrZone;   // computed from regime -- see selectEntryZone()
  entryRangeLow: number;    // zone low (analyst-facing display)
  entryRangeHigh: number;   // zone high (analyst-facing display)
  entryMid: number;         // zone midpoint (display only)
  entryPrice: number;       // zone low (BUY) or zone high (SELL) -- shadow trade entry
  riskRangeLow: number;     // stop price (exact)
  riskRangeHigh: number;    // stop price + small buffer for display
  targetRangeLow: number;   // target price - small buffer for display
  targetRangeHigh: number;  // target price (exact)
  stop: number;             // exact stop price
  target: number;           // exact target price
  rr: number;               // actual RR achieved
}

/**
 * Regime-conditional entry zone. Direction does not alter zone geometry
 * (marketStateService.ts), but it does alter which zone is preferred for entry:
 * BUY wants the cheap (low) side of the band, SELL wants the expensive (high)
 * side -- except when trending, where the extreme zone (1 or 4) may never be
 * reached, so the adjacent middle zone (2 or 3) is preferred instead.
 */
export function selectEntryZone(
  direction: Direction,
  trendState: string | null,
): AtrZone {
  const trend = trendState ?? 'RANGE';
  if (direction === 'BUY') {
    if (trend === 'TRENDING_UP') return 'ZONE_2';
    if (trend === 'TRENDING_DOWN') return 'ZONE_1';
    return 'ZONE_1'; // MIXED or RANGE
  } else {
    if (trend === 'TRENDING_UP') return 'ZONE_4';
    if (trend === 'TRENDING_DOWN') return 'ZONE_3';
    return 'ZONE_4'; // MIXED or RANGE
  }
}

/**
 * Returns the [low, high] bounds for a zone, using the market state's band
 * fields.
 *
 * DELIBERATE DEPARTURE FROM THE NOTEBOOK, approved explicitly: the notebook
 * itself never defines bounds for TOO_DEEP/TOO_HIGH (they fall through to
 * [NaN, NaN] there), but in production every recommendation must publish a
 * usable entry range -- a NaN range is not an acceptable real-world output.
 * TOO_DEEP clamps to ZONE_1's bounds; TOO_HIGH clamps to ZONE_4's bounds.
 */
export function zoneBounds(marketState: MarketStateOutput, zone: AtrZone): [number, number] {
  switch (zone) {
    case 'TOO_DEEP':
    case 'ZONE_1': return [marketState.lowerBand ?? NaN, marketState.zone1Top ?? NaN];
    case 'ZONE_2': return [marketState.zone1Top ?? NaN, marketState.zone2Top ?? NaN];
    case 'ZONE_3': return [marketState.zone2Top ?? NaN, marketState.zone3Top ?? NaN];
    case 'TOO_HIGH':
    case 'ZONE_4': return [marketState.zone3Top ?? NaN, marketState.upperBand ?? NaN];
  }
}

export function buildEntryOptimizer(input: EntryOptimizerInput): EntryOptimizerOutput {
  const { marketState, direction, minimumRr, trendState } = input;

  const preferredZone = selectEntryZone(direction, trendState);
  const [zoneLow, zoneHigh] = zoneBounds(marketState, preferredZone);

  const entryRangeLow = !Number.isNaN(zoneLow) ? Math.min(zoneLow, zoneHigh) : NaN;
  const entryRangeHigh = !Number.isNaN(zoneHigh) ? Math.max(zoneLow, zoneHigh) : NaN;
  const entryMid = !Number.isNaN(zoneLow) && !Number.isNaN(zoneHigh) ? (zoneLow + zoneHigh) / 2 : NaN;
  // BUY enters at the zone low, SELL at the zone high -- the edge nearest the
  // outer band, maximising the distance available to the (in-band) target.
  const entryPrice = direction === 'BUY' ? entryRangeLow : entryRangeHigh;

  const lowerBand = marketState.lowerBand;
  const upperBand = marketState.upperBand;

  if (Number.isNaN(entryPrice) || lowerBand == null || upperBand == null) {
    return {
      preferredZone, entryRangeLow, entryRangeHigh, entryMid, entryPrice,
      riskRangeLow: NaN, riskRangeHigh: NaN, targetRangeLow: NaN, targetRangeHigh: NaN,
      stop: NaN, target: NaN, rr: NaN,
    };
  }

  // Target: always the outer band boundary.
  const rawTarget = direction === 'BUY' ? upperBand : lowerBand;

  // Stop: one full zone width outside the OPPOSITE band boundary. Zone width
  // is itself ATR20-derived (marketStateService.ts), so this is geometrically
  // consistent and ATR-scaled by construction -- no separate volatility
  // lookup needed.
  const step = (upperBand - lowerBand) / 4;
  const stop = direction === 'BUY' ? lowerBand - step : upperBand + step;

  // 2:1 RR floor: if the natural (band-boundary) target doesn't reach it,
  // expand to exactly minimumRr x the stop distance.
  const stopDistance = Math.abs(entryPrice - stop);
  const naturalTargetDistance = Math.abs(rawTarget - entryPrice);
  const target = naturalTargetDistance >= minimumRr * stopDistance
    ? rawTarget
    : direction === 'BUY'
      ? entryPrice + minimumRr * stopDistance
      : entryPrice - minimumRr * stopDistance;

  const finalTargetDistance = Math.abs(target - entryPrice);
  const rr = stopDistance > 0 ? finalTargetDistance / stopDistance : NaN;

  return {
    preferredZone, entryRangeLow, entryRangeHigh, entryMid, entryPrice,
    // No display-buffer value is specified anywhere in the redesign brief, and
    // recommendationService.ts's new risk/target text (Fix 3) reads `stop`/
    // `target` directly rather than these range fields -- degenerate ranges
    // (equal to the exact price) rather than an invented buffer magnitude.
    riskRangeLow: stop, riskRangeHigh: stop,
    targetRangeLow: target, targetRangeHigh: target,
    stop, target, rr,
  };
}
