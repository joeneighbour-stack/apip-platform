import { describe, it, expect } from 'vitest';
import { zoneBounds, buildEntryOptimizer } from '../services/entryOptimizerService.js';
import type { MarketStateOutput } from '../services/marketStateService.js';

function marketState(overrides: Partial<MarketStateOutput> = {}): MarketStateOutput {
  return {
    marketId: 'TEST', atr14: 0.02,
    lowerBand: 1.08, zone1Top: 1.085, zone2Top: 1.09, zone3Top: 1.095, upperBand: 1.10,
    currentZone: 'ZONE_2', currentPrice: 1.0875, stateGeneratedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('zoneBounds', () => {
  it('maps ZONE_1 through ZONE_4 to the correct band segments', () => {
    const ms = marketState();
    expect(zoneBounds(ms, 'ZONE_1')).toEqual([1.08, 1.085]);
    expect(zoneBounds(ms, 'ZONE_2')).toEqual([1.085, 1.09]);
    expect(zoneBounds(ms, 'ZONE_3')).toEqual([1.09, 1.095]);
    expect(zoneBounds(ms, 'ZONE_4')).toEqual([1.095, 1.10]);
  });

  it('clamps TOO_DEEP to ZONE_1 bounds and TOO_HIGH to ZONE_4 bounds -- approved departure from the notebook (which leaves these undefined), so every recommendation publishes a real, usable range', () => {
    const ms = marketState();
    expect(zoneBounds(ms, 'TOO_DEEP')).toEqual(zoneBounds(ms, 'ZONE_1'));
    expect(zoneBounds(ms, 'TOO_HIGH')).toEqual(zoneBounds(ms, 'ZONE_4'));
  });
});

describe('buildEntryOptimizer', () => {
  it('produces a real entry range and RR exactly equal to minimumRr for a valid ZONE_2 case', () => {
    const result = buildEntryOptimizer({
      marketState: marketState(), direction: 'BUY', preferredZone: 'ZONE_2', minimumRr: 2.0,
    });
    expect(result.entryRangeLow).toBeCloseTo(1.085, 10);
    expect(result.entryRangeHigh).toBeCloseTo(1.09, 10);
    expect(result.entryMid).toBeCloseTo(1.0875, 10);
    // RR is constructed, not measured -- must equal minimumRr exactly (within float tolerance).
    expect(result.rr).toBeCloseTo(2.0, 9);
  });

  it('produces a real, usable entry range for TOO_DEEP/TOO_HIGH (clamped, not NaN) -- approved departure from the notebook', () => {
    const result = buildEntryOptimizer({
      marketState: marketState(), direction: 'BUY', preferredZone: 'TOO_DEEP', minimumRr: 2.0,
    });
    expect(Number.isNaN(result.entryMid)).toBe(false);
    expect(Number.isNaN(result.stop)).toBe(false);
    expect(Number.isNaN(result.target)).toBe(false);
    expect(result.rr).toBeCloseTo(2.0, 9);
  });

  it('produces NaN stop/target/rr when atr14 is null (insufficient history)', () => {
    const result = buildEntryOptimizer({
      marketState: marketState({ atr14: null }), direction: 'BUY', preferredZone: 'ZONE_2', minimumRr: 2.0,
    });
    // entry range itself still computes fine (depends on bands, not atr) --
    // only stop/target/rr depend on atr and should be NaN.
    expect(Number.isNaN(result.entryMid)).toBe(false);
    expect(Number.isNaN(result.stop)).toBe(true);
    expect(Number.isNaN(result.target)).toBe(true);
    expect(Number.isNaN(result.rr)).toBe(true);
  });

  it('produces NaN stop/target/rr when atr14 is zero or negative', () => {
    const result = buildEntryOptimizer({
      marketState: marketState({ atr14: 0 }), direction: 'BUY', preferredZone: 'ZONE_2', minimumRr: 2.0,
    });
    expect(Number.isNaN(result.stop)).toBe(true);
  });

  it('places the stop on the correct side for SELL (above entry, not below)', () => {
    const result = buildEntryOptimizer({
      marketState: marketState(), direction: 'SELL', preferredZone: 'ZONE_2', minimumRr: 2.0,
    });
    expect(result.stop).toBeGreaterThan(result.entryMid);
    expect(result.target).toBeLessThan(result.entryMid);
    expect(result.rr).toBeCloseTo(2.0, 9);
  });
});
