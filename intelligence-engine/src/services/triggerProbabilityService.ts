// ============================================================================
// TriggerProbabilityService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 9 (estimate_trigger_probability)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.2.md Section 3.7
// ============================================================================

import type { AtrZone, Direction } from '../types/domain.js';
import type { HistoricalTradeForProfiling } from './templateService.js';

export interface TriggerProbabilityInput {
  market: string;
  direction: Direction;
  zone: AtrZone;
  trades: HistoricalTradeForProfiling[];
  minTriggerSample: number;        // 20, from model_parameters
  fallbackProbability: number;     // 0.50, from model_parameters
}

export type TriggerSource = 'exact_history' | 'market_zone_history' | 'fallback';

export interface TriggerProbabilityOutput {
  triggerProbability: number;
  triggerSample: number;
  triggerSource: TriggerSource;
}

export function estimateTriggerProbability(input: TriggerProbabilityInput): TriggerProbabilityOutput {
  const { market, direction, zone, trades, minTriggerSample, fallbackProbability } = input;

  if (trades.length === 0) {
    return { triggerProbability: fallbackProbability, triggerSample: 0, triggerSource: 'fallback' };
  }

  const exact = trades.filter((t) => t.market === market && t.direction === direction && t.entryZone === zone);
  if (exact.length >= minTriggerSample) {
    const triggeredCount = exact.filter((t) => t.triggered).length;
    return { triggerProbability: triggeredCount / exact.length, triggerSample: exact.length, triggerSource: 'exact_history' };
  }

  const marketZone = trades.filter((t) => t.market === market && t.entryZone === zone);
  if (marketZone.length >= minTriggerSample) {
    const triggeredCount = marketZone.filter((t) => t.triggered).length;
    return { triggerProbability: triggeredCount / marketZone.length, triggerSample: marketZone.length, triggerSource: 'market_zone_history' };
  }

  // Fallback: triggerSample reports the EXACT-tier count, not market_zone's
  // and not 0 -- this is the notebook's actual behaviour (int(len(exact))
  // in the final return, even after falling through both tiers), not an
  // oversight to "improve" by reporting 0 or the market_zone count instead.
  return { triggerProbability: fallbackProbability, triggerSample: exact.length, triggerSource: 'fallback' };
}
