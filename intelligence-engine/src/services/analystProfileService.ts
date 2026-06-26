// ============================================================================
// AnalystProfileService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 8 (build_analyst_profiles)
//          and cell 9 (select_best_analyst)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md Section 3.5
// ============================================================================
// CORRECTION TO V1.1 ARCHITECTURE DOCUMENT, found by re-reading the actual
// notebook source: Section 3.5 said this service is "same shape and same
// invariants as TemplateService" -- that UNDERSTATES real, meaningful
// differences:
//   1. AnalystProfile has NO triggerRate field at all (TemplateProfile does).
//   2. select_best_analyst is a genuinely different, three-tier cascade,
//      not a single-threshold filter like select_best_template:
//        a) eligible = analysts where active AND analyst[session] === true
//        b) exact match: same market, direction, AND zone -> 'exact_profile'
//        c) market match: same market (any direction/zone) -> 'market_profile'
//        d) fallback: the FIRST eligible analyst, no scoring at all,
//           profile_quality forced to 'LOW' -- not the same fallback shape
//           as select_best_template's BUY/ZONE_1 default.
// Flagged here so the code is correct now; needs a V1.2 architecture
// amendment to correct Section 3.5's text.
//
// NOTE on relationship to AllocationService (Architecture V1.1 Section 1.7):
// the analyst this service picks is a PREFERENCE signal, not a final
// assignment -- AllocationService's allocate_coverage (cell 12) takes it as
// a +0.2 scoring bonus alongside expected_r and live workload, and CAN pick
// a different analyst if workload balancing outweighs the preference. This
// service's "assignedAnalyst" output should be read as "preferred_analyst"
// in spirit, even though the notebook field is literally named
// assigned_analyst at this stage.

import type { AtrZone, Direction } from '../types/domain.js';

export interface AnalystHistoricalTrade {
  analyst: string;
  market: string;
  direction: Direction;
  entryZone: AtrZone | null;
  resultR: number | null;
}

export interface AnalystProfile {
  analyst: string;
  market: string;
  direction: Direction;
  entryZone: AtrZone | null;
  trades: number;
  avgR: number;    // can be NaN -- see TemplateService for the identical skipna rationale
  winRate: number; // always a real number in [0,1], never NaN
  profileQuality: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ActiveAnalyst {
  analyst: string;
  active: boolean;
  sessionEligibility: Record<string, boolean>; // e.g. { EUROPEAN: true, US: true, APAC: false }
}

export type ProfileSource = 'exact_profile' | 'market_profile' | 'fallback';

export interface SelectBestAnalystOutput {
  assignedAnalyst: string | null; // see file header note -- a preference, not a final allocation
  profileSource: ProfileSource;
  profileAvgR: number;
  profileWinRate: number | null;
  profileTrades: number;
  profileQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  eligibleAnalysts: string[];
}

const HIGH_CONFIDENCE_MIN_TRADES = 50;
const MEDIUM_CONFIDENCE_MIN_TRADES = 20;

function groupKey(analyst: string, market: string, direction: Direction, entryZone: AtrZone | null): string {
  return `${analyst}\u0000${market}\u0000${direction}\u0000${entryZone ?? '\u0000NULL\u0000'}`;
}

export function buildAnalystProfiles(trades: AnalystHistoricalTrade[]): AnalystProfile[] {
  if (trades.length === 0) return [];

  const groups = new Map<string, AnalystHistoricalTrade[]>();
  for (const trade of trades) {
    const key = groupKey(trade.analyst, trade.market, trade.direction, trade.entryZone);
    const existing = groups.get(key);
    if (existing) existing.push(trade);
    else groups.set(key, [trade]);
  }

  const profiles: AnalystProfile[] = [];
  for (const groupTrades of groups.values()) {
    const first = groupTrades[0]!;
    const tradesCount = groupTrades.length;

    const nonNullResults = groupTrades.map((t) => t.resultR).filter((r): r is number => r !== null);
    const avgR = nonNullResults.length > 0
      ? nonNullResults.reduce((a, v) => a + v, 0) / nonNullResults.length
      : NaN;

    const wins = groupTrades.filter((t) => (t.resultR ?? NaN) > 0).length;
    const winRate = wins / tradesCount;

    const profileQuality: 'HIGH' | 'MEDIUM' | 'LOW' =
      tradesCount >= HIGH_CONFIDENCE_MIN_TRADES && avgR > 0 ? 'HIGH'
      : tradesCount >= MEDIUM_CONFIDENCE_MIN_TRADES && avgR > 0 ? 'MEDIUM'
      : 'LOW';

    profiles.push({
      analyst: first.analyst, market: first.market, direction: first.direction, entryZone: first.entryZone,
      trades: tradesCount, avgR, winRate, profileQuality,
    });
  }

  return profiles;
}

// Same NaN-aware descending comparator as TemplateService -- pandas places
// NaN last regardless of sort direction; a naive subtraction comparator's
// behaviour with NaN is undefined per the Array.sort spec.
function compareDesc(a: number, b: number): number {
  const aIsNaN = Number.isNaN(a), bIsNaN = Number.isNaN(b);
  if (aIsNaN && bIsNaN) return 0;
  if (aIsNaN) return 1;
  if (bIsNaN) return -1;
  return b - a;
}

function sortByAvgRTradesWinRate(profiles: AnalystProfile[]): AnalystProfile[] {
  return [...profiles].sort((a, b) => {
    const avgRCmp = compareDesc(a.avgR, b.avgR);
    if (avgRCmp !== 0) return avgRCmp;
    if (b.trades !== a.trades) return b.trades - a.trades;
    return compareDesc(a.winRate, b.winRate);
  });
}

export function selectBestAnalyst(
  market: string, direction: Direction, zone: AtrZone,
  profiles: AnalystProfile[], activeAnalysts: ActiveAnalyst[], session: string,
): SelectBestAnalystOutput {
  const eligible = activeAnalysts
    .filter((a) => a.active && a.sessionEligibility[session] === true)
    .map((a) => a.analyst);

  const subset = profiles.filter((p) => p.market === market && eligible.includes(p.analyst));

  const exact = subset.filter((p) => p.direction === direction && p.entryZone === zone);
  if (exact.length > 0) {
    const best = sortByAvgRTradesWinRate(exact)[0]!;
    return {
      assignedAnalyst: best.analyst, profileSource: 'exact_profile',
      profileAvgR: best.avgR, profileWinRate: best.winRate,
      profileTrades: best.trades, profileQuality: best.profileQuality,
      eligibleAnalysts: eligible,
    };
  }

  if (subset.length > 0) {
    const best = sortByAvgRTradesWinRate(subset)[0]!;
    return {
      assignedAnalyst: best.analyst, profileSource: 'market_profile',
      profileAvgR: best.avgR, profileWinRate: best.winRate,
      profileTrades: best.trades, profileQuality: best.profileQuality,
      eligibleAnalysts: eligible,
    };
  }

  // Fallback: the FIRST eligible analyst, no scoring at all -- not the
  // same shape as TemplateService's fallback. null only if no analyst is
  // eligible for this session at all.
  return {
    assignedAnalyst: eligible.length > 0 ? eligible[0]! : null,
    profileSource: 'fallback',
    profileAvgR: 0, profileWinRate: null, profileTrades: 0, profileQuality: 'LOW',
    eligibleAnalysts: eligible,
  };
}
