// ============================================================================
// TemplateService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 8 (build_template_profiles)
//          and cell 9 (select_best_template)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md Section 3.4
// ============================================================================
// CORRECTIONS TO V1.1 ARCHITECTURE DOCUMENT:
//   1. min_template_trades is 10, not 20
//   2. template_quality requires BOTH trade-count threshold AND avg_r > 0
//   3. NULL-zone trades form their own group; if selected, output defaults to ZONE_1
//
// ZONE/DIRECTION ALIGNMENT (V1.3 amendment):
//   BUY  entries must be in low zones  (ZONE_1, ZONE_2, TOO_DEEP)
//   SELL entries must be in high zones (ZONE_3, ZONE_4, TOO_HIGH)
//
// PREFERRED ZONE OUTPUT (spec sheet 07):
//   Preferred entry zone must be ZONE_1–4 only.
//   TOO_DEEP clamps to ZONE_1; TOO_HIGH clamps to ZONE_4.
//   These extreme zones have significantly lower trigger probability.
//
// DIRECTION CONSTRAINT:
//   Caller may pass preferredDirection derived from regime/current zone.
//   When provided, only templates matching that direction are considered.
//   Falls back to best aligned template if no constrained templates exist.
// ============================================================================

import type { AtrZone, Direction } from '../types/domain.js';

export interface HistoricalTradeForProfiling {
  market: string;
  direction: Direction;
  entryZone: AtrZone | null;
  resultR: number | null;
  triggered: boolean;
}

export interface TemplateProfile {
  market: string;
  direction: Direction;
  entryZone: AtrZone | null;
  trades: number;
  avgR: number;
  winRate: number;
  triggerRate: number;
  templateQuality: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface SelectBestTemplateOutput {
  templateSource: 'historical_template' | 'fallback';
  direction: Direction;
  preferredEntryZone: AtrZone;
  templateAvgR: number;
  templateWinRate: number | null;
  templateTrades: number;
  templateQuality: 'HIGH' | 'MEDIUM' | 'LOW';
}

const HIGH_CONFIDENCE_MIN_TRADES = 50;
const MEDIUM_CONFIDENCE_MIN_TRADES = 20;
const MIN_TEMPLATE_TRADES = 10;

// Valid preferred zones per direction -- TOO_DEEP/TOO_HIGH excluded (low trigger probability)
const BUY_ZONES  = new Set<AtrZone | null>(['ZONE_1', 'ZONE_2', 'TOO_DEEP'])
const SELL_ZONES = new Set<AtrZone | null>(['ZONE_3', 'ZONE_4', 'TOO_HIGH'])

// Output zone clamping -- preferred entry zone must be ZONE_1-4 per spec
function clampToValidZone(zone: AtrZone | null, direction: Direction): AtrZone {
  if (zone === 'TOO_DEEP') return 'ZONE_1'
  if (zone === 'TOO_HIGH') return 'ZONE_4'
  if (zone === null) return direction === 'BUY' ? 'ZONE_1' : 'ZONE_4'
  return zone
}

function isZoneAligned(direction: Direction, entryZone: AtrZone | null): boolean {
  if (entryZone === null) return false
  if (direction === 'BUY')  return BUY_ZONES.has(entryZone)
  if (direction === 'SELL') return SELL_ZONES.has(entryZone)
  return true
}

function groupKey(market: string, direction: Direction, entryZone: AtrZone | null): string {
  return `${market}\u0000${direction}\u0000${entryZone ?? '\u0000NULL\u0000'}`;
}

export function buildTemplateProfiles(trades: HistoricalTradeForProfiling[]): TemplateProfile[] {
  if (trades.length === 0) return [];

  const groups = new Map<string, HistoricalTradeForProfiling[]>();
  for (const trade of trades) {
    const key = groupKey(trade.market, trade.direction, trade.entryZone);
    const existing = groups.get(key);
    if (existing) existing.push(trade);
    else groups.set(key, [trade]);
  }

  const profiles: TemplateProfile[] = [];
  for (const groupTrades of groups.values()) {
    const first = groupTrades[0]!;
    const tradesCount = groupTrades.length;
    const nonNullResults = groupTrades.map((t) => t.resultR).filter((r): r is number => r !== null);
    const avgR = nonNullResults.length > 0
      ? nonNullResults.reduce((a, v) => a + v, 0) / nonNullResults.length
      : NaN;
    const wins = groupTrades.filter((t) => (t.resultR ?? NaN) > 0).length;
    const winRate = wins / tradesCount;
    const triggerRate = groupTrades.filter((t) => t.triggered).length / tradesCount;
    const templateQuality: 'HIGH' | 'MEDIUM' | 'LOW' =
      tradesCount >= HIGH_CONFIDENCE_MIN_TRADES && avgR > 0 ? 'HIGH'
      : tradesCount >= MEDIUM_CONFIDENCE_MIN_TRADES && avgR > 0 ? 'MEDIUM'
      : 'LOW';
    profiles.push({
      market: first.market, direction: first.direction, entryZone: first.entryZone,
      trades: tradesCount, avgR, winRate, triggerRate, templateQuality,
    });
  }

  return profiles;
}

export function selectBestTemplate(
  market: string,
  templates: TemplateProfile[],
  preferredDirection?: Direction | null,
): SelectBestTemplateOutput {
  const subset = templates.filter((t) => t.market === market && t.trades >= MIN_TEMPLATE_TRADES);

  if (subset.length === 0) {
    const dir = preferredDirection ?? 'BUY'
    return {
      templateSource: 'fallback', direction: dir, preferredEntryZone: dir === 'BUY' ? 'ZONE_1' : 'ZONE_4',
      templateAvgR: 0, templateWinRate: null, templateTrades: 0, templateQuality: 'LOW',
    };
  }

  // Direction constraint: if caller provides preferredDirection (from regime/zone),
  // only consider templates matching that direction.
  // Falls back to all aligned templates if constraint yields nothing.
  const directionFiltered = preferredDirection
    ? subset.filter(t => t.direction === preferredDirection)
    : subset

  // Zone alignment filter only applies when a direction constraint is active.
  // Without preferredDirection, avgR is the sole selection criterion --
  // the alignment insight belongs in coaching, not as a hard template discard.
  const candidates = preferredDirection
    ? (directionFiltered.length > 0
        ? directionFiltered.filter(t => isZoneAligned(t.direction, t.entryZone)).length > 0
          ? directionFiltered.filter(t => isZoneAligned(t.direction, t.entryZone))
          : directionFiltered
        : subset)
    : directionFiltered.length > 0
      ? directionFiltered
      : subset

  function compareDesc(a: number, b: number): number {
    const aIsNaN = Number.isNaN(a), bIsNaN = Number.isNaN(b);
    if (aIsNaN && bIsNaN) return 0;
    if (aIsNaN) return 1;
    if (bIsNaN) return -1;
    return b - a;
  }

  const sorted = [...candidates].sort((a, b) => {
    const avgRCmp = compareDesc(a.avgR, b.avgR);
    if (avgRCmp !== 0) return avgRCmp;
    if (b.trades !== a.trades) return b.trades - a.trades;
    return compareDesc(a.winRate, b.winRate);
  });

  const best = sorted[0]!;

  return {
    templateSource: 'historical_template',
    direction: best.direction,
    // Clamp output zone to ZONE_1-4 -- TOO_DEEP/TOO_HIGH have low trigger probability
    preferredEntryZone: clampToValidZone(best.entryZone, best.direction),
    templateAvgR: best.avgR,
    templateWinRate: best.winRate,
    templateTrades: best.trades,
    templateQuality: best.templateQuality,
  };
}
