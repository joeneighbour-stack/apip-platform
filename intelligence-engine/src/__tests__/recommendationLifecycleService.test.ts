import { describe, it, expect } from 'vitest';
import { assessCondition } from '../services/recommendationLifecycleService.js';

const base = {
  currentPrice: 1.10, priceAtGeneration: 1.10, zoneAtGeneration: 'ZONE_2', currentZone: 'ZONE_2',
  atr14: 0.02, staleAtrThreshold: 0.25, forceRecalcAtrThreshold: 0.50,
};

describe('assessCondition', () => {
  it('returns VALID when nothing has changed', () => {
    expect(assessCondition(base).recommendationValidityStatus).toBe('VALID');
    expect(assessCondition(base).requiresRefresh).toBe(false);
  });

  it('returns DO_NOT_USE_RECALCULATE when atr14 is null, NaN, zero, or negative', () => {
    expect(assessCondition({ ...base, atr14: null }).recommendationValidityStatus).toBe('DO_NOT_USE_RECALCULATE');
    expect(assessCondition({ ...base, atr14: NaN }).recommendationValidityStatus).toBe('DO_NOT_USE_RECALCULATE');
    expect(assessCondition({ ...base, atr14: 0 }).recommendationValidityStatus).toBe('DO_NOT_USE_RECALCULATE');
    expect(assessCondition({ ...base, atr14: -0.01 }).recommendationValidityStatus).toBe('DO_NOT_USE_RECALCULATE');
  });

  it('returns DO_NOT_USE_RECALCULATE when currentPrice or priceAtGeneration is null/NaN', () => {
    expect(assessCondition({ ...base, currentPrice: null }).recommendationValidityStatus).toBe('DO_NOT_USE_RECALCULATE');
    expect(assessCondition({ ...base, currentPrice: NaN }).recommendationValidityStatus).toBe('DO_NOT_USE_RECALCULATE');
  });

  it('returns ZONE_CHANGED when zone differs, checked BEFORE the volatility thresholds', () => {
    // Large ATR move AND zone change at once -- zone change must win (checked first).
    const result = assessCondition({ ...base, zoneAtGeneration: 'ZONE_1', currentZone: 'ZONE_4', currentPrice: 2.0 });
    expect(result.recommendationValidityStatus).toBe('ZONE_CHANGED');
  });

  it('returns DO_NOT_USE_RECALCULATE when atrMove >= forceRecalcAtrThreshold (0.50)', () => {
    // atrMove = |1.11 - 1.10| / 0.02 = 0.5, exactly at the threshold
    const result = assessCondition({ ...base, currentPrice: 1.11 });
    expect(result.recommendationValidityStatus).toBe('DO_NOT_USE_RECALCULATE');
  });

  it('returns STALE_PRICE when atrMove >= staleAtrThreshold (0.25) but below forceRecalc', () => {
    // atrMove = |1.106 - 1.10| / 0.02 = 0.3
    const result = assessCondition({ ...base, currentPrice: 1.106 });
    expect(result.recommendationValidityStatus).toBe('STALE_PRICE');
  });

  it('computes atrMoveSinceGeneration correctly and returns null only in the missing-data branch', () => {
    expect(assessCondition({ ...base, currentPrice: 1.104 }).atrMoveSinceGeneration).toBeCloseTo(0.2, 10);
    expect(assessCondition({ ...base, atr14: null }).atrMoveSinceGeneration).toBeNull();
  });
});
