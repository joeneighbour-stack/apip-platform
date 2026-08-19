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
    atr20: overrides.atr20 !== undefined ? overrides.atr20 : (overrides.atr14 ?? null),
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
    // baseInput()'s default marketRegime is null (treated as RANGE by
    // selectEntryZone()), and direction resolves to BUY -- so the regime-
    // conditional zone is ZONE_1 (the favourable low-risk edge), not the
    // trend-aligned ZONE_2. currentZone is set to match it here.
    const { opportunity } = buildRecommendation(baseInput({ marketState: marketState({ currentZone: 'ZONE_1' }) }));
    expect(opportunity.preferredEntryZone).toBe('ZONE_1');
    expect(opportunity.currentZone).toBe('ZONE_1');
    expect(opportunity.analystAction).toBe('ENTER_NOW');
  });

  it('sets analystAction to WAIT_FOR_PREFERRED_ZONE when currentZone differs from the selected zone', () => {
    const { opportunity } = buildRecommendation(baseInput({ marketState: marketState({ currentZone: 'ZONE_4' }) }));
    expect(opportunity.preferredEntryZone).toBe('ZONE_1'); // BUY + RANGE (default marketRegime: null)
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

  it('riskRange and targetRange are deterministic TEXT anchored on the exact hidden stop/target, which sit outside/inside the band', () => {
    const { recommendationVersion, hiddenExecutionLevels } = buildRecommendation(baseInput());
    expect(typeof recommendationVersion.riskRange).toBe('string');
    expect(typeof recommendationVersion.targetRange).toBe('string');
    // "Stop: X" / "Target: X" -- a single band-boundary-derived price, not a q25-q75 range.
    expect(recommendationVersion.riskRange).toMatch(/^Stop: \d+\.\d+$/);
    expect(recommendationVersion.targetRange).toMatch(/^Target: \d+\.\d+$/);
    expect(typeof hiddenExecutionLevels.stop).toBe('number');
    expect(typeof hiddenExecutionLevels.target).toBe('number');
    // BUY + ZONE_1: stop sits outside (below) the lower band, target sits within
    // (at) the band, beyond the entry price.
    expect(hiddenExecutionLevels.stop).toBeLessThan(1.08);
    expect(hiddenExecutionLevels.target).toBeLessThanOrEqual(1.10);
    expect(hiddenExecutionLevels.target).toBeGreaterThan(hiddenExecutionLevels.entryPrice);
  });

  it('hiddenExecutionLevels carries the exact numeric levels for the future shadow trade, structurally separate from the analyst-facing version', () => {
    // The default fixture's band-boundary target already clears a natural 4:1 RR
    // (entry at the ZONE_1 band edge -- see entryOptimizerService.test.ts), so
    // minimumRr only becomes visible in rr once it's set high enough to force the
    // RR-floor expansion. minimumRr=12 does that -- there's no cap anymore
    // (entryOptimizerService.ts's buildEntryOptimizer() expands to exactly
    // minimumRr x stop distance, unbounded), so rr should land exactly on the
    // requested floor.
    const { hiddenExecutionLevels } = buildRecommendation(baseInput({ minimumRr: 12 }));
    expect(hiddenExecutionLevels.rr).toBeCloseTo(12, 9);
    // Stop stays outside the band regardless of the RR floor; target, on the other
    // hand, is deliberately allowed to extend beyond the band boundary here -- that's
    // the whole point of the floor (see entryOptimizerService.ts's buildEntryOptimizer()).
    expect(hiddenExecutionLevels.stop).toBeLessThan(1.08);
    expect(hiddenExecutionLevels.target).toBeGreaterThan(1.10);
  });

  it('the inline generation-time condition assessment is always VALID (current/generation snapshots are identical by construction)', () => {
    const { recommendationVersion } = buildRecommendation(baseInput());
    expect(recommendationVersion.recommendationValidityStatus).toBe('VALID');
    expect(recommendationVersion.atrMoveSinceGeneration).toBe(0);
  });

  it('template/profile diagnostics are available for debugging but are explicitly not part of either persisted shape', () => {
    // baseInput's trades are all entryZone 'ZONE_2' -- an "exact" analyst-profile match
    // needs the regime-conditional zone to land on ZONE_2 too, which requires a
    // trend-aligned regime (BUY + TRENDING_UP) rather than the default null/RANGE
    // (which now resolves to ZONE_1, giving only a 'market_profile' match instead).
    const { diagnostics, opportunity, recommendationVersion } = buildRecommendation(baseInput({
      marketRegime: { trendState: 'TRENDING_UP', regimeConfidence: null, regimeTags: [], volatilityState: null },
    }));
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

  it('falls through to the TemplateService BUY fallback when there is no trade history at all, and the regime-conditional zone for BUY+RANGE is ZONE_1', () => {
    const { opportunity, diagnostics } = buildRecommendation(baseInput({ trades: [] }));
    expect(diagnostics.templateSource).toBe('fallback');
    expect(opportunity.direction).toBe('BUY');
    // ZONE_1 here comes from the entry optimizer's regime-conditional selection
    // (BUY + RANGE, since marketRegime defaults to null) -- coincidentally the same
    // zone templateService.ts's own (now unused-for-zone) fallback would have picked.
    expect(opportunity.preferredEntryZone).toBe('ZONE_1');
  });

  it('passes regimeTags through from a live RegimeSnapshot (market_regime_state shape, not MarketRegimeService)', () => {
    const { recommendationVersion } = buildRecommendation(baseInput({
      marketRegime: { trendState: 'TRENDING_DOWN', regimeConfidence: 'MEDIUM', regimeTags: ['TRENDING_DOWN', 'LOW_VOL'], volatilityState: 'LOW_VOL' },
    }));
    expect(recommendationVersion.regimeTags).toEqual(['TRENDING_DOWN', 'LOW_VOL']);
  });

  describe('analyst KPI trigger rate x zone distance', () => {
    // baseInput's trades resolve assignedAnalystId to 'TIV'; preferredEntryZone is now
    // ZONE_1 (regime-conditional: BUY + RANGE, since marketRegime defaults to null --
    // see the assignedAnalystId/analystAction tests above), not the old template-
    // derived ZONE_2. Tests that want the "at entry zone" distance-0 (1.3x) tier
    // explicitly set currentZone to ZONE_1 to match it.
    it('uses the analyst trigger-rate map entry for the assigned analyst, scaled by zone distance', () => {
      const { opportunity } = buildRecommendation(baseInput({
        marketState: marketState({ currentZone: 'ZONE_1' }),
        analystTriggerRateMap: new Map([['TIV', 0.425]]),
      }));
      expect(opportunity.triggerProbability).toBeCloseTo(0.425 * 1.3, 10);
    });

    it('falls back to fallbackTriggerProbability when the assigned analyst has no map entry', () => {
      const { opportunity } = buildRecommendation(baseInput({
        marketState: marketState({ currentZone: 'ZONE_1' }),
        analystTriggerRateMap: new Map(),
      }));
      expect(opportunity.triggerProbability).toBeCloseTo(0.5 * 1.3, 10);
    });

    it('falls back to fallbackTriggerProbability when no map is provided at all', () => {
      const { opportunity } = buildRecommendation(baseInput({
        marketState: marketState({ currentZone: 'ZONE_1' }),
      }));
      expect(opportunity.triggerProbability).toBeCloseTo(0.5 * 1.3, 10);
    });

    it('scales down when currentZone is further from preferredEntryZone', () => {
      const { opportunity } = buildRecommendation(baseInput({
        marketState: marketState({ currentZone: 'ZONE_4' }),
        analystTriggerRateMap: new Map([['TIV', 0.425]]),
      }));
      // preferredEntryZone stays ZONE_1 (regime-conditional: BUY + RANGE); ZONE_1 ->
      // ZONE_4 is distance 3 on the ladder (TOO_DEEP, ZONE_1, ZONE_2, ZONE_3, ZONE_4,
      // TOO_HIGH), the 0.4x "three+ zones away" tier.
      expect(opportunity.preferredEntryZone).toBe('ZONE_1');
      expect(opportunity.triggerProbability).toBeCloseTo(0.425 * 0.4, 10);
    });

    it('expectedR moves with the same triggerProbability the opportunity persists -- no separate raw/scaled split', () => {
      const { opportunity, diagnostics } = buildRecommendation(baseInput({
        analystTriggerRateMap: new Map([['TIV', 0.425]]),
      }));
      expect(diagnostics.rawTriggerProbability).toBeCloseTo(opportunity.triggerProbability, 10);
    });
  });

  // Zone selection is now regime-conditional (entryOptimizerService.ts's
  // selectEntryZone()), not sourced from templateService.ts's historical
  // preferredEntryZone. Stop is one zone width (step = band width / 4) outside
  // the opposite band boundary, so entering at the band edge (ZONE_1/ZONE_4,
  // the RANGE/MIXED cases) always gives a natural 4:1 RR (band width = 4x zone
  // width) -- never expanded, target lands exactly on the natural band
  // boundary. Entering at the adjacent zone (ZONE_2/ZONE_3, the trend-aligned
  // cases) gives only a natural 3:2 RR against this fixture, below the 2:1
  // floor -- target expands to exactly minimumRr x stop distance, which lands
  // *beyond* the band boundary here (see entryOptimizerService.test.ts for the
  // isolated arithmetic).
  describe('regime-conditional zone selection', () => {
    const sellTrades: RecommendationInputTrade[] = Array.from({ length: 15 }, () => ({
      market: 'EURUSD', analyst: 'TIV', direction: 'SELL', entryZone: 'ZONE_4', resultR: 1.0, triggered: true,
    }));

    it('BUY + RANGE prefers ZONE_1 -- the favourable low-risk edge, not the trend-aligned middle zone', () => {
      const { opportunity, hiddenExecutionLevels } = buildRecommendation(baseInput({
        marketRegime: { trendState: 'RANGE', regimeConfidence: null, regimeTags: [], volatilityState: null },
      }));
      expect(opportunity.direction).toBe('BUY');
      expect(opportunity.preferredEntryZone).toBe('ZONE_1');
      expect(hiddenExecutionLevels.stop).toBeLessThan(1.08); // outside (below) the band
      expect(hiddenExecutionLevels.target).toBeLessThanOrEqual(1.10); // inside (at) the band
      expect(hiddenExecutionLevels.target).toBeGreaterThan(hiddenExecutionLevels.entryPrice);
    });

    it('BUY + MIXED also prefers ZONE_1', () => {
      const { opportunity } = buildRecommendation(baseInput({
        marketRegime: { trendState: 'MIXED', regimeConfidence: null, regimeTags: [], volatilityState: null },
      }));
      expect(opportunity.preferredEntryZone).toBe('ZONE_1');
    });

    it('SELL + RANGE prefers ZONE_4 -- the favourable low-risk edge, not the trend-aligned middle zone', () => {
      const { opportunity, hiddenExecutionLevels } = buildRecommendation(baseInput({
        trades: sellTrades,
        marketRegime: { trendState: 'RANGE', regimeConfidence: null, regimeTags: [], volatilityState: null },
      }));
      expect(opportunity.direction).toBe('SELL');
      expect(opportunity.preferredEntryZone).toBe('ZONE_4');
      expect(hiddenExecutionLevels.stop).toBeGreaterThan(1.10); // outside (above) the band
      expect(hiddenExecutionLevels.target).toBeGreaterThanOrEqual(1.08); // inside (at) the band
      expect(hiddenExecutionLevels.target).toBeLessThan(hiddenExecutionLevels.entryPrice);
    });

    it('SELL + MIXED also prefers ZONE_4', () => {
      const { opportunity } = buildRecommendation(baseInput({
        trades: sellTrades,
        marketRegime: { trendState: 'MIXED', regimeConfidence: null, regimeTags: [], volatilityState: null },
      }));
      expect(opportunity.preferredEntryZone).toBe('ZONE_4');
    });

    it('BUY + TRENDING_UP prefers ZONE_2 -- trend-aligned, price may not pull back to the extreme; the 2:1 floor pushes target beyond the band here', () => {
      const { opportunity, hiddenExecutionLevels } = buildRecommendation(baseInput({
        marketRegime: { trendState: 'TRENDING_UP', regimeConfidence: null, regimeTags: [], volatilityState: null },
      }));
      expect(opportunity.direction).toBe('BUY');
      expect(opportunity.preferredEntryZone).toBe('ZONE_2');
      expect(hiddenExecutionLevels.stop).toBeLessThan(1.08); // stop is always outside the band, regardless of zone
      // entryPrice=1.085, stop=1.075 (lowerBand - step), stopDistance=0.01; natural
      // targetDistance=0.015 < 2*0.01=0.02 -> expands to entryPrice + 2*stopDistance.
      expect(hiddenExecutionLevels.target).toBeCloseTo(1.105, 10);
      expect(hiddenExecutionLevels.target).toBeGreaterThan(1.10); // beyond the band, by design
      expect(hiddenExecutionLevels.target).toBeGreaterThan(hiddenExecutionLevels.entryPrice);
      expect(hiddenExecutionLevels.rr).toBeCloseTo(2.0, 9);
    });

    it('SELL + TRENDING_DOWN prefers ZONE_3 -- trend-aligned, price may not rally back to the extreme; the 2:1 floor pushes target beyond the band here', () => {
      const { opportunity, hiddenExecutionLevels } = buildRecommendation(baseInput({
        trades: sellTrades,
        marketRegime: { trendState: 'TRENDING_DOWN', regimeConfidence: null, regimeTags: [], volatilityState: null },
      }));
      expect(opportunity.direction).toBe('SELL');
      expect(opportunity.preferredEntryZone).toBe('ZONE_3');
      expect(hiddenExecutionLevels.stop).toBeGreaterThan(1.10);
      // entryPrice=1.095, stop=1.105 (upperBand + step), stopDistance=0.01; natural
      // targetDistance=0.015 < 2*0.01=0.02 -> expands to entryPrice - 2*stopDistance.
      expect(hiddenExecutionLevels.target).toBeCloseTo(1.075, 10);
      expect(hiddenExecutionLevels.target).toBeLessThan(1.08); // beyond the band, by design
      expect(hiddenExecutionLevels.target).toBeLessThan(hiddenExecutionLevels.entryPrice);
      expect(hiddenExecutionLevels.rr).toBeCloseTo(2.0, 9);
    });

    it('BUY + TRENDING_DOWN (counter-trend) still prefers ZONE_1, not the trend-aligned zone', () => {
      const { opportunity } = buildRecommendation(baseInput({
        marketRegime: { trendState: 'TRENDING_DOWN', regimeConfidence: null, regimeTags: [], volatilityState: null },
      }));
      expect(opportunity.preferredEntryZone).toBe('ZONE_1');
    });

    it('SELL + TRENDING_UP (counter-trend) still prefers ZONE_4, not the trend-aligned zone', () => {
      const { opportunity } = buildRecommendation(baseInput({
        trades: sellTrades,
        marketRegime: { trendState: 'TRENDING_UP', regimeConfidence: null, regimeTags: [], volatilityState: null },
      }));
      expect(opportunity.preferredEntryZone).toBe('ZONE_4');
    });
  });
});



