// ============================================================================
// CoachingService + ReviewService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 11/12
// Contract: corrected against the real live coaching_recommendations schema
//           (verified via information_schema before finalising output type).
// ============================================================================
// SCHEMA FINDINGS (confirmed before rewrite):
//   - recommendation_id: PRIMARY KEY uuid (self-generated -- the coaching
//     row's own ID, misleadingly named but confirmed by constraint query)
//   - active_recommendation_version_id: FK -> recommendation_versions
//   - analyst_id: FK -> analysts (uuid, NOT a string name)
//   - opportunity_id: FK -> opportunities (unique with analyst_id --
//     one coaching row per analyst per opportunity, not per version)
//   - entry_range_low / entry_range_high: numeric (NOT a combined text field)
//   - risk_range / target_range: text (the ATR-band format already computed
//     by RecommendationService, passed through -- NOT the notebook's
//     "Around X" / "Towards X" format, which has no column home here)
//   - coaching_note, expected_r, trigger_probability, shown_at: as expected
//   - session, direction, current_zone, preferred_entry_zone, analyst_action,
//     event_risk_status, recommendation_validity_status: NOT persisted here,
//     recovered via joins to opportunities / recommendation_versions
//
// post_trade_reviews: confirmed does not exist yet -- needs migration 033.

import type { AtrZone, Direction, SessionType } from '../types/domain.js';

// ============================================================================
// COACHING SERVICE
// ============================================================================

const FORBIDDEN_ANALYST_TERMS = [
  'shadow trade', 'model beat you', 'non-compliant', 'wrong', 'failure', 'low confidence',
] as const;

const FALLBACK_COACHING_NOTE =
  'This market has a historically relevant setup today. Review the suggested range, risk area and target area with current conditions in mind.';

export function lintAnalystText(text: string): [boolean, string[]] {
  const lower = text.toLowerCase();
  const hits = FORBIDDEN_ANALYST_TERMS.filter((term) => lower.includes(term.toLowerCase()));
  return [hits.length === 0, hits];
}

// Python's :.5g: 5 significant figures, trailing zeros stripped.
// Verified byte-for-byte against Python output before use.
function sigFig5(value: number): string {
  return parseFloat(value.toPrecision(5)).toString();
}

export interface CoachingInput {
  recommendationId: string;              // PRIMARY KEY, caller-generated
  activeRecommendationVersionId: string; // FK -> recommendation_versions
  opportunityId: string;                 // FK -> opportunities
  analystId: string;                     // FK -> analysts (UUID, not name)
  // Fields needed to generate text -- recovered from the recommendation
  market: string;
  direction: Direction;
  currentZone: AtrZone | null;
  preferredEntryZone: AtrZone;
  analystAction: 'ENTER_NOW' | 'WAIT_FOR_PREFERRED_ZONE';
  entryRangeLow: number;
  entryRangeHigh: number;
  riskRange: string;    // ATR-band text from RecommendationService, passed through
  targetRange: string;  // same
  triggerProbability: number;
  expectedR: number;
  eventWarning: string;
  recommendationValidityStatus: string;
  volatilityWarning: string;
  shownAt: string;
}

/** Maps to the coaching_recommendations table. */
export interface CoachingOutput {
  recommendationId: string;
  activeRecommendationVersionId: string;
  opportunityId: string;
  analystId: string;
  entryRangeLow: number;
  entryRangeHigh: number;
  riskRange: string;
  targetRange: string;
  triggerProbability: number;
  expectedR: number;
  coachingNote: string;
  shownAt: string;
  // Linting metadata -- not a persisted column, but useful for caller audit.
  lintPassed: boolean;
  lintHits: string[];
}

// Plain-English descriptions of ATR zone positions -- per spec sheet 11
// coaching language guidance. Avoid zone number terminology with analysts.
function describeZone(zone: string | null): string {
  switch (zone) {
    case 'ZONE_1': return 'near the lower end of its recent range'
    case 'ZONE_2': return 'in the lower-mid section of its recent range'
    case 'ZONE_3': return 'in the upper-mid section of its recent range'
    case 'ZONE_4': return 'near the upper end of its recent range'
    case 'TOO_HIGH': return 'trading above its recent range'
    case 'TOO_DEEP': return 'trading below its recent range'
    default: return 'at an unclassified position in its range'
  }
}

function describePreferredZone(zone: string | null): string {
  switch (zone) {
    case 'ZONE_1': return 'the lower end of its range'
    case 'ZONE_2': return 'the lower-mid section of its range'
    case 'ZONE_3': return 'the upper-mid section of its range'
    case 'ZONE_4': return 'the upper end of its range'
    default: return 'its preferred range'
  }
}

export function generateCoachingNote(input: CoachingInput): string {
  const currentZoneDesc = describeZone(input.currentZone)
  const preferredZoneDesc = describePreferredZone(input.preferredEntryZone)
  const directionText = input.direction === 'BUY' ? 'buy' : 'sell'
  const triggerPct = Math.round(input.triggerProbability * 100)
  const entryLow = sigFig5(input.entryRangeLow)
  const entryHigh = sigFig5(input.entryRangeHigh)

  let text: string

  // Entry out of range -- acknowledge distance, advise monitoring
  if (input.recommendationValidityStatus === 'ENTRY_ALREADY_PASSED') {
    text =
      `${input.market} is currently ${currentZoneDesc}, away from the preferred ${directionText} area. ` +
      `The historical setup favours ${directionText} interest from ${preferredZoneDesc} (${entryLow}–${entryHigh}). ` +
      `Price has moved away from this area — monitor for a return before acting. ` +
      `Levels will refresh at the next session update.`
  } else if (input.analystAction === 'ENTER_NOW') {
    text =
      `${input.market} is ${currentZoneDesc}, which aligns with the preferred ${directionText} area. ` +
      `The suggested entry region is ${entryLow} to ${entryHigh}, ` +
      `with an estimated trigger probability of ${triggerPct}% ` +
      `and expected opportunity of ${input.expectedR.toFixed(2)}R.`
  } else {
    text =
      `${input.market} is currently ${currentZoneDesc}. ` +
      `The historical profile favours ${directionText} interest from ${preferredZoneDesc}, ` +
      `with a suggested entry region of ${entryLow} to ${entryHigh}. ` +
      `Estimated trigger probability ${triggerPct}%, expected opportunity ${input.expectedR.toFixed(2)}R.`
  }

  if (input.recommendationValidityStatus !== 'VALID' &&
      input.recommendationValidityStatus !== 'ENTRY_ALREADY_PASSED' &&
      input.volatilityWarning) {
    text += ` Condition note: ${input.volatilityWarning}`
  }
  if (input.eventWarning) {
    text += ` Event risk: ${input.eventWarning}`
  }
  if (input.recommendationValidityStatus !== 'ENTRY_ALREADY_PASSED') {
    text += ' Treat this as a coaching range rather than an instruction; execution judgement remains important.'
  }

  const [ok] = lintAnalystText(text)
  return ok ? text : FALLBACK_COACHING_NOTE
}

export function buildCoachingRecommendation(input: CoachingInput): CoachingOutput {
  const coachingNote = generateCoachingNote(input);
  const [lintPassed, lintHits] = lintAnalystText(coachingNote);

  return {
    recommendationId: input.recommendationId,
    activeRecommendationVersionId: input.activeRecommendationVersionId,
    opportunityId: input.opportunityId,
    analystId: input.analystId,
    entryRangeLow: input.entryRangeLow,
    entryRangeHigh: input.entryRangeHigh,
    riskRange: input.riskRange,
    targetRange: input.targetRange,
    triggerProbability: input.triggerProbability,
    expectedR: input.expectedR,
    coachingNote,
    shownAt: input.shownAt,
    lintPassed,
    lintHits,
  };
}

// ============================================================================
// REVIEW SERVICE
// ============================================================================
// post_trade_reviews does not exist yet in the live schema -- needs
// migration 033 before this service's output can be persisted.
// Built here faithfully against the notebook's build_post_trade_reviews()
// formula; the migration will be shaped to match this output type.
//
// CALLER RESPONSIBILITY: exclude historical_backfill === true rows BEFORE
// passing trades here. Per notebook cell 0: "Historical backfill rows
// cannot be used for coaching-alignment reviews." This service does not
// filter them itself -- pure function, no database access.

export interface TradeForReview {
  tradeId: string;
  market: string;
  session: SessionType;
  direction: Direction;
  entry: number;
  resultR: number | null;
}

export interface RecommendationForReview {
  recommendationVersionId: string;
  market: string;
  session: SessionType;
  direction: Direction;
  entryRangeLow: number;
  entryRangeHigh: number;
}

export interface PostTradeReview {
  reviewId: string;
  tradeId: string;
  recommendationVersionId: string | null;
  market: string;
  session: SessionType;
  directionAlignment: 'Aligned' | 'Different';
  entryAlignment: 'High' | 'Low';
  alignmentScore: 0 | 1 | 2;
  analystFacingReview: string;
}

const ANALYST_FACING_REVIEW =
  'Review generated against the recommendation shown. Use this as a learning point rather than a judgement.';

export interface BuildPostTradeReviewsInput {
  trades: TradeForReview[];
  recommendations: RecommendationForReview[];
  generateId: () => string;
}

export function buildPostTradeReviews(input: BuildPostTradeReviewsInput): PostTradeReview[] {
  const { trades, recommendations, generateId } = input;
  if (trades.length === 0 || recommendations.length === 0) return [];

  const recoIndex = new Map<string, RecommendationForReview>();
  for (const reco of recommendations) {
    recoIndex.set(`${reco.market}|${reco.session}`, reco);
  }

  return trades.map((trade) => {
    const reco = recoIndex.get(`${trade.market}|${trade.session}`) ?? null;
    const directionAlignment: 'Aligned' | 'Different' =
      reco && trade.direction === reco.direction ? 'Aligned' : 'Different';
    const entryAlignment: 'High' | 'Low' =
      reco !== null && trade.entry >= reco.entryRangeLow && trade.entry <= reco.entryRangeHigh
        ? 'High' : 'Low';
    const alignmentScore = (
      (directionAlignment === 'Aligned' ? 1 : 0) +
      (entryAlignment === 'High' ? 1 : 0)
    ) as 0 | 1 | 2;

    return {
      reviewId: generateId(), tradeId: trade.tradeId,
      recommendationVersionId: reco?.recommendationVersionId ?? null,
      market: trade.market, session: trade.session,
      directionAlignment, entryAlignment, alignmentScore,
      analystFacingReview: ANALYST_FACING_REVIEW,
    };
  });
}
