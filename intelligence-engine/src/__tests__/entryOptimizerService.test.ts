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

describe('buildEntryOptimizer', () => {
  it('BUY + TRENDING_UP: selects ZONE_2, enters at the zone low, targets the upper band', () => {
    const result = buildEntryOptimizer({
      marketState: marketState(), direction: 'BUY', minimumRr: 2.0,
      trendState: 'TRENDING_UP', volatilityState: null,
    });
    expect(result.preferredZone).toBe('ZONE_2');
    expect(result.entryRangeLow).toBeCloseTo(1.085, 10);
    expect(result.entryRangeHigh).toBeCloseTo(1.09, 10);
    expect(result.entryMid).toBeCloseTo(1.0875, 10);
    expect(result.entryPrice).toBeCloseTo(1.085, 10); // BUY enters at zone low
    // stop = lowerBand - NORMAL_VOL buffer (0.10 * atr20=0.02 = 0.002)
    expect(result.stop).toBeCloseTo(1.08 - 0.002, 10);
    // Natural band-boundary target (1.10) already clears the 2:1 floor
    // (targetDistance 0.015 >= minimumTargetDistance 2*0.007=0.014), so it's untouched.
    expect(result.target).toBeCloseTo(1.10, 10);
    expect(result.rr).toBeCloseTo(0.015 / 0.007, 9);
  });

  it('BUY + RANGE: selects ZONE_1 (the favourable low-risk edge, not the trend-aligned middle zone)', () => {
    const result = buildEntryOptimizer({
      marketState: marketState(), direction: 'BUY', minimumRr: 2.0,
      trendState: 'RANGE', volatilityState: null,
    });
    expect(result.preferredZone).toBe('ZONE_1');
    expect(result.entryPrice).toBeCloseTo(1.08, 10); // zone low = lowerBand itself
  });

  it('SELL: enters at the zone high, stop above entry, target below entry', () => {
    const result = buildEntryOptimizer({
      marketState: marketState(), direction: 'SELL', minimumRr: 2.0,
      trendState: 'RANGE', volatilityState: null,
    });
    expect(result.preferredZone).toBe('ZONE_4');
    expect(result.entryPrice).toBeCloseTo(1.10, 10); // SELL enters at zone high
    expect(result.stop).toBeGreaterThan(result.entryPrice);
    expect(result.target).toBeLessThan(result.entryPrice);
    expect(result.target).toBeCloseTo(1.08, 10); // target = lowerBand
  });

  it('expands the target toward/beyond the band boundary when the natural target falls short of the 2:1 RR floor', () => {
    const ms = marketState({
      lowerBand: 1.08, zone1Top: 1.0805, zone2Top: 1.081, zone3Top: 1.0815, upperBand: 1.0825,
      atr14: 0.02, atr20: 0.02,
    });
    const result = buildEntryOptimizer({
      marketState: ms, direction: 'BUY', minimumRr: 2.0,
      trendState: 'RANGE', volatilityState: null,
    });
    // entryPrice = zone low = lowerBand = 1.08; stop = 1.08 - 0.002 = 1.078; stopDistance = 0.002
    // natural target = upperBand = 1.0825; targetDistance = 0.0025 < minimumTargetDistance (0.004) -> expand
    expect(result.stop).toBeCloseTo(1.078, 10);
    expect(result.target).toBeCloseTo(1.084, 10); // entryPrice + 2.0 * stopDistance, within the 1.5xATR20 cap
    expect(result.rr).toBeCloseTo(2.0, 9);
  });

  it('caps the expanded target at 1.5x ATR20 from entry, even when that falls short of the requested RR', () => {
    const ms = marketState({
      lowerBand: 1.08, zone1Top: 1.0805, zone2Top: 1.081, zone3Top: 1.0815, upperBand: 1.0825,
      atr14: 0.02, atr20: 0.02,
    });
    const result = buildEntryOptimizer({
      marketState: ms, direction: 'BUY', minimumRr: 100, // unrealistic floor forces the cap
      trendState: 'RANGE', volatilityState: null,
    });
    // maxTarget = entryPrice (1.08) + 1.5 * atr20 (0.02) = 1.11
    expect(result.target).toBeCloseTo(1.11, 10);
    expect(result.rr).toBeLessThan(100);
  });

  it('scales the stop buffer with volatilityState (EXTREME_VOL sits further from the band than LOW_VOL)', () => {
    const low = buildEntryOptimizer({
      marketState: marketState(), direction: 'BUY', minimumRr: 2.0,
      trendState: 'RANGE', volatilityState: 'LOW_VOL',
    });
    const extreme = buildEntryOptimizer({
      marketState: marketState(), direction: 'BUY', minimumRr: 2.0,
      trendState: 'RANGE', volatilityState: 'EXTREME_VOL',
    });
    // BUY stop = lowerBand - buffer, so a bigger buffer means a LOWER (further away) stop.
    expect(extreme.stop).toBeLessThan(low.stop);
    expect(low.entryPrice).toBeCloseTo(1.08 - 0.05 * 0.02, 10);
    expect(extreme.entryPrice).toBeCloseTo(1.08, 10); // entry unaffected by volatility, only the stop is
  });

  it('produces NaN stop/target/rr when the band boundaries are missing', () => {
    const result = buildEntryOptimizer({
      marketState: marketState({ lowerBand: null as unknown as number }), direction: 'BUY', minimumRr: 2.0,
      trendState: 'RANGE', volatilityState: null,
    });
    expect(Number.isNaN(result.stop)).toBe(true);
    expect(Number.isNaN(result.target)).toBe(true);
    expect(Number.isNaN(result.rr)).toBe(true);
  });

  it('produces NaN stop/target/rr when both atr20 and atr14 are null (insufficient history)', () => {
    const result = buildEntryOptimizer({
      marketState: marketState({ atr14: null, atr20: null }), direction: 'BUY', minimumRr: 2.0,
      trendState: 'RANGE', volatilityState: null,
    });
    // entry range itself still computes fine (depends on bands, not atr) --
    // only stop/target/rr depend on atr and should be NaN.
    expect(Number.isNaN(result.entryMid)).toBe(false);
    expect(Number.isNaN(result.stop)).toBe(true);
    expect(Number.isNaN(result.target)).toBe(true);
    expect(Number.isNaN(result.rr)).toBe(true);
  });

  it('falls back to atr14 when atr20 is null', () => {
    const result = buildEntryOptimizer({
      marketState: marketState({ atr14: 0.02, atr20: null }), direction: 'BUY', minimumRr: 2.0,
      trendState: 'RANGE', volatilityState: null,
    });
    expect(Number.isNaN(result.stop)).toBe(false);
    expect(result.stop).toBeCloseTo(1.08 - 0.002, 10);
  });
});
