// ============================================================================
// ShadowTradeService (creation only -- see file footer for outcome evolution scope)
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 11 (build_shadow_trades),
//          adjusted against the REAL live schema, verified directly via
//          information_schema.columns before writing any code -- same
//          discipline that caught Step 5's RecommendationService mismatch.
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.6.md Section 3.11,
//           corrected in this step -- see V1.7 changelog.
// ============================================================================
// REAL SCHEMA FINDINGS, confirmed against live shadow_trades/
// shadow_trade_outcomes columns, NOT assumed from the notebook:
//
//   - market/session/direction/trigger_probability/expected_r/
//     parameter_snapshot_hash are NOT columns on shadow_trades, even
//     though the notebook's build_shadow_trades copies all of them onto
//     the shadow trade record directly. Confirms Architecture Section 1.6's
//     resolution was correct: recovered via the recommendation_version_id/
//     opportunity_id FKs and a join, not duplicated.
//   - shadow_status (notebook: 'ACTIVE' if VALID else 'WATCH') is also NOT
//     a column -- also confirmed correct per Section 1.6.
//   - template_source IS a real column, and the notebook never mentions it
//     at all -- a deliberate schema addition beyond the notebook, almost
//     certainly because whether a shadow trade's benchmark came from a real
//     historical template match or a fallback matters specifically for
//     evaluating automation readiness (this table's whole purpose).
//   - confidence_label IS a real column (already known, Architecture
//     Section 12 item 2) but has NO notebook-validated formula. Populated
//     as the LITERAL value `null` here, not `'LOW'`/an invented default --
//     typed as a literal so any future attempt to populate it with a real
//     formula is a deliberate, visible type change (and therefore its own
//     architecture amendment), mirroring the same discipline already used
//     for `visibleToAnalyst: false`.
//
// SCOPE: this file covers CREATION only. Outcome EVOLUTION (the logic that
// would move trade_outcome_status from NOT_TRIGGERED to TRIGGERED/
// TARGET_HIT/STOP_HIT/EXPIRY as the market actually moves) has zero
// notebook precedent and is Architecture Section 12 item 3 -- still
// genuinely open, not addressed by this file. Every shadow trade created
// here gets an initial outcome row at NOT_TRIGGERED, nothing more.

// Per product clarification: the full vocabulary spans both TemplateService's
// own classification (historical_template/fallback) and AnalystProfileService's
// (exact_profile/market_profile), plus 'unknown' as an explicit, honest
// fallback when no selection-path diagnostic is available at all -- never a
// silent default a caller didn't choose. ShadowTradeService does not decide
// WHICH of the five values applies for a given recommendation -- that
// decision belongs to whatever wires RecommendationService's diagnostics
// into this service (not yet built); this service only persists whatever
// value it's given, faithfully. INTERNAL-ONLY -- never expose this value,
// or any shadow_trades field, to an analyst, per the Hidden Boundary
// (Architecture Section 9).
export type TemplateSource = 'historical_template' | 'fallback' | 'exact_profile' | 'market_profile' | 'unknown';

export interface CreateShadowTradeInput {
  shadowTradeId: string;         // caller-generated -- pure function, no internal uuid/Date.now()
  shadowOutcomeId: string;       // caller-generated, for the paired initial outcome row
  createdAt: string;             // ISO timestamp, caller-supplied for the same reason
  recommendationVersionId: string;
  opportunityId: string;
  entry: number;                 // from HiddenExecutionLevels.entryMid -- the EXACT precise level, never the analyst-facing text range
  stop: number;
  target: number;
  rr: number;
  templateSource: TemplateSource; // from RecommendationDiagnostics.templateSource
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
  confidenceLabel: null; // literal type -- see file header. No notebook-validated formula exists; do not invent one here.
  visibleToAnalyst: false; // literal type, enforced at compile time -- mirrors the same discipline as confidenceLabel
  createdAt: string;
}

/** Maps to the `shadow_trade_outcomes` table -- initial row only. */
export interface ShadowTradeOutcomeOutput {
  shadowOutcomeId: string;
  shadowTradeId: string;
  tradeOutcomeStatus: 'NOT_TRIGGERED'; // literal -- this service never produces any other status, see SCOPE note above
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
    entry, stop, target, rr, templateSource,
  } = input;

  const shadowTrade: ShadowTradeOutput = {
    shadowTradeId, recommendationVersionId, opportunityId,
    entry, stop, target, rr, templateSource,
    confidenceLabel: null,
    visibleToAnalyst: false,
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
