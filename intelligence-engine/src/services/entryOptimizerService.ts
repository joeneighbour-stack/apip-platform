// ============================================================================
// EntryOptimizerService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 9
//          (zone_bounds, optimise_entry_range, construct_stop_target)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.2.md Section 3.6
// ============================================================================
//
// V2 STOP/TARGET CONSTRUCTION (canonical V1 coaching logic):
//
// Stop and target distances are derived from ATR-normalised distributions
// computed from historical actual_trades where ATR data is available.
// The analyst sees RANGES (q25–q75) expressed as distances.
// The hidden shadow trade uses MEDIAN-derived exact prices.
//
// Profile hierarchy (most specific wins):
//   1. analyst + market + direction + entry_zone
//   2. analyst + direction + entry_zone
//   3. team + direction + entry_zone
//   4. default template (baked-in from validated historical distributions)
//
// Default template computed from 6,996 ATR-joinable backfill trades:
//   stop_atr:   q25~0.37, median~0.47, q75~0.57  (consistent across zones)
//   target_atr: q25~1.03, median~1.32, q75~1.57  (varies slightly by zone)
//   All zones achieve >2:1 RR at median -- 2:1 floor is safety net only.
//
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
  preferredZone: AtrZone;
  minimumRr: number;
  // Optional: provide a profile for analyst/market/zone-specific distributions.
  // If omitted, the default template is used.
  atrProfile?: AtrProfile;
}

export interface EntryOptimizerOutput {
  entryRangeLow: number;   // full preferred zone low
  entryRangeHigh: number;  // full preferred zone high
  entryMid: number;        // midpoint -- used for shadow trade entry
  // Analyst-facing ranges (expressed as distances from entryMid)
  riskRangeLow: number;    // stop_atr_q25 × ATR (distance)
  riskRangeHigh: number;   // stop_atr_q75 × ATR (distance)
  targetRangeLow: number;  // target_atr_q25 × ATR (distance)
  targetRangeHigh: number; // target_atr_q75 × ATR (distance)
  // Hidden shadow trade exact prices
  stop: number;            // entryMid ± stop_atr_median × ATR
  target: number;          // entryMid ± target_atr_median × ATR (2:1 floor applied)
  rr: number;              // planned RR of shadow trade
}

// ── Default ATR profile (baked-in from validated historical distributions) ──
// Computed from 6,996 ATR-joinable backfill trades across all zones/directions.
// Zone-specific values used where available; fallback to overall median.
const DEFAULT_PROFILES: Record<string, AtrProfile> = {
  'ZONE_1:BUY':    { stopAtrQ25: 0.387, stopAtrMedian: 0.479, stopAtrQ75: 0.583, targetAtrQ25: 1.162, targetAtrMedian: 1.390, targetAtrQ75: 1.607 },
  'ZONE_1:SELL':   { stopAtrQ25: 0.356, stopAtrMedian: 0.469, stopAtrQ75: 0.545, targetAtrQ25: 1.160, targetAtrMedian: 1.358, targetAtrQ75: 1.546 },
  'ZONE_2:BUY':    { stopAtrQ25: 0.382, stopAtrMedian: 0.469, stopAtrQ75: 0.568, targetAtrQ25: 1.049, targetAtrMedian: 1.305, targetAtrQ75: 1.567 },
  'ZONE_2:SELL':   { stopAtrQ25: 0.367, stopAtrMedian: 0.465, stopAtrQ75: 0.552, targetAtrQ25: 1.033, targetAtrMedian: 1.319, targetAtrQ75: 1.524 },
  'ZONE_3:BUY':    { stopAtrQ25: 0.365, stopAtrMedian: 0.469, stopAtrQ75: 0.579, targetAtrQ25: 1.029, targetAtrMedian: 1.301, targetAtrQ75: 1.603 },
  'ZONE_3:SELL':   { stopAtrQ25: 0.348, stopAtrMedian: 0.464, stopAtrQ75: 0.539, targetAtrQ25: 1.080, targetAtrMedian: 1.276, targetAtrQ75: 1.518 },
  'ZONE_4:BUY':    { stopAtrQ25: 0.402, stopAtrMedian: 0.491, stopAtrQ75: 0.576, targetAtrQ25: 1.113, targetAtrMedian: 1.287, targetAtrQ75: 1.539 },
  'ZONE_4:SELL':   { stopAtrQ25: 0.359, stopAtrMedian: 0.461, stopAtrQ75: 0.546, targetAtrQ25: 1.104, targetAtrMedian: 1.343, targetAtrQ75: 1.538 },
  'TOO_DEEP:BUY':  { stopAtrQ25: 0.394, stopAtrMedian: 0.480, stopAtrQ75: 0.579, targetAtrQ25: 1.103, targetAtrMedian: 1.396, targetAtrQ75: 1.611 },
  'TOO_DEEP:SELL': { stopAtrQ25: 0.367, stopAtrMedian: 0.450, stopAtrQ75: 0.529, targetAtrQ25: 1.105, targetAtrMedian: 1.293, targetAtrQ75: 1.536 },
  'TOO_HIGH:BUY':  { stopAtrQ25: 0.379, stopAtrMedian: 0.462, stopAtrQ75: 0.571, targetAtrQ25: 1.094, targetAtrMedian: 1.261, targetAtrQ75: 1.500 },
  'TOO_HIGH:SELL': { stopAtrQ25: 0.363, stopAtrMedian: 0.454, stopAtrQ75: 0.540, targetAtrQ25: 1.099, targetAtrMedian: 1.269, targetAtrQ75: 1.627 },
}

// Overall fallback if zone/direction key not found
const FALLBACK_PROFILE: AtrProfile = {
  stopAtrQ25: 0.370, stopAtrMedian: 0.469, stopAtrQ75: 0.560,
  targetAtrQ25: 1.050, targetAtrMedian: 1.310, targetAtrQ75: 1.560,
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

interface EntryRange { entryRangeLow: number; entryRangeHigh: number; entryMid: number; }

function optimiseEntryRange(marketState: MarketStateOutput, preferredZone: AtrZone): EntryRange {
  const [low, high] = zoneBounds(marketState, preferredZone);
  // Notebook checks notna(low) and notna(high) INDEPENDENTLY for the two
  // range fields -- not a combined check -- so it's possible in principle
  // for one side to be real while the other is NaN. Replicated exactly
  // rather than simplified to a single combined guard.
  const entryRangeLow = !Number.isNaN(low) ? Math.min(low, high) : NaN;
  const entryRangeHigh = !Number.isNaN(high) ? Math.max(low, high) : NaN;
  const entryMid = !Number.isNaN(low) && !Number.isNaN(high) ? (low + high) / 2 : NaN;
  return { entryRangeLow, entryRangeHigh, entryMid };
}

/**
 * Constructs stop/target using ATR-normalised historical distributions.
 *
 * Analyst sees:
 *   risk_range  = [stopAtrQ25 × ATR, stopAtrQ75 × ATR]   (distances)
 *   target_range = [targetAtrQ25 × ATR, targetAtrQ75 × ATR] (distances)
 *
 * Shadow trade uses median-derived exact prices:
 *   stop   = entryMid ± stopAtrMedian × ATR
 *   target = entryMid ± targetAtrMedian × ATR
 *   2:1 RR floor: if target_distance < 2.0 × stop_distance, expand target only
 */
function constructStopTarget(
  atr14: number | null,
  direction: Direction,
  entryMid: number,
  minimumRr: number,
  profile: AtrProfile,
): {
  riskRangeLow: number; riskRangeHigh: number;
  targetRangeLow: number; targetRangeHigh: number;
  stop: number; target: number; rr: number;
} {
  const atr = atr14 ?? NaN;
  if (Number.isNaN(atr) || Number.isNaN(entryMid) || atr <= 0) {
    return {
      riskRangeLow: NaN, riskRangeHigh: NaN,
      targetRangeLow: NaN, targetRangeHigh: NaN,
      stop: NaN, target: NaN, rr: NaN,
    }
  }

  // Analyst-facing ranges (distances, always positive)
  const riskRangeLow  = profile.stopAtrQ25   * atr
  const riskRangeHigh = profile.stopAtrQ75   * atr
  const targetRangeLow  = profile.targetAtrQ25 * atr
  const targetRangeHigh = profile.targetAtrQ75 * atr

  // Shadow trade exact prices using median
  const stopDistance   = profile.stopAtrMedian   * atr
  let targetDistance   = profile.targetAtrMedian * atr

  // 2:1 RR floor: keep stop unchanged, expand target if needed
  if (targetDistance < minimumRr * stopDistance) {
    targetDistance = minimumRr * stopDistance
  }

  const stop   = direction === 'BUY' ? entryMid - stopDistance   : entryMid + stopDistance
  const target = direction === 'BUY' ? entryMid + targetDistance : entryMid - targetDistance

  const rr = stopDistance > 0 ? targetDistance / stopDistance : NaN

  return { riskRangeLow, riskRangeHigh, targetRangeLow, targetRangeHigh, stop, target, rr }
}

export function buildEntryOptimizer(input: EntryOptimizerInput): EntryOptimizerOutput {
  const { marketState, direction, preferredZone, minimumRr, atrProfile } = input

  const range = optimiseEntryRange(marketState, preferredZone)

  // Profile hierarchy: caller-provided > zone+direction default > fallback
  const profileKey = `${preferredZone}:${direction}`
  const profile = atrProfile ?? DEFAULT_PROFILES[profileKey] ?? FALLBACK_PROFILE

  const stopTarget = constructStopTarget(marketState.atr14, direction, range.entryMid, minimumRr, profile)

  return { ...range, ...stopTarget }
}
