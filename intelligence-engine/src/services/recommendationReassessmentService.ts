// ============================================================================
// RecommendationLifecycleService -- periodic re-check (Step 6)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.5.md Section 5.1
// ============================================================================
// This is the SECOND of the two distinct trigger paths Section 5.1
// describes for assessCondition(). The first (Step 5, already built) runs
// inline at generation time and trivially compares a market state snapshot
// against itself -- always VALID in practice. THIS is where real drift
// detection actually happens: re-running assessCondition() for every
// currently-active recommendation against an INDEPENDENTLY, FRESHLY fetched
// MarketStateOutput, not the snapshot stored at generation time.
//
// Pure function, no I/O, no database writes -- consistent with every other
// service in this engine. The caller (Phase 1.3's EngineOrchestrationService,
// not yet built in this package) is responsible for: fetching the batch of
// active recommendations and fresh market states, calling this function,
// and acting on its output (persisting the updated validity fields, and
// triggering RecommendationService again for any recommendation flagged
// requiresRegeneration).

import type { AtrZone, ImplementedValidityState } from '../types/domain.js';
import type { MarketStateOutput } from './marketStateService.js';
import { assessCondition } from './recommendationLifecycleService.js';

export interface ActiveRecommendationSnapshot {
  recommendationVersionId: string;
  opportunityId: string;
  market: string;
  priceAtGeneration: number;
  zoneAtGeneration: AtrZone | null;
}

export interface ReassessmentResult {
  recommendationVersionId: string;
  recommendationValidityStatus: ImplementedValidityState;
  requiresRefresh: boolean;
  volatilityWarning: string;
  atrMoveSinceGeneration: number | null;
  /**
   * True iff recommendationValidityStatus === 'DO_NOT_USE_RECALCULATE'.
   * Per Architecture Section 5.1, this is specifically the trigger for
   * calling RecommendationService again to produce version N+1 -- NOT
   * the broader requiresRefresh flag, which is also true for STALE_PRICE
   * and ZONE_CHANGED (which warrant caution, not outright regeneration).
   */
  requiresRegeneration: boolean;
}

export interface ReassessRecommendationBatchInput {
  recommendations: ActiveRecommendationSnapshot[];
  /** Fresh market states, keyed by market symbol. A recommendation whose
   * market has no entry here is treated the same as missing/incomplete
   * data in assessCondition's own existing guard (currentPrice/atr14 both
   * null) -- correctly falling through to DO_NOT_USE_RECALCULATE via logic
   * that already exists, rather than a new special case invented here. */
  currentMarketStates: Map<string, MarketStateOutput>;
  staleAtrThreshold: number;
  forceRecalcAtrThreshold: number;
}

export function reassessRecommendationBatch(input: ReassessRecommendationBatchInput): ReassessmentResult[] {
  const { recommendations, currentMarketStates, staleAtrThreshold, forceRecalcAtrThreshold } = input;

  return recommendations.map((rec) => {
    const freshState = currentMarketStates.get(rec.market);

    const condition = assessCondition({
      currentPrice: freshState?.currentPrice ?? null,
      priceAtGeneration: rec.priceAtGeneration,
      zoneAtGeneration: rec.zoneAtGeneration ?? '',
      currentZone: freshState?.currentZone ?? null,
      atr14: freshState?.atr14 ?? null,
      staleAtrThreshold, forceRecalcAtrThreshold,
    });

    return {
      recommendationVersionId: rec.recommendationVersionId,
      recommendationValidityStatus: condition.recommendationValidityStatus,
      requiresRefresh: condition.requiresRefresh,
      volatilityWarning: condition.volatilityWarning,
      atrMoveSinceGeneration: condition.atrMoveSinceGeneration,
      requiresRegeneration: condition.recommendationValidityStatus === 'DO_NOT_USE_RECALCULATE',
    };
  });
}
