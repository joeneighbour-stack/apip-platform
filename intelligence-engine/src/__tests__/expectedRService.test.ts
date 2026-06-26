import { describe, it, expect } from 'vitest';
import { calculateExpectedR } from '../services/expectedRService.js';

describe('calculateExpectedR', () => {
  it('returns rawExpectedR = 0.0 (not NaN) when neither template nor profile has any trades', () => {
    const result = calculateExpectedR({
      template: { templateAvgR: 5, templateTrades: 0 }, // avgR ignored since trades=0
      profile: { profileAvgR: 5, profileTrades: 0 },
      trigger: { triggerProbability: 0.6 },
    });
    expect(result.rawExpectedR).toBe(0.0);
    expect(result.expectedR).toBe(0.0);
  });

  it('weights template and profile by min(trades, 100) when both have data', () => {
    const result = calculateExpectedR({
      template: { templateAvgR: 1.0, templateTrades: 50 },
      profile: { profileAvgR: 2.0, profileTrades: 50 },
      trigger: { triggerProbability: 1.0 },
    });
    // Equal weights (50 each) -> simple average of 1.0 and 2.0.
    expect(result.rawExpectedR).toBeCloseTo(1.5, 10);
  });

  it('caps weight at 100 even when trade count exceeds it', () => {
    const result = calculateExpectedR({
      template: { templateAvgR: 1.0, templateTrades: 1000 }, // weight capped at 100
      profile: { profileAvgR: 2.0, profileTrades: 100 },      // weight 100
      trigger: { triggerProbability: 1.0 },
    });
    // Both weighted equally (100 each) despite template having 10x the trades.
    expect(result.rawExpectedR).toBeCloseTo(1.5, 10);
  });

  it('uses only the available component when one side has zero trades', () => {
    const result = calculateExpectedR({
      template: { templateAvgR: 3.0, templateTrades: 50 },
      profile: { profileAvgR: 999, profileTrades: 0 }, // excluded entirely, not weighted at 0
      trigger: { triggerProbability: 1.0 },
    });
    expect(result.rawExpectedR).toBeCloseTo(3.0, 10);
  });

  it('CRITICAL: excludes a component with NaN avgR from the blend (treated as zero-trades), rather than letting NaN propagate -- approved departure from the notebook', () => {
    // A winning template group can have nonzero trades but NaN avgR (every
    // trade in the group had a null result) -- see TemplateService. The
    // notebook lets this propagate into expectedR; production must never
    // surface a NaN recommendation field, so this component is excluded
    // instead, falling back to the other (real) component.
    const result = calculateExpectedR({
      template: { templateAvgR: NaN, templateTrades: 10 }, // excluded: trades>0 but avgR is NaN
      profile: { profileAvgR: 2.0, profileTrades: 50 },
      trigger: { triggerProbability: 1.0 },
    });
    expect(Number.isNaN(result.rawExpectedR)).toBe(false);
    expect(result.rawExpectedR).toBeCloseTo(2.0, 10); // only the profile component contributes
  });

  it('falls back to rawExpectedR = 0.0 when BOTH components are NaN-avgR (none usable)', () => {
    const result = calculateExpectedR({
      template: { templateAvgR: NaN, templateTrades: 10 },
      profile: { profileAvgR: NaN, profileTrades: 20 },
      trigger: { triggerProbability: 1.0 },
    });
    expect(result.rawExpectedR).toBe(0.0);
    expect(result.expectedR).toBe(0.0);
  });

  it('multiplies rawExpectedR by triggerProbability to get expectedR', () => {
    const result = calculateExpectedR({
      template: { templateAvgR: 2.0, templateTrades: 50 },
      profile: { profileAvgR: 0, profileTrades: 0 },
      trigger: { triggerProbability: 0.4 },
    });
    expect(result.rawExpectedR).toBeCloseTo(2.0, 10);
    expect(result.expectedR).toBeCloseTo(0.8, 10);
  });
});
