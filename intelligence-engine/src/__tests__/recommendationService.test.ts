import { describe, it, expect } from 'vitest';
import { buildRecommendation, type RecommendationInputTrade, type BuildRecommendationInput } from '../services/recommendationService.js';
import type { MarketStateOutput } from '../services/marketStateService.js';
import type { ActiveAnalyst } from '../services/analystProfileService.js';

function marketState(overrides: Partial<MarketStateOutput> = {}): MarketStateOutput {
  return {
    marketId: 'EURUSD', atr14: 0.02,
    lowerBand: 1.08, zone1Top: 1.085, zone2Top: 1.09, zone3Top: 1.095, upperBand: 1.10,
    currentZone: 'ZONE_2', currentPrice: 1.0875, stateGeneratedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const analysts: ActiveAnalyst[] = [
  { analyst: 'TIV', active: true, sessionEligibility: { EUROPEAN: true } },
  { analyst: 'IAN', active: true, sessionEligibility: { EUROPEAN: true } },
];

function baseInput(overrides: Partial<BuildRecommendationInput> = {}): BuildRecommendationInput {
  const trades: RecommendationInputTrade[] = Array.from({ length: 15 }, () => ({
    market: 'EURUSD', analyst: 'TIV', direction: 'BUY', entryZone: 'ZONE_2', resultR: 1.0, triggered: true,
  }));
  return {
    recommendationVersionId: 'rv-test-1', generatedAt: '2026-01-15T08:00:00Z',
    market: 'EURUSD', session: 'EUROPEAN',
    marketState: marketState(), marketRegime: null, eventRisks: [],
    trades, activeAnalysts: analysts,
    minimumRr: 2.0, minTriggerSample: 10, fallbackTriggerProbability: 0.5,
    staleAtrThreshold: 0.25, forceRecalcAtrThreshold: 0.50,
    parameterSnapshot: { atrPeriod: 14 }, parameterSnapshotHash: 'abc123',
    marketDisplayPrecision: 4,
    ...overrides,
  };
}

describe('buildRecommendation', () => {
  it('produces a complete opportunity with the correct opportunityId format', () => {
    const { opportunity } = buildRecommendation(baseInput());
    expect(opportunity.opportunityId).toBe('2026-01-15_EURUSD_EUROPEAN_v1');
    expect(opportunity.opportunityLifecycleStatus).toBe('GENERATED');
  });

  it('the recommendationVersion links to the opportunity via opportunityId', () => {
    const { opportunity, recommendationVersion } = buildRecommendation(baseInput());
    expect(recommendationVersion.opportunityId).toBe(opportunity.opportunityId);
    expect(recommendationVersion.versionNumber).toBe(1);
  });

  it('sets analystAction to ENTER_NOW when currentZone matches the selected preferredEntryZone', () => {
    const { opportunity } = buildRecommendation(baseInput());
    expect(opportunity.preferredEntryZone).toBe('ZONE_2');
    expect(opportunity.currentZone).toBe('ZONE_2');
    expect(opportunity.analystAction).toBe('ENTER_NOW');
  });

  it('sets analystAction to WAIT_FOR_PREFERRED_ZONE when currentZone differs from the selected zone', () => {
    const { opportunity } = buildRecommendation(baseInput({ marketState: marketState({ currentZone: 'ZONE_4' }) }));
    expect(opportunity.preferredEntryZone).toBe('ZONE_2');
    expect(opportunity.currentZone).toBe('ZONE_4');
    expect(opportunity.analystAction).toBe('WAIT_FOR_PREFERRED_ZONE');
  });

  it('expectedR and triggerProbability live on the opportunity, not the recommendation version', () => {
    const result = buildRecommendation(baseInput());
    expect(result.opportunity).toHaveProperty('expectedR');
    expect(result.opportunity).toHaveProperty('triggerProbability');
    expect(result.recommendationVersion).not.toHaveProperty('expectedR');
    expect(result.recommendationVersion).not.toHaveProperty('triggerProbability');
  });

  it('assignedAnalystId on the opportunity is a PREFERENCE, not eligibleAnalysts -- which has no home here at all', () => {
    const { opportunity, diagnostics } = buildRecommendation(baseInput());
    expect(opportunity.assignedAnalystId).toBe('TIV');
    expect(opportunity).not.toHaveProperty('eligibleAnalysts');
    // eligibleAnalysts lives only in diagnostics (debug-only), never in a persisted shape.
    expect(diagnostics.eligibleAnalysts).toContain('TIV');
  });

  it('riskRange and targetRange are deterministic TEXT, anchored on the precise hidden stop/target', () => {
    const { recommendationVersion, hiddenExecutionLevels } = buildRecommendation(baseInput());
    expect(typeof recommendationVersion.riskRange).toBe('string');
    expect(typeof recommendationVersion.targetRange).toBe('string');
    expect(recommendationVersion.riskRange).toMatch(/^\d+\.\d+\u2013\d+\.\d+$/);
    // The text range is centred on the hidden stop/target, not equal to it --
    // confirm hiddenExecutionLevels carries the precise number separately.
    expect(typeof hiddenExecutionLevels.stop).toBe('number');
    expect(typeof hiddenExecutionLevels.target).toBe('number');
  });

  it('hiddenExecutionLevels carries the exact numeric levels for the future shadow trade, structurally separate from the analyst-facing version', () => {
    const { hiddenExecutionLevels } = buildRecommendation(baseInput({ minimumRr: 3.0 }));
    expect(hiddenExecutionLevels.rr).toBeCloseTo(3.0, 9);
  });

  it('the inline generation-time condition assessment is always VALID (current/generation snapshots are identical by construction)', () => {
    const { recommendationVersion } = buildRecommendation(baseInput());
    expect(recommendationVersion.recommendationValidityStatus).toBe('VALID');
    expect(recommendationVersion.atrMoveSinceGeneration).toBe(0);
  });

  it('template/profile diagnostics are available for debugging but are explicitly not part of either persisted shape', () => {
    const { diagnostics, opportunity, recommendationVersion } = buildRecommendation(baseInput());
    expect(diagnostics.templateSource).toBe('historical_template');
    expect(diagnostics.profileSource).toBe('exact_profile');
    expect(opportunity).not.toHaveProperty('templateQuality');
    expect(recommendationVersion).not.toHaveProperty('templateQuality');
  });

  it('defaults regimeTags when marketRegime is null', () => {
    const { recommendationVersion } = buildRecommendation(baseInput({ marketRegime: null }));
    expect(recommendationVersion.regimeTags).toEqual([]);
  });

  it('defaults eventRiskStatus to NONE when no event risks apply, with the warning text available only in diagnostics', () => {
    const { recommendationVersion, diagnostics } = buildRecommendation(baseInput({ eventRisks: [] }));
    expect(recommendationVersion.eventRiskStatus).toBe('NONE');
    expect(diagnostics.eventWarning).toBe('');
  });

  it('picks the highest riskScore event when multiple apply to the same market', () => {
    const { recommendationVersion, diagnostics } = buildRecommendation(baseInput({
      eventRisks: [
        { marketId: 'EURUSD', eventName: 'Low event', currency: 'USD', impact: 'LOW', eventTimeUk: '2026-01-15T10:00:00Z', eventRiskStatus: 'WATCH', riskScore: 0.5, analystWarning: 'low warning' },
        { marketId: 'EURUSD', eventName: 'High event', currency: 'USD', impact: 'HIGH', eventTimeUk: '2026-01-15T09:00:00Z', eventRiskStatus: 'HIGH_RISK', riskScore: 0.9, analystWarning: 'high warning' },
      ],
    }));
    expect(recommendationVersion.eventRiskStatus).toBe('HIGH_RISK');
    expect(diagnostics.eventWarning).toBe('high warning');
  });

  it('falls through to the TemplateService BUY/ZONE_1 fallback when there is no trade history at all', () => {
    const { opportunity, diagnostics } = buildRecommendation(baseInput({ trades: [] }));
    expect(diagnostics.templateSource).toBe('fallback');
    expect(opportunity.direction).toBe('BUY');
    expect(opportunity.preferredEntryZone).toBe('ZONE_1');
  });
});
