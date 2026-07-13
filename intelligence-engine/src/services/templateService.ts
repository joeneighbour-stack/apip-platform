// ============================================================================
// TemplateService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 8 (build_template_profiles)
//          and cell 9 (select_best_template)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md Section 3.4
// ============================================================================
// CORRECTION TO V1.1 ARCHITECTURE DOCUMENT, found by re-reading the actual
// notebook source rather than relying on an earlier summary:
//   1. min_template_trades is 10, not 20 as V1.1 Section 3.4 stated.
//   2. template_quality requires BOTH a trade-count threshold AND avg_r > 0
//      -- not trade count alone. A profile with 500 trades and avg_r <= 0
//      is LOW quality, not HIGH.
//   3. NULL-zone trades are NOT excluded from grouping (resolves the open
//      question in V1.1 Section 12 item 1) -- they form their own group
//      (entryZone: null), and if THAT group wins selection, the OUTPUT zone
//      defaults to ZONE_1 (notebook: 'Zone 1') rather than propagating null.
// These need a V1.2 architecture amendment; flagged here so the code is
// correct now rather than waiting for the document to catch up.
//
// ZONE/DIRECTION ALIGNMENT (V1.3 amendment):
//   BUY  entries must be in low zones  (ZONE_1, ZONE_2, TOO_DEEP).
//   SELL entries must be in high zones (ZONE_3, ZONE_4, TOO_HIGH).
//   This enforces the ATR band principle: buy cheap in the lower band,
//   sell expensive in the upper band. The template selector filters to
//   aligned templates first; if no aligned templates meet MIN_TEMPLATE_TRADES,
//   it falls back to the unfiltered subset (preserving existing fallback
//   behaviour rather than producing a hard error). This is a product decision,
//   not a notebook deviation -- the notebook never considers countertrend zone
//   setups because its backtest data was already zone-filtered at source.
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
  avgR: number;   // can be NaN if every trade in the group has resultR === null -- matches pandas mean() skipna semantics
  winRate: number; // always a real number in [0,1] -- never NaN (see note in buildTemplateProfiles)
  triggerRate: number;
  templateQuality: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface SelectBestTemplateOutput {
  templateSource: 'historical_template' | 'fallback';
  direction: Direction;
  preferredEntryZone: AtrZone;
  templateAvgR: number;
  templateWinRate: number | null; // null only in the fallback case
  templateTrades: number;
  templateQuality: 'HIGH' | 'MEDIUM' | 'LOW';
}

const HIGH_CONFIDENCE_MIN_TRADES = 50;
const MEDIUM_CONFIDENCE_MIN_TRADES = 20;
const MIN_TEMPLATE_TRADES = 10;

// Zone/direction alignment sets -- BUY entries in low zones, SELL in high zones
const BUY_ZONES  = new Set<AtrZone | null>(['ZONE_1', 'ZONE_2', 'TOO_DEEP'])
const SELL_ZONES = new Set<AtrZone | null>(['ZONE_3', 'ZONE_4', 'TOO_HIGH'])

function isZoneAligned(direction: Direction, entryZone: AtrZone | null): boolean {
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

    // avgR: arithmetic mean of resultR, SKIPPING null values (pandas mean()
    // default skipna=True). If every trade in the group has resultR===null,
    // this is NaN -- not 0, not null -- matching pandas exactly. A NaN here
    // correctly fails the `avgR > 0` quality check below (NaN > 0 is false
    // in both JS and pandas), so this does not need special-casing further.
    const nonNullResults = groupTrades.map((t) => t.resultR).filter((r): r is number => r !== null);
    const avgR = nonNullResults.length > 0
      ? nonNullResults.reduce((a, v) => a + v, 0) / nonNullResults.length
      : NaN;

    // winRate: mean of (resultR > 0), where a null resultR contributes
    // `false` (0), not NaN -- pandas comparison operators with NaN always
    // yield False, unlike arithmetic which propagates NaN. This is why
    // winRate, unlike avgR, is always a real number, never NaN.
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

export function selectBestTemplate(market: string, templates: TemplateProfile[]): SelectBestTemplateOutput {
  const subset = templates.filter((t) => t.market === market && t.trades >= MIN_TEMPLATE_TRADES);

  if (subset.length === 0) {
    return {
      templateSource: 'fallback', direction: 'BUY', preferredEntryZone: 'ZONE_1',
      templateAvgR: 0, templateWinRate: null, templateTrades: 0, templateQuality: 'LOW',
    };
  }

  // Zone/direction alignment filter: BUY→low zones, SELL→high zones.
  // Falls back to unfiltered subset if no aligned templates meet the trade count
  // threshold -- preserves existing fallback behaviour rather than hard erroring.
  const aligned = subset.filter((t) => isZoneAligned(t.direction, t.entryZone))
  const candidates = aligned.length > 0 ? aligned : subset

  // Exact notebook sort: avg_r desc, trades desc, win_rate desc.
  // pandas sort_values places NaN LAST regardless of ascending/descending
  // direction (na_position='last' default) -- a naive `b.avgR - a.avgR`
  // comparator produces NaN when either side is NaN, and Array.sort's
  // behaviour with a NaN-returning comparator is undefined by spec, not
  // just "probably fine". Handled explicitly here instead.
  function compareDesc(a: number, b: number): number {
    const aIsNaN = Number.isNaN(a), bIsNaN = Number.isNaN(b);
    if (aIsNaN && bIsNaN) return 0;
    if (aIsNaN) return 1;  // a (NaN) sorts after b
    if (bIsNaN) return -1; // b (NaN) sorts after a
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
    // If the winning group's entryZone is null (the unknown-zone pool),
    // default to ZONE_1 -- matches notebook exactly, does not propagate null.
    preferredEntryZone: best.entryZone ?? 'ZONE_1',
    templateAvgR: best.avgR,
    templateWinRate: best.winRate,
    templateTrades: best.trades,
    templateQuality: best.templateQuality,
  };
}
