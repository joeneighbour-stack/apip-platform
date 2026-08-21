import { describe, it, expect } from 'vitest';
import { zoneBounds, selectEntryZone, buildEntryOptimizer } from '../services/entryOptimizerService.js';
import type { MarketStateOutput } from '../services/marketStateService.js';

function marketState(overrides: Partial<MarketStateOutput> = {}): MarketStateOutput {
  return {
    marketId: 'TEST', atr14: 0.02,
    lowerBand: 1.08, zone1Top: 1.085, zone2Top: 1.09, zone3Top: 1.095, upperBand: 1.10,
    currentZone: 'ZONE_2', currentPrice: 1.0875, stateGeneratedAt: '2026-01-01T00:00:00Z',
    ...overrides,
    atr20: overrides.atr20 !== undefined ? overrides.atr20 : (overrides.atr14 ?? null),
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

describe('selectEntryZone', () => {
  it('BUY: prefers ZONE_2 when trend-aligned (TRENDING_UP), ZONE_1 otherwise', () => {
    expect(selectEntryZone('BUY', 'TRENDING_UP')).toBe('ZONE_2');
    expect(selectEntryZone('BUY', 'TRENDING_DOWN')).toBe('ZONE_1');
    expect(selectEntryZone('BUY', 'RANGE')).toBe('ZONE_1');
    expect(selectEntryZone('BUY', 'MIXED')).toBe('ZONE_1');
    expect(selectEntryZone('BUY', null)).toBe('ZONE_1');
  });

  it('SELL: prefers ZONE_3 when trend-aligned (TRENDING_DOWN), ZONE_4 otherwise', () => {
    expect(selectEntryZone('SELL', 'TRENDING_DOWN')).toBe('ZONE_3');
    expect(selectEntryZone('SELL', 'TRENDING_UP')).toBe('ZONE_4');
    expect(selectEntryZone('SELL', 'RANGE')).toBe('ZONE_4');
    expect(selectEntryZone('SELL', 'MIXED')).toBe('ZONE_4');
    expect(selectEntryZone('SELL', null)).toBe('ZONE_4');
  });
});

// Default marketState(): lowerBand=1.08, upperBand=1.10 -> zone width
// (step = (upperBand - lowerBand) / 4) = 0.005.
describe('buildEntryOptimizer', () => {
  it('stop sits exactly one zone width outside the OPPOSITE band boundary, for both directions', () => {
    const buy = buildEntryOptimizer({ marketState: marketState(), direction: 'BUY', minimumRr: 2.0, trendState: 'RANGE', sessionHigh: null, sessionLow: null });
    const sell = buildEntryOptimizer({ marketState: marketState(), direction: 'SELL', minimumRr: 2.0, trendState: 'RANGE', sessionHigh: null, sessionLow: null });
    expect(buy.stop).toBeCloseTo(1.08 - 0.005, 10); // lowerBand - step
    expect(sell.stop).toBeCloseTo(1.10 + 0.005, 10); // upperBand + step
  });

  it('BUY + RANGE: selects ZONE_1, entry at the zone midpoint -- natural target distance still clears the 2:1 floor, so target is untouched', () => {
    const result = buildEntryOptimizer({
      marketState: marketState(), direction: 'BUY', minimumRr: 2.0, trendState: 'RANGE',
      sessionHigh: null, sessionLow: null,
    });
    expect(result.preferredZone).toBe('ZONE_1');
    expect(result.entryPrice).toBeCloseTo(1.0825, 10); // zone midpoint: (1.08 + 1.085) / 2
    expect(result.stop).toBeCloseTo(1.075, 10); // lowerBand - step
    expect(result.target).toBeCloseTo(1.10, 10); // natural target = upperBand, never expanded here
    expect(result.rr).toBeCloseTo(7 / 3, 9); // stopDistance 0.0075, targetDistance 0.0175
  });

  it('SELL + RANGE: selects ZONE_4, entry at the zone midpoint -- same natural RR, mirrored', () => {
    const result = buildEntryOptimizer({
      marketState: marketState(), direction: 'SELL', minimumRr: 2.0, trendState: 'RANGE',
      sessionHigh: null, sessionLow: null,
    });
    expect(result.preferredZone).toBe('ZONE_4');
    expect(result.entryPrice).toBeCloseTo(1.0975, 10); // zone midpoint: (1.095 + 1.10) / 2
    expect(result.stop).toBeGreaterThan(result.entryPrice);
    expect(result.stop).toBeCloseTo(1.105, 10); // upperBand + step
    expect(result.target).toBeLessThan(result.entryPrice);
    expect(result.target).toBeCloseTo(1.08, 10); // natural target = lowerBand
    expect(result.rr).toBeCloseTo(7 / 3, 9); // stopDistance 0.0075, targetDistance 0.0175
  });

  it('BUY + TRENDING_UP: selects ZONE_2 -- natural RR is below the 2:1 floor, so target expands to exactly minimumRr x stop distance', () => {
    const result = buildEntryOptimizer({
      marketState: marketState(), direction: 'BUY', minimumRr: 2.0, trendState: 'TRENDING_UP',
      sessionHigh: null, sessionLow: null,
    });
    expect(result.preferredZone).toBe('ZONE_2');
    expect(result.entryRangeLow).toBeCloseTo(1.085, 10);
    expect(result.entryRangeHigh).toBeCloseTo(1.09, 10);
    expect(result.entryMid).toBeCloseTo(1.0875, 10);
    expect(result.entryPrice).toBeCloseTo(1.0875, 10); // entry is the zone midpoint
    expect(result.stop).toBeCloseTo(1.075, 10); // lowerBand - step, same as ZONE_1 -- stop only depends on the band, not the zone
    // stopDistance = 0.0125, natural targetDistance = 0.0125 (< 2*0.0125 = 0.025) -> expand
    expect(result.target).toBeCloseTo(1.1125, 10); // entryPrice + 2.0 * stopDistance -- beyond the band, by design
    expect(result.rr).toBeCloseTo(2.0, 9);
  });

  it('SELL + TRENDING_DOWN: selects ZONE_3 -- same expansion, mirrored', () => {
    const result = buildEntryOptimizer({
      marketState: marketState(), direction: 'SELL', minimumRr: 2.0, trendState: 'TRENDING_DOWN',
      sessionHigh: null, sessionLow: null,
    });
    expect(result.preferredZone).toBe('ZONE_3');
    expect(result.entryPrice).toBeCloseTo(1.0925, 10); // zone midpoint: (1.09 + 1.095) / 2
    expect(result.stop).toBeCloseTo(1.105, 10); // upperBand + step
    expect(result.target).toBeCloseTo(1.0675, 10); // entryPrice - 2.0 * stopDistance
    expect(result.rr).toBeCloseTo(2.0, 9);
  });

  it('no longer caps the expanded target -- the RR floor can push arbitrarily far now that the old 1.5xATR20 cap is gone', () => {
    const result = buildEntryOptimizer({
      marketState: marketState(), direction: 'BUY', minimumRr: 100, trendState: 'TRENDING_UP',
      sessionHigh: null, sessionLow: null,
    });
    // entryPrice = 1.0875, stopDistance = 0.0125 (same geometry as the ZONE_2 test above)
    expect(result.target).toBeCloseTo(1.0875 + 100 * 0.0125, 10);
    expect(result.rr).toBeCloseTo(100, 9);
  });

  it('produces NaN stop/target/rr when the band boundaries are missing', () => {
    const result = buildEntryOptimizer({
      marketState: marketState({ lowerBand: null as unknown as number }), direction: 'BUY', minimumRr: 2.0,
      trendState: 'RANGE', sessionHigh: null, sessionLow: null,
    });
    expect(Number.isNaN(result.stop)).toBe(true);
    expect(Number.isNaN(result.target)).toBe(true);
    expect(Number.isNaN(result.rr)).toBe(true);
  });

  it('atr14/atr20 no longer affect stop/target at all -- geometry is purely band-boundary/zone-width derived now', () => {
    const withAtr = buildEntryOptimizer({
      marketState: marketState(), direction: 'BUY', minimumRr: 2.0, trendState: 'RANGE',
      sessionHigh: null, sessionLow: null,
    });
    const withoutAtr = buildEntryOptimizer({
      marketState: marketState({ atr14: null, atr20: null }), direction: 'BUY', minimumRr: 2.0, trendState: 'RANGE',
      sessionHigh: null, sessionLow: null,
    });
    expect(Number.isNaN(withoutAtr.stop)).toBe(false);
    expect(withoutAtr.stop).toBeCloseTo(withAtr.stop, 10);
    expect(withoutAtr.target).toBeCloseTo(withAtr.target, 10);
    expect(withoutAtr.rr).toBeCloseTo(withAtr.rr, 10);
  });

  // Default marketState(): atr20 = atr14 = 0.02, so the 1.5x threshold is 0.03.
  describe('bandReliable', () => {
    it('true when the intraday session range is within 1.5x ATR20', () => {
      const result = buildEntryOptimizer({
        marketState: marketState(), direction: 'BUY', minimumRr: 2.0, trendState: 'RANGE',
        sessionHigh: 1.09, sessionLow: 1.08, // range 0.01 <= 0.03
      });
      expect(result.bandReliable).toBe(true);
    });

    it('false when the intraday session range exceeds 1.5x ATR20', () => {
      const result = buildEntryOptimizer({
        marketState: marketState(), direction: 'BUY', minimumRr: 2.0, trendState: 'RANGE',
        sessionHigh: 1.10, sessionLow: 1.05, // range 0.05 > 0.03
      });
      expect(result.bandReliable).toBe(false);
    });

    it('defaults to true when session data is missing (range reads as 0)', () => {
      const result = buildEntryOptimizer({
        marketState: marketState(), direction: 'BUY', minimumRr: 2.0, trendState: 'RANGE',
        sessionHigh: null, sessionLow: null,
      });
      expect(result.bandReliable).toBe(true);
    });

    it('false when atr20/atr14 are both unavailable, regardless of session range', () => {
      const result = buildEntryOptimizer({
        marketState: marketState({ atr14: null, atr20: null }), direction: 'BUY', minimumRr: 2.0, trendState: 'RANGE',
        sessionHigh: 1.09, sessionLow: 1.08,
      });
      expect(result.bandReliable).toBe(false);
    });
  });
});
