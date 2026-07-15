import { describe, it, expect } from 'vitest';
import { assessOpportunity } from '../services/opportunityService.js';
import type { MarketStateOutput } from '../services/marketStateService.js';

describe('assessOpportunity', () => {
  it('always returns hasOpportunity: true in v1, regardless of market state quality', () => {
    const degraded: MarketStateOutput = {
      marketId: 'TEST', atr14: null, atr20: null, lowerBand: null, zone1Top: null, zone2Top: null,
      zone3Top: null, upperBand: null, currentZone: null, currentPrice: 1.10,
      stateGeneratedAt: '2026-01-01T00:00:00Z',
    };
    const result = assessOpportunity({ marketState: degraded });
    expect(result.hasOpportunity).toBe(true);
    expect(result.qualityScore).toBeNull();
    expect(result.noRecommendationReason).toBeNull();
  });
});


