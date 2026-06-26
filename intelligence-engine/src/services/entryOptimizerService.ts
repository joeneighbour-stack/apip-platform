// ============================================================================
// EntryOptimizerService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 9
//          (zone_bounds, optimise_entry_range, construct_stop_target)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.2.md Section 3.6
// ============================================================================

import type { AtrZone, Direction } from '../types/domain.js';
import type { MarketStateOutput } from './marketStateService.js';

export interface EntryOptimizerInput {
  marketState: MarketStateOutput;
  direction: Direction;
  preferredZone: AtrZone;
  minimumRr: number;
}

export interface EntryOptimizerOutput {
  entryRangeLow: number;  // can be NaN -- see zoneBounds note
  entryRangeHigh: number; // can be NaN
  entryMid: number;       // can be NaN
  stop: number;           // can be NaN
  target: number;         // can be NaN
  rr: number;             // can be NaN; otherwise always equals minimumRr exactly, by construction
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
 * This is the simplest defensible choice (no new arbitrary extrapolation
 * distance to justify) and means an extreme-zone recommendation still gets
 * a real range, bounded by where the ATR bands say something meaningful,
 * rather than an invented range extending past the bands entirely.
 * This needs its own V1.3 architecture amendment -- it is a validated
 * behaviour change, not a bug fix, and must not be conflated with one.
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

interface StopTarget { stop: number; target: number; rr: number; }

function constructStopTarget(atr14: number | null, direction: Direction, entryMid: number, minimumRr: number): StopTarget {
  const atr = atr14 ?? NaN;
  if (Number.isNaN(atr) || Number.isNaN(entryMid) || atr <= 0) {
    return { stop: NaN, target: NaN, rr: NaN };
  }
  const risk = atr * 0.25;
  const stop = direction === 'BUY' ? entryMid - risk : entryMid + risk;
  const target = direction === 'BUY' ? entryMid + minimumRr * risk : entryMid - minimumRr * risk;
  // entryMid === stop only if risk === 0, which the atr<=0 guard above
  // already excludes -- this check is unreachable under current
  // preconditions but kept exactly as the notebook has it, not removed as
  // "dead code". A future change to risk's formula could make it reachable
  // again, and silently dropping defensive guards is exactly the kind of
  // unauthorised simplification this project exists to avoid.
  const rr = entryMid !== stop ? Math.abs(target - entryMid) / Math.abs(entryMid - stop) : NaN;
  return { stop, target, rr };
}

export function buildEntryOptimizer(input: EntryOptimizerInput): EntryOptimizerOutput {
  const range = optimiseEntryRange(input.marketState, input.preferredZone);
  const stopTarget = constructStopTarget(input.marketState.atr14, input.direction, range.entryMid, input.minimumRr);
  return { ...range, ...stopTarget };
}
