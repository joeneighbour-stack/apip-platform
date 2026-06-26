// ============================================================================
// OpportunityService
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.3.md Section 1.4 / 3.9
// ============================================================================
// Per Amendment 1: this is a permanent, documented extension point, NOT a
// temporary pass-through to be deleted later. The notebook's
// build_recommendations always produces a recommendation for every market
// in market_state -- there is no rejection path. Future qualification rules
// (minimum expected R, minimum trigger probability, event-risk suppression,
// volatility suppression, market quality scoring, regime suitability) each
// require their own research validation before being added here -- see the
// V1.3 changelog's reasoning for why this stays trivial in v1.

import type { MarketStateOutput } from './marketStateService.js';

export interface OpportunityInput {
  marketState: MarketStateOutput;
}

export interface OpportunityOutput {
  hasOpportunity: true; // v1: always true, literal type not boolean -- see header note
  qualityScore: null;   // reserved for a future research-validated qualification rule
  noRecommendationReason: null; // reserved
}

export function assessOpportunity(_input: OpportunityInput): OpportunityOutput {
  return { hasOpportunity: true, qualityScore: null, noRecommendationReason: null };
}
