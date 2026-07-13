// ============================================================================
// ShadowTradeService (creation only -- see file footer for outcome evolution scope)
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 11 (build_shadow_trades),
//          adjusted against the REAL live schema, verified directly via
//          information_schema.columns before writing any code -- same
//          discipline that caught Step 5's RecommendationService mismatch.
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.6.md Section 3.11,
//           corrected in this step -- see V1.7 changelog.
// ============================================================================
export type TemplateSource = 'historical_template' | 'fallback' | 'exact_profile' | 'market_profile' | 'unknown';

export interface CreateShadowTradeInput {
  shadowTradeId: string;
  shadowOutcomeId: string;
  createdAt: string;
  recommendationVersionId: string;
  opportunityId: string;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  templateSource: TemplateSource;
  direction: 'BUY' | 'SELL';
  session: string;
}

/** Maps to the `shadow_trades` table. */
export interface ShadowTradeOutput {
  shadowTradeId: string;
  recommendationVersionId: string;
  opportunityId: string;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  templateSource: TemplateSource;
  confidenceLabel: null;
  visibleToAnalyst: false;
  direction: 'BUY' | 'SELL';
  session: string;
  createdAt: string;
}

/** Maps to the `shadow_trade_outcomes` table -- initial row only. */
export interface ShadowTradeOutcomeOutput {
  shadowOutcomeId: string;
  shadowTradeId: string;
  tradeOutcomeStatus: 'NOT_TRIGGERED';
  resultR: null;
  outcomeTimestamp: null;
  createdAt: string;
}

export interface CreateShadowTradeOutput {
  shadowTrade: ShadowTradeOutput;
  shadowTradeOutcome: ShadowTradeOutcomeOutput;
}

export function createShadowTrade(input: CreateShadowTradeInput): CreateShadowTradeOutput {
  const {
    shadowTradeId, shadowOutcomeId, createdAt, recommendationVersionId, opportunityId,
    entry, stop, target, rr, templateSource, direction, session,
  } = input;

  const shadowTrade: ShadowTradeOutput = {
    shadowTradeId, recommendationVersionId, opportunityId,
    entry, stop, target, rr, templateSource,
    confidenceLabel: null,
    visibleToAnalyst: false,
    direction, session,
    createdAt,
  };

  const shadowTradeOutcome: ShadowTradeOutcomeOutput = {
    shadowOutcomeId, shadowTradeId,
    tradeOutcomeStatus: 'NOT_TRIGGERED',
    resultR: null,
    outcomeTimestamp: null,
    createdAt,
  };

  return { shadowTrade, shadowTradeOutcome };
}
