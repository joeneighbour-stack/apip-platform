import { describe, it, expect } from 'vitest';
import { estimateTriggerProbability } from '../services/triggerProbabilityService.js';

describe('estimateTriggerProbability', () => {
  it('returns the base rate with zero sample and analyst_kpi_fallback when zones are missing', () => {
    const result = estimateTriggerProbability({
      analystBaseRate: 0.425, currentZone: null, preferredZone: 'ZONE_2',
      direction: 'SELL', fallbackRate: 0.35,
    });
    expect(result).toEqual({ triggerProbability: 0.425, triggerSample: 0, triggerSource: 'analyst_kpi_fallback' });
  });

  it('falls back to fallbackRate when analystBaseRate is not positive', () => {
    const result = estimateTriggerProbability({
      analystBaseRate: 0, currentZone: null, preferredZone: null,
      direction: 'BUY', fallbackRate: 0.35,
    });
    expect(result.triggerProbability).toBe(0.35);
    expect(result.triggerSource).toBe('analyst_kpi_fallback');
  });

  it('applies the 1.3x multiplier at distance 0 (at entry zone)', () => {
    const result = estimateTriggerProbability({
      analystBaseRate: 0.425, currentZone: 'ZONE_2', preferredZone: 'ZONE_2',
      direction: 'SELL', fallbackRate: 0.35,
    });
    expect(result.triggerSource).toBe('analyst_kpi_zone_adjusted');
    expect(result.triggerProbability).toBeCloseTo(0.425 * 1.3, 10);
  });

  it('applies the 1.0x multiplier at distance 1 (one zone away)', () => {
    const result = estimateTriggerProbability({
      analystBaseRate: 0.313, currentZone: 'ZONE_3', preferredZone: 'ZONE_4',
      direction: 'SELL', fallbackRate: 0.35,
    });
    expect(result.triggerProbability).toBeCloseTo(0.313 * 1.0, 10);
  });

  it('applies the 0.7x multiplier at distance 2 (needs a meaningful move)', () => {
    const result = estimateTriggerProbability({
      analystBaseRate: 0.313, currentZone: 'ZONE_2', preferredZone: 'ZONE_4',
      direction: 'SELL', fallbackRate: 0.35,
    });
    expect(result.triggerProbability).toBeCloseTo(0.313 * 0.7, 10);
  });

  it('applies the 0.4x multiplier at distance 3+ (extended)', () => {
    const result = estimateTriggerProbability({
      analystBaseRate: 0.319, currentZone: 'TOO_DEEP', preferredZone: 'ZONE_4',
      direction: 'BUY', fallbackRate: 0.35,
    });
    expect(result.triggerProbability).toBeCloseTo(0.319 * 0.4, 10);
  });

  it('clamps the adjusted probability to the [0.02, 0.95] band', () => {
    const high = estimateTriggerProbability({
      analystBaseRate: 0.9, currentZone: 'ZONE_2', preferredZone: 'ZONE_2',
      direction: 'BUY', fallbackRate: 0.35,
    });
    expect(high.triggerProbability).toBe(0.95);

    const low = estimateTriggerProbability({
      analystBaseRate: 0.01, currentZone: 'TOO_DEEP', preferredZone: 'ZONE_4',
      direction: 'BUY', fallbackRate: 0.35,
    });
    expect(low.triggerProbability).toBe(0.02);
  });

  it('treats an unrecognised zone value as moderate distance (2)', () => {
    const result = estimateTriggerProbability({
      analystBaseRate: 0.5, currentZone: 'NOT_A_ZONE' as never, preferredZone: 'ZONE_2',
      direction: 'BUY', fallbackRate: 0.35,
    });
    expect(result.triggerProbability).toBeCloseTo(0.5 * 0.7, 10);
  });
});
