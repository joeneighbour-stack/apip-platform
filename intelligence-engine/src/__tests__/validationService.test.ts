import { describe, it, expect } from 'vitest';
import { validateEquivalence, type ValidateEquivalenceInput } from '../services/validationService.js';

function baseInput(overrides: Partial<ValidateEquivalenceInput> = {}): ValidateEquivalenceInput {
  const base = {
    direction: 'BUY', preferredEntryZone: 'ZONE_2', currentZone: 'ZONE_2',
    analystAction: 'ENTER_NOW', recommendationValidityStatus: 'VALID',
    entryRangeLow: 1.085, entryRangeHigh: 1.09, entryMid: 1.0875,
    stop: 1.0825, target: 1.0975, rr: 2.0,
    triggerProbability: 0.65, expectedR: 1.3, rawExpectedR: 2.0,
    templateSource: 'historical_template', parameterSnapshotHash: 'abc123',
  };
  return {
    validationRunId: 'vr-1', recommendationVersionId: 'rv-1',
    researchEngineVersion: 'APIP_RESEARCH_ENGINE_V1_0',
    productionEngineVersion: 'ce35de9',
    parameterSnapshotHash: 'abc123',
    productionOutput: { ...base },
    researchOutput: { ...base },
    atr14: 0.02, validatedAt: '2026-01-15T08:00:00Z',
    ...overrides,
  };
}

describe('validateEquivalence', () => {
  it('returns MATCH when production and research outputs are identical', () => {
    const result = validateEquivalence(baseInput());
    expect(result.overallStatus).toBe('MATCH');
    expect(result.differences).toHaveLength(0);
    expect(result.highestSeverity).toBeNull();
  });

  it('returns NOT_COMPARABLE when researchOutput is null', () => {
    const result = validateEquivalence(baseInput({ researchOutput: null }));
    expect(result.overallStatus).toBe('NOT_COMPARABLE');
    expect(result.researchRecommendationHash).toBeNull();
    expect(result.differences).toHaveLength(0);
  });

  it('uses the quick-path hash match -- identical outputs never go through field-by-field comparison', () => {
    // Verify by confirming differences array is empty and overallStatus is MATCH
    // even without inspecting internals.
    const result = validateEquivalence(baseInput());
    expect(result.overallStatus).toBe('MATCH');
    expect(result.recommendationHash).toBe(result.researchRecommendationHash);
  });

  it('detects a numeric drift and classifies it correctly -- LOW for within 2x tolerance', () => {
    // 1e-12 relative error is BELOW 1e-9 tolerance -- the service correctly
    // treats it as a match and produces no difference entry. To test a LOW
    // severity entry, we need a value ABOVE 1e-9 but BELOW 2e-9 tolerance.
    // entryRangeLow = 1.085, so we need a delta of ~1.085 * 1.5e-9 ~ 1.6e-9.
    const research = { ...baseInput().productionOutput, entryRangeLow: 1.085 + 1.6e-9 };
    const result = validateEquivalence(baseInput({ researchOutput: research }));
    const diff = result.differences.find(d => d.field === 'entryRangeLow');
    expect(diff).toBeDefined();
    expect(diff!.severity).toBe('LOW');
    expect(diff!.reason).toBe('FLOATING_POINT_ROUNDING');
  });

  it('classifies a larger numeric drift as MEDIUM (within 5% relative)', () => {
    const research = { ...baseInput().productionOutput, triggerProbability: 0.62 }; // was 0.65 -- ~4.6% diff
    const result = validateEquivalence(baseInput({ researchOutput: research }));
    const diff = result.differences.find(d => d.field === 'triggerProbability');
    expect(diff).toBeDefined();
    expect(diff!.severity).toBe('MEDIUM');
  });

  it('classifies a price-level delta as atr_multiple units when atr14 is available', () => {
    const research = { ...baseInput().productionOutput, stop: 1.0800 }; // 0.0025 different, atr=0.02 -> 0.125 ATR
    const result = validateEquivalence(baseInput({ researchOutput: research }));
    const diff = result.differences.find(d => d.field === 'stop');
    expect(diff!.deltaUnit).toBe('atr_multiple');
    expect(diff!.delta as number).toBeCloseTo(0.125, 9);
  });

  it('classifies direction mismatch as CRITICAL -- it directly changes what an analyst does', () => {
    const research = { ...baseInput().productionOutput, direction: 'SELL' };
    const result = validateEquivalence(baseInput({ researchOutput: research }));
    const diff = result.differences.find(d => d.field === 'direction');
    expect(diff!.severity).toBe('CRITICAL');
    expect(result.highestSeverity).toBe('CRITICAL');
  });

  it('classifies analystAction mismatch as CRITICAL', () => {
    const research = { ...baseInput().productionOutput, analystAction: 'WAIT_FOR_PREFERRED_ZONE' };
    const result = validateEquivalence(baseInput({ researchOutput: research }));
    const diff = result.differences.find(d => d.field === 'analystAction');
    expect(diff!.severity).toBe('CRITICAL');
  });

  it('classifies DO_NOT_USE_RECALCULATE vs VALID as CRITICAL -- it determines whether an analyst acts', () => {
    const research = { ...baseInput().productionOutput, recommendationValidityStatus: 'DO_NOT_USE_RECALCULATE' };
    const result = validateEquivalence(baseInput({ researchOutput: research }));
    const diff = result.differences.find(d => d.field === 'recommendationValidityStatus');
    expect(diff!.severity).toBe('CRITICAL');
  });

  it('classifies VALID vs STALE_PRICE as MEDIUM -- adjacent states at a near-boundary ATR move', () => {
    const research = { ...baseInput().productionOutput, recommendationValidityStatus: 'STALE_PRICE' };
    const result = validateEquivalence(baseInput({ researchOutput: research }));
    const diff = result.differences.find(d => d.field === 'recommendationValidityStatus');
    expect(diff!.severity).toBe('MEDIUM');
  });

  it('flags PARAMETER_SNAPSHOT_MISMATCH as the reason when hashes differ between runs', () => {
    const research = { ...baseInput().productionOutput, parameterSnapshotHash: 'different_hash', triggerProbability: 0.50 };
    const result = validateEquivalence(baseInput({ researchOutput: research }));
    const numericDiff = result.differences.find(d => d.field === 'triggerProbability');
    expect(numericDiff!.reason).toBe('PARAMETER_SNAPSHOT_MISMATCH');
  });

  it('highestSeverity correctly reflects the most severe difference across all fields', () => {
    const research = {
      ...baseInput().productionOutput,
      entryRangeLow: 1.085 + 1e-12, // LOW
      direction: 'SELL',              // CRITICAL
    };
    const result = validateEquivalence(baseInput({ researchOutput: research }));
    expect(result.highestSeverity).toBe('CRITICAL');
    expect(result.overallStatus).toBe('DRIFT_DETECTED');
  });

  it('differences array only lists fields that actually differ -- not all fields every time', () => {
    const research = { ...baseInput().productionOutput, direction: 'SELL' };
    const result = validateEquivalence(baseInput({ researchOutput: research }));
    // Only direction differs -- entryRangeLow, stop, etc. should NOT appear
    expect(result.differences.every(d => d.field === 'direction')).toBe(true);
    expect(result.differences).toHaveLength(1);
  });

  it('produces a recommendationHash using the same stableHash algorithm as the rest of the engine', () => {
    const result = validateEquivalence(baseInput());
    // Both hashes should be 64-character hex strings (sha256)
    expect(result.recommendationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.researchRecommendationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.recommendationHash).toBe(result.researchRecommendationHash!);
  });
});
