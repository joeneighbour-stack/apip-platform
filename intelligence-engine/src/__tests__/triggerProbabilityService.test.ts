import { describe, it, expect } from 'vitest';
import { estimateTriggerProbability } from '../services/triggerProbabilityService.js';
import type { HistoricalTradeForProfiling } from '../services/templateService.js';

function trade(overrides: Partial<HistoricalTradeForProfiling> = {}): HistoricalTradeForProfiling {
  return { market: 'EURUSD', direction: 'BUY', entryZone: 'ZONE_2', resultR: 1, triggered: true, ...overrides };
}

describe('estimateTriggerProbability', () => {
  it('returns the fallback with triggerSample 0 when trades is empty', () => {
    const result = estimateTriggerProbability({
      market: 'EURUSD', direction: 'BUY', zone: 'ZONE_2', trades: [],
      minTriggerSample: 20, fallbackProbability: 0.5,
    });
    expect(result).toEqual({ triggerProbability: 0.5, triggerSample: 0, triggerSource: 'fallback' });
  });

  it('uses exact_history when the exact (market, direction, zone) sample meets the floor', () => {
    const trades = [
      ...Array.from({ length: 15 }, () => trade({ triggered: true })),
      ...Array.from({ length: 5 }, () => trade({ triggered: false })),
    ]; // 20 total, exactly at the floor
    const result = estimateTriggerProbability({
      market: 'EURUSD', direction: 'BUY', zone: 'ZONE_2', trades,
      minTriggerSample: 20, fallbackProbability: 0.5,
    });
    expect(result.triggerSource).toBe('exact_history');
    expect(result.triggerSample).toBe(20);
    expect(result.triggerProbability).toBeCloseTo(0.75, 10);
  });

  it('broadens to market_zone_history when exact sample is below the floor but market+zone (any direction) meets it', () => {
    const trades = [
      ...Array.from({ length: 5 }, () => trade({ direction: 'BUY', triggered: true })),   // exact tier: only 5, below floor
      ...Array.from({ length: 20 }, () => trade({ direction: 'SELL', triggered: true })), // same market+zone, different direction
    ];
    const result = estimateTriggerProbability({
      market: 'EURUSD', direction: 'BUY', zone: 'ZONE_2', trades,
      minTriggerSample: 20, fallbackProbability: 0.5,
    });
    expect(result.triggerSource).toBe('market_zone_history');
    expect(result.triggerSample).toBe(25); // 5 + 20, all market+zone regardless of direction
  });

  it('falls back to the fixed probability when neither tier meets the floor, but reports the EXACT-tier count, not 0 or the market_zone count', () => {
    const trades = [
      ...Array.from({ length: 3 }, () => trade({ direction: 'BUY' })),  // exact tier: 3
      ...Array.from({ length: 8 }, () => trade({ direction: 'SELL' })), // market_zone tier: 3+8=11, still below 20
    ];
    const result = estimateTriggerProbability({
      market: 'EURUSD', direction: 'BUY', zone: 'ZONE_2', trades,
      minTriggerSample: 20, fallbackProbability: 0.5,
    });
    expect(result.triggerSource).toBe('fallback');
    expect(result.triggerProbability).toBe(0.5);
    // This is the subtle one: notebook reports len(exact) = 3 here, NOT 0
    // and NOT 11 (the market_zone count) -- replicated exactly.
    expect(result.triggerSample).toBe(3);
  });
});
