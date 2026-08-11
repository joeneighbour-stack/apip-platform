// ============================================================================
// TriggerProbabilityService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 9 (estimate_trigger_probability)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.2.md Section 3.7
// ============================================================================
// Two-factor model: analyst KPI baseline x zone distance multiplier.
// Replaces the old actual_trades.triggered-based history calculation --
// MANUAL_BACKFILL only ever contains trades that DID trigger (100% by
// construction), so exact/market_zone history tiers were computing a
// meaningless rate off backfill-dominated data.

import type { AtrZone, Direction } from '../types/domain.js';

export interface TriggerProbabilityInput {
  analystBaseRate: number;        // from executive_kpis triggered_rate
  currentZone: AtrZone | null;    // where price is now
  preferredZone: AtrZone | null;  // where entry is
  direction: Direction;
  fallbackRate: number;           // used when no analyst rate is available
}

export type TriggerSource = 'analyst_kpi_zone_adjusted' | 'analyst_kpi_fallback';

export interface TriggerProbabilityOutput {
  triggerProbability: number;
  triggerSample: number;
  triggerSource: TriggerSource;
}

const ZONE_ORDER: AtrZone[] = ['TOO_DEEP', 'ZONE_1', 'ZONE_2', 'ZONE_3', 'ZONE_4', 'TOO_HIGH'];

function zoneDistance(current: AtrZone, preferred: AtrZone): number {
  const ci = ZONE_ORDER.indexOf(current);
  const pi = ZONE_ORDER.indexOf(preferred);
  if (ci === -1 || pi === -1) return 2; // unknown -- treat as moderate distance
  return Math.abs(ci - pi);
}

function zoneMultiplier(distance: number): number {
  if (distance === 0) return 1.3; // at entry zone
  if (distance === 1) return 1.0; // one zone away -- near entry
  if (distance === 2) return 0.7; // two zones away -- needs meaningful move
  return 0.4;                     // three+ zones away -- extended
}

export function estimateTriggerProbability(input: TriggerProbabilityInput): TriggerProbabilityOutput {
  const { analystBaseRate, currentZone, preferredZone, fallbackRate } = input;

  const baseRate = analystBaseRate > 0 ? analystBaseRate : fallbackRate;

  if (!currentZone || !preferredZone) {
    return { triggerProbability: baseRate, triggerSample: 0, triggerSource: 'analyst_kpi_fallback' };
  }

  const distance = zoneDistance(currentZone, preferredZone);
  const multiplier = zoneMultiplier(distance);
  const adjusted = Math.min(0.95, Math.max(0.02, baseRate * multiplier));

  return { triggerProbability: adjusted, triggerSample: 0, triggerSource: 'analyst_kpi_zone_adjusted' };
}
