import { describe, it, expect } from 'vitest';
import { reassessRecommendationBatch, type ActiveRecommendationSnapshot } from '../services/recommendationReassessmentService.js';
import type { MarketStateOutput } from '../services/marketStateService.js';

function freshState(overrides: Partial<MarketStateOutput> = {}): MarketStateOutput {
  return {
    marketId: 'EURUSD', atr14: 0.02,
    lowerBand: 1.08, zone1Top: 1.085, zone2Top: 1.09,
    zone3Top: 1.095, upperBand: 1.10, currentZone: 'ZONE_2', currentPrice: 1.0875,
    stateGeneratedAt: '2026-01-16T08:00:00Z',
    ...overrides,
    atr20: overrides.atr20 !== undefined ? overrides.atr20 : (overrides.atr14 ?? null),
  };
}

function snapshot(overrides: Partial<ActiveRecommendationSnapshot> = {}): ActiveRecommendationSnapshot {
  return {
    recommendationVersionId: 'rv-1', opportunityId: '2026-01-15_EURUSD_EUROPEAN_v1',
    market: 'EURUSD', priceAtGeneration: 1.0875, zoneAtGeneration: 'ZONE_2',
    ...overrides,
  };
}

describe('reassessRecommendationBatch', () => {
  it('stays VALID, requiresRegeneration false, when nothing has moved since generation', () => {
    const result = reassessRecommendationBatch({
      recommendations: [snapshot()],
      currentMarketStates: new Map([['EURUSD', freshState()]]),
      staleAtrThreshold: 0.25, forceRecalcAtrThreshold: 0.50,
    });
    expect(result[0]!.recommendationValidityStatus).toBe('VALID');
    expect(result[0]!.requiresRegeneration).toBe(false);
  });

  it('THE KEY DISTINCTION FROM STEP 5: detects real drift against an independently-fetched fresh market state, not a trivial self-comparison', () => {
    // Generated at 1.0875/ZONE_2; market has genuinely moved to 1.10/ZONE_4 since.
    const result = reassessRecommendationBatch({
      recommendations: [snapshot({ priceAtGeneration: 1.0875, zoneAtGeneration: 'ZONE_2' })],
      currentMarketStates: new Map([['EURUSD', freshState({ currentPrice: 1.10, currentZone: 'ZONE_4' })]]),
      staleAtrThreshold: 0.25, forceRecalcAtrThreshold: 0.50,
    });
    expect(result[0]!.recommendationValidityStatus).toBe('ZONE_CHANGED');
  });

  it('sets requiresRegeneration true ONLY for DO_NOT_USE_RECALCULATE, not for ZONE_CHANGED or STALE_PRICE', () => {
    const zoneChanged = reassessRecommendationBatch({
      recommendations: [snapshot()],
      currentMarketStates: new Map([['EURUSD', freshState({ currentZone: 'ZONE_4' })]]),
      staleAtrThreshold: 0.25, forceRecalcAtrThreshold: 0.50,
    })[0]!;
    expect(zoneChanged.recommendationValidityStatus).toBe('ZONE_CHANGED');
    expect(zoneChanged.requiresRegeneration).toBe(false);

    // atrMove = |1.106 - 1.0875| / 0.02 = 0.925 -- well past forceRecalc (0.50)
    const doNotUse = reassessRecommendationBatch({
      recommendations: [snapshot()],
      currentMarketStates: new Map([['EURUSD', freshState({ currentPrice: 1.106 })]]),
      staleAtrThreshold: 0.25, forceRecalcAtrThreshold: 0.50,
    })[0]!;
    expect(doNotUse.recommendationValidityStatus).toBe('DO_NOT_USE_RECALCULATE');
    expect(doNotUse.requiresRegeneration).toBe(true);
  });

  it('treats a missing market state the same as missing data -- DO_NOT_USE_RECALCULATE via the existing guard, not a new special case', () => {
    const result = reassessRecommendationBatch({
      recommendations: [snapshot({ market: 'GBPUSD' })], // no entry for GBPUSD in the map
      currentMarketStates: new Map([['EURUSD', freshState()]]),
      staleAtrThreshold: 0.25, forceRecalcAtrThreshold: 0.50,
    });
    expect(result[0]!.recommendationValidityStatus).toBe('DO_NOT_USE_RECALCULATE');
    expect(result[0]!.requiresRegeneration).toBe(true);
  });

  it('processes a batch of recommendations across different markets independently', () => {
    const result = reassessRecommendationBatch({
      recommendations: [
        snapshot({ recommendationVersionId: 'rv-eurusd', market: 'EURUSD' }),
        snapshot({ recommendationVersionId: 'rv-gbpusd', market: 'GBPUSD', priceAtGeneration: 1.27, zoneAtGeneration: 'ZONE_2' }),
      ],
      currentMarketStates: new Map([
        ['EURUSD', freshState()], // unchanged -- VALID
        ['GBPUSD', freshState({ marketId: 'GBPUSD', currentPrice: 1.27, currentZone: 'ZONE_2' })], // also unchanged -- VALID
      ]),
      staleAtrThreshold: 0.25, forceRecalcAtrThreshold: 0.50,
    });
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.recommendationVersionId === 'rv-eurusd')!.recommendationValidityStatus).toBe('VALID');
    expect(result.find((r) => r.recommendationVersionId === 'rv-gbpusd')!.recommendationValidityStatus).toBe('VALID');
  });

  it('returns STALE_PRICE with requiresRefresh true but requiresRegeneration false for a moderate move', () => {
    // atrMove = |1.094 - 1.0875| / 0.02 = 0.325 -- past stale (0.25), below forceRecalc (0.50)
    const result = reassessRecommendationBatch({
      recommendations: [snapshot()],
      currentMarketStates: new Map([['EURUSD', freshState({ currentPrice: 1.094 })]]),
      staleAtrThreshold: 0.25, forceRecalcAtrThreshold: 0.50,
    })[0]!;
    expect(result.recommendationValidityStatus).toBe('STALE_PRICE');
    expect(result.requiresRefresh).toBe(true);
    expect(result.requiresRegeneration).toBe(false);
  });
});



