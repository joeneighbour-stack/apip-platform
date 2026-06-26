import { describe, it, expect } from 'vitest';
import { createShadowTrade, type CreateShadowTradeInput } from '../services/shadowTradeService.js';

function baseInput(overrides: Partial<CreateShadowTradeInput> = {}): CreateShadowTradeInput {
  return {
    shadowTradeId: 'st-1', shadowOutcomeId: 'sto-1', createdAt: '2026-01-15T08:00:00Z',
    recommendationVersionId: 'rv-1', opportunityId: '2026-01-15_EURUSD_EUROPEAN_v1',
    entry: 1.0875, stop: 1.0825, target: 1.0975, rr: 2.0,
    templateSource: 'historical_template',
    ...overrides,
  };
}

describe('createShadowTrade', () => {
  it('produces a shadowTrade carrying the exact precise entry/stop/target/rr -- never the analyst-facing text range', () => {
    const { shadowTrade } = createShadowTrade(baseInput());
    expect(shadowTrade.entry).toBe(1.0875);
    expect(shadowTrade.stop).toBe(1.0825);
    expect(shadowTrade.target).toBe(1.0975);
    expect(shadowTrade.rr).toBe(2.0);
  });

  it('always sets visibleToAnalyst to false -- enforced at the type level, not just a runtime default', () => {
    const { shadowTrade } = createShadowTrade(baseInput());
    expect(shadowTrade.visibleToAnalyst).toBe(false);
    // The literal type itself is the real assertion: TypeScript rejects
    // `shadowTrade.visibleToAnalyst = true` at compile time, which this
    // runtime check cannot fully exercise -- the type signature in
    // shadowTradeService.ts (`visibleToAnalyst: false`, not `boolean`) is
    // what actually enforces this; this test just confirms the runtime
    // value matches what the type promises.
  });

  it('does not invent a confidence label -- always literal null, since no notebook-validated formula exists', () => {
    const { shadowTrade } = createShadowTrade(baseInput());
    expect(shadowTrade.confidenceLabel).toBeNull();
  });

  it('carries templateSource through onto the shadow trade -- the one field the notebook never mentions but the real schema requires', () => {
    const historical = createShadowTrade(baseInput({ templateSource: 'historical_template' })).shadowTrade;
    expect(historical.templateSource).toBe('historical_template');
    const fallback = createShadowTrade(baseInput({ templateSource: 'fallback' })).shadowTrade;
    expect(fallback.templateSource).toBe('fallback');
  });

  it('accepts the full templateSource vocabulary, including profile-path sources and the honest unknown fallback', () => {
    // Per product clarification: the vocabulary spans both TemplateService's
    // own classification and AnalystProfileService's, plus an explicit
    // 'unknown' for when no selection-path diagnostic is available at all --
    // never a silent default this service invents on its own.
    expect(createShadowTrade(baseInput({ templateSource: 'exact_profile' })).shadowTrade.templateSource).toBe('exact_profile');
    expect(createShadowTrade(baseInput({ templateSource: 'market_profile' })).shadowTrade.templateSource).toBe('market_profile');
    expect(createShadowTrade(baseInput({ templateSource: 'unknown' })).shadowTrade.templateSource).toBe('unknown');
  });

  it('links the shadow trade to its recommendation and opportunity via FK fields, not duplicated market/session/direction data', () => {
    const { shadowTrade } = createShadowTrade(baseInput());
    expect(shadowTrade.recommendationVersionId).toBe('rv-1');
    expect(shadowTrade.opportunityId).toBe('2026-01-15_EURUSD_EUROPEAN_v1');
    expect(shadowTrade).not.toHaveProperty('market');
    expect(shadowTrade).not.toHaveProperty('session');
    expect(shadowTrade).not.toHaveProperty('direction');
    expect(shadowTrade).not.toHaveProperty('triggerProbability');
    expect(shadowTrade).not.toHaveProperty('expectedR');
  });

  it('produces a paired initial outcome row at NOT_TRIGGERED, with no result yet -- outcome evolution is explicitly out of scope here', () => {
    const { shadowTradeOutcome } = createShadowTrade(baseInput());
    expect(shadowTradeOutcome.shadowTradeId).toBe('st-1');
    expect(shadowTradeOutcome.tradeOutcomeStatus).toBe('NOT_TRIGGERED');
    expect(shadowTradeOutcome.resultR).toBeNull();
    expect(shadowTradeOutcome.outcomeTimestamp).toBeNull();
  });

  it('is a pure function -- identical input always produces identical output, no internal id/time generation', () => {
    const input = baseInput();
    const resultA = createShadowTrade(input);
    const resultB = createShadowTrade(input);
    expect(resultA).toEqual(resultB);
  });
});
