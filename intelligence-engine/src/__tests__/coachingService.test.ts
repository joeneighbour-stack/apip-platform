import { describe, it, expect } from 'vitest';
import {
  lintAnalystText, generateCoachingNote, buildCoachingRecommendation,
  buildPostTradeReviews, type CoachingInput, type TradeForReview, type RecommendationForReview,
} from '../services/coachingService.js';

function baseInput(overrides: Partial<CoachingInput> = {}): CoachingInput {
  return {
    recommendationId: 'rec-uuid-1', activeRecommendationVersionId: 'rv-uuid-1',
    opportunityId: 'opp-uuid-1', analystId: 'analyst-uuid-1',
    market: 'EURUSD', direction: 'BUY', currentZone: 'ZONE_2',
    preferredEntryZone: 'ZONE_2', analystAction: 'ENTER_NOW',
    entryRangeLow: 1.0875, entryRangeHigh: 1.09,
    riskRange: '1.0815\u20131.0835', targetRange: '1.0965\u20131.0985',
    triggerProbability: 0.65, expectedR: 1.30,
    eventWarning: '', recommendationValidityStatus: 'VALID', volatilityWarning: '',
    shownAt: '2026-01-15T08:00:00Z',
    ...overrides,
  };
}

describe('lintAnalystText', () => {
  it('passes clean text', () => {
    const [ok, hits] = lintAnalystText('EURUSD looks interesting today near ZONE_2.');
    expect(ok).toBe(true);
    expect(hits).toHaveLength(0);
  });

  it('flags each of the six forbidden terms', () => {
    for (const term of ['shadow trade', 'model beat you', 'non-compliant', 'wrong', 'failure', 'low confidence']) {
      const [ok, hits] = lintAnalystText(`Contains ${term} here.`);
      expect(ok).toBe(false);
      expect(hits).toContain(term);
    }
  });

  it('is case-insensitive', () => {
    const [ok] = lintAnalystText('Contains SHADOW TRADE in uppercase.');
    expect(ok).toBe(false);
  });
});

describe('generateCoachingNote', () => {
  it('produces the exact notebook template text for a VALID recommendation', () => {
    const note = generateCoachingNote(baseInput());
    expect(note).toContain('EURUSD is currently in ZONE_2.');
    expect(note).toContain('favours BUY interest around ZONE_2.');
    expect(note).toContain('1.0875 to 1.09');
    expect(note).toContain('65%');
    expect(note).toContain('1.30R');
    expect(note).toContain('Treat this as a coaching range rather than an instruction');
  });

  it('appends volatility warning only when not VALID', () => {
    const withWarning = generateCoachingNote(baseInput({
      recommendationValidityStatus: 'STALE_PRICE',
      volatilityWarning: 'Market has moved.',
    }));
    expect(withWarning).toContain('Current condition note: Market has moved.');

    const withoutWarning = generateCoachingNote(baseInput({
      recommendationValidityStatus: 'VALID',
      volatilityWarning: 'Should be suppressed.',
    }));
    expect(withoutWarning).not.toContain('Current condition note:');
  });

  it('appends event risk note when non-empty', () => {
    const note = generateCoachingNote(baseInput({ eventWarning: 'High impact event at 13:30.' }));
    expect(note).toContain('Event risk note: High impact event at 13:30.');
  });

  it('falls back to exact notebook fallback string when a forbidden term appears', () => {
    const note = generateCoachingNote(baseInput({
      recommendationValidityStatus: 'STALE_PRICE',
      volatilityWarning: 'low confidence in this setup.',
    }));
    expect(note).toBe('This market has a historically relevant setup today. Review the suggested range, risk area and target area with current conditions in mind.');
  });

  it('uses sigFig5 (:.5g equivalent) not toFixed -- 110.5 stays "110.5" not "110.50000"', () => {
    const note = generateCoachingNote(baseInput({ entryRangeLow: 110.5, entryRangeHigh: 111.0 }));
    expect(note).toContain('110.5 to 111');
    expect(note).not.toContain('110.50000');
  });
});

describe('buildCoachingRecommendation', () => {
  it('maps correctly to the real schema shape -- numeric entry ranges, text riskRange/targetRange passed through', () => {
    const result = buildCoachingRecommendation(baseInput());
    expect(result.entryRangeLow).toBe(1.0875);
    expect(result.entryRangeHigh).toBe(1.09);
    expect(result.riskRange).toBe('1.0815\u20131.0835');
    expect(result.targetRange).toBe('1.0965\u20131.0985');
    expect(typeof result.riskRange).toBe('string');
  });

  it('uses analystId (UUID) not a string name, recommendationId as primary key', () => {
    const result = buildCoachingRecommendation(baseInput());
    expect(result.analystId).toBe('analyst-uuid-1');
    expect(result.recommendationId).toBe('rec-uuid-1');
    expect(result).not.toHaveProperty('assignedAnalyst');
    expect(result).not.toHaveProperty('session');
    expect(result).not.toHaveProperty('direction');
  });

  it('exposes lintPassed and lintHits for caller audit', () => {
    const result = buildCoachingRecommendation(baseInput());
    expect(result.lintPassed).toBe(true);
    expect(result.lintHits).toHaveLength(0);
  });
});

describe('buildPostTradeReviews', () => {
  const reco: RecommendationForReview = {
    recommendationVersionId: 'rv-1', market: 'EURUSD', session: 'EUROPEAN',
    direction: 'BUY', entryRangeLow: 1.085, entryRangeHigh: 1.09,
  };
  let idCounter = 0;
  const generateId = () => `review-${++idCounter}`;

  it('returns empty when trades or recommendations is empty', () => {
    expect(buildPostTradeReviews({ trades: [], recommendations: [reco], generateId })).toHaveLength(0);
  });

  it('alignmentScore 2 when direction and entry both match', () => {
    const trade: TradeForReview = { tradeId: 't1', market: 'EURUSD', session: 'EUROPEAN', direction: 'BUY', entry: 1.087, resultR: 1.5 };
    const result = buildPostTradeReviews({ trades: [trade], recommendations: [reco], generateId });
    expect(result[0]!.directionAlignment).toBe('Aligned');
    expect(result[0]!.entryAlignment).toBe('High');
    expect(result[0]!.alignmentScore).toBe(2);
  });

  it('alignmentScore 0 when direction mismatches and entry out of range', () => {
    const trade: TradeForReview = { tradeId: 't2', market: 'EURUSD', session: 'EUROPEAN', direction: 'SELL', entry: 1.10, resultR: -0.5 };
    const result = buildPostTradeReviews({ trades: [trade], recommendations: [reco], generateId });
    expect(result[0]!.alignmentScore).toBe(0);
  });

  it('null recommendationVersionId when no matching recommendation exists', () => {
    const trade: TradeForReview = { tradeId: 't3', market: 'GBPUSD', session: 'EUROPEAN', direction: 'BUY', entry: 1.27, resultR: 1.0 };
    const result = buildPostTradeReviews({ trades: [trade], recommendations: [reco], generateId });
    expect(result[0]!.recommendationVersionId).toBeNull();
  });

  it('analystFacingReview is the exact notebook string', () => {
    const trade: TradeForReview = { tradeId: 't4', market: 'EURUSD', session: 'EUROPEAN', direction: 'BUY', entry: 1.087, resultR: 1.0 };
    const result = buildPostTradeReviews({ trades: [trade], recommendations: [reco], generateId });
    expect(result[0]!.analystFacingReview).toBe('Review generated against the recommendation shown. Use this as a learning point rather than a judgement.');
  });
});
