// ============================================================================
// RecommendationLifecycleService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 10 (assess_condition)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.3.md Section 3.10
// ============================================================================
// Re-verified against the exact notebook source for this step -- matches
// what V1.3 Section 3.10 already documented, no correction needed here.

import { type ImplementedValidityState, assertImplementedState } from '../types/domain.js';

export interface AssessConditionInput {
  currentPrice: number | null;
  priceAtGeneration: number;
  zoneAtGeneration: string;
  currentZone: string | null;
  atr14: number | null;
  staleAtrThreshold: number;       // 0.25, from model_parameters
  forceRecalcAtrThreshold: number; // 0.50, from model_parameters
}

export interface AssessConditionOutput {
  recommendationValidityStatus: ImplementedValidityState;
  requiresRefresh: boolean;
  volatilityWarning: string;
  atrMoveSinceGeneration: number | null;
}

export function assessCondition(input: AssessConditionInput): AssessConditionOutput {
  const { currentPrice, priceAtGeneration, zoneAtGeneration, currentZone, atr14, staleAtrThreshold, forceRecalcAtrThreshold } = input;

  if (currentPrice === null || Number.isNaN(currentPrice) || priceAtGeneration === null || Number.isNaN(priceAtGeneration)
      || atr14 === null || Number.isNaN(atr14) || atr14 <= 0) {
    const status = 'DO_NOT_USE_RECALCULATE';
    assertImplementedState(status);
    return {
      recommendationValidityStatus: status, requiresRefresh: true,
      volatilityWarning: 'Current data incomplete. Refresh before use.',
      atrMoveSinceGeneration: null,
    };
  }

  const atrMove = Math.abs(currentPrice - priceAtGeneration) / atr14;

  if (zoneAtGeneration !== currentZone) {
    const status = 'ZONE_CHANGED';
    assertImplementedState(status);
    return {
      recommendationValidityStatus: status, requiresRefresh: true,
      volatilityWarning: 'Market zone changed since recommendation generation.',
      atrMoveSinceGeneration: atrMove,
    };
  }

  if (atrMove >= forceRecalcAtrThreshold) {
    const status = 'DO_NOT_USE_RECALCULATE';
    assertImplementedState(status);
    return {
      recommendationValidityStatus: status, requiresRefresh: true,
      volatilityWarning: 'Market moved materially. Recalculate before use.',
      atrMoveSinceGeneration: atrMove,
    };
  }

  if (atrMove >= staleAtrThreshold) {
    const status = 'STALE_PRICE';
    assertImplementedState(status);
    return {
      recommendationValidityStatus: status, requiresRefresh: true,
      volatilityWarning: 'Market has moved since generation. Treat levels with caution.',
      atrMoveSinceGeneration: atrMove,
    };
  }

  const status = 'VALID';
  assertImplementedState(status);
  return { recommendationValidityStatus: status, requiresRefresh: false, volatilityWarning: '', atrMoveSinceGeneration: atrMove };
}
