// RecommendationService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 10 (build_recommendations)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.3.md Section 3.9,
//           amended per product clarification (see V1.4 changelog) to match
//           the REAL `opportunities`/`recommendation_versions`/
//           `coverage_allocation` schema, verified directly against the
//           live database rather than assumed from the notebook's flat
//           output shape.
// ============================================================================
// STRUCTURAL CHANGE FROM EARLIER DRAFT: this service now returns THREE
// separate things, not one flat object, because the real schema is three
// separate tables with three separate purposes:
//   1. OpportunityOutput        -> opportunities (one row per market/date/session)
//   2. RecommendationVersionOutput -> recommendation_versions (one row per
//      version of the entry/stop/target geometry, analyst-FACING)
//   3. hiddenExecutionLevels    -> NOT a table -- precise numeric levels for
//      the future ShadowTradeService (Step 7) ONLY. Never analyst-facing.
//      `coverage_allocation` (the FINAL analyst assignment, distinct from
//      this service's `assignedAnalystId` preference) is AllocationService's
//      job entirely (Step 8) -- this service does not touch it.
//
// Template/profile diagnostic fields (template_quality, profile_quality,
// etc.) are deliberately NOT included in either persisted output -- per
// product clarification, they are not duplicated onto recommendation_versions
// in V1; a reader joins back to template_profiles/analyst_profiles instead.
// They remain available in the `diagnostics` return value for debugging/
// testing ONLY -- diagnostics is explicitly not a persisted shape.
//
// DIRECTION CONSTRAINT (V1.4 amendment):
//   Caller may pass preferredDirection derived from market regime and/or
//   current zone position. This constrains template selection to aligned
//   direction only, preventing countertrend setups.
import type { AtrZone, Direction, SessionType, ImplementedValidityState } from '../types/domain.js';
import type { MarketStateOutput } from './marketStateService.js';
import type { MarketRegimeOutput } from './marketRegimeService.js';
import type { MarketEventRiskOutput } from './economicCalendarService.js';
import { buildTemplateProfiles, selectBestTemplate, type TemplateProfile, type HistoricalTradeForProfiling } from './templateService.js';
import { buildAnalystProfiles, selectBestAnalyst, type AnalystProfile, type ActiveAnalyst, type AnalystHistoricalTrade } from './analystProfileService.js';
import { buildEntryOptimizer } from './entryOptimizerService.js';
import { estimateTriggerProbability } from './triggerProbabilityService.js';
import { calculateExpectedR } from './expectedRService.js';
import { assessCondition } from './recommendationLifecycleService.js';
import { formatGuidanceRange } from './guidanceRangeFormatter.js';
export interface RecommendationInputTrade extends HistoricalTradeForProfiling, AnalystHistoricalTrade {}
export interface BuildRecommendationInput {
  recommendationVersionId: string;
  generatedAt: string;
  market: string;
  session: SessionType;
  marketState: MarketStateOutput;
  marketRegime: MarketRegimeOutput | null;
  eventRisks: MarketEventRiskOutput[];
  trades: RecommendationInputTrade[];
  activeAnalysts: ActiveAnalyst[];
  minimumRr: number;
  minTriggerSample: number;
  fallbackTriggerProbability: number;
  staleAtrThreshold: number;
  forceRecalcAtrThreshold: number;
  parameterSnapshot: Record<string, unknown>;
  parameterSnapshotHash: string;
  marketDisplayPrecision: number | null;
  preferredDirection?: Direction | null; // derived from regime/zone in runEngineSession
}
export type OpportunityLifecycleStatus = 'DRAFT' | 'GENERATED' | 'ASSIGNED' | 'SHOWN' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
/** Maps to the `opportunities` table. */
export interface OpportunityOutput {
  opportunityId: string;
  market: string;
  session: SessionType;
  date: string;
  direction: Direction;
  currentZone: AtrZone | null;
  preferredEntryZone: AtrZone;
  analystAction: 'ENTER_NOW' | 'WAIT_FOR_PREFERRED_ZONE';
  expectedR: number;
  triggerProbability: number;
  assignedAnalystId: string | null;
  opportunityLifecycleStatus: OpportunityLifecycleStatus;
}
/** Maps to the `recommendation_versions` table -- analyst-facing fields only. */
export interface RecommendationVersionOutput {
  recommendationVersionId: string;
  opportunityId: string;
  versionNumber: number;
  entryRangeLow: number;
  entryRangeHigh: number;
  riskRange: string;
  targetRange: string;
  recommendationValidityStatus: ImplementedValidityState;
  requiresRefresh: boolean;
  zoneAtGeneration: AtrZone | null;
  priceAtGeneration: number;
  eventRiskStatus: string;
  regimeTags: string[];
  parameterSnapshot: Record<string, unknown>;
  parameterSnapshotHash: string;
  volatilityWarning: string;
  atrMoveSinceGeneration: number | null;
}
export interface HiddenExecutionLevels {
  entryMid: number;
  stop: number;
  target: number;
  rr: number;
}
export interface RecommendationDiagnostics {
  templateSource: 'historical_template' | 'fallback';
  templateAvgR: number;
  templateWinRate: number | null;
  templateTrades: number;
  templateQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  profileSource: 'exact_profile' | 'market_profile' | 'fallback';
  profileAvgR: number;
  profileWinRate: number | null;
  profileTrades: number;
  profileQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  eligibleAnalysts: string[];
  eventWarning: string;
}
export interface BuildRecommendationOutput {
  opportunity: OpportunityOutput;
  recommendationVersion: RecommendationVersionOutput;
  hiddenExecutionLevels: HiddenExecutionLevels;
  diagnostics: RecommendationDiagnostics;
}
export function buildRecommendation(input: BuildRecommendationInput): BuildRecommendationOutput {
  const {
    recommendationVersionId, generatedAt, market, session, marketState, marketRegime, eventRisks,
    trades, activeAnalysts, minimumRr, minTriggerSample, fallbackTriggerProbability,
    staleAtrThreshold, forceRecalcAtrThreshold, parameterSnapshot, parameterSnapshotHash,
    marketDisplayPrecision, preferredDirection,
  } = input;
  const templates: TemplateProfile[] = buildTemplateProfiles(trades);
  // Pass preferredDirection constraint -- derived from regime/zone in caller
  const template = selectBestTemplate(market, templates, preferredDirection);
  const direction = template.direction;
  const zone = template.preferredEntryZone;
  const analystProfiles: AnalystProfile[] = buildAnalystProfiles(trades);
  const profile = selectBestAnalyst(market, direction, zone, analystProfiles, activeAnalysts, session);
  const entryStopTarget = buildEntryOptimizer({ marketState, direction, preferredZone: zone, minimumRr });
  const trigger = estimateTriggerProbability({
    market, direction, zone, trades, minTriggerSample, fallbackProbability: fallbackTriggerProbability,
  });
  const expected = calculateExpectedR({
    template: { templateAvgR: template.templateAvgR, templateTrades: template.templateTrades },
    profile: { profileAvgR: profile.profileAvgR, profileTrades: profile.profileTrades },
    trigger: { triggerProbability: trigger.triggerProbability },
  });
  const topEventRisk = eventRisks.length > 0 ? [...eventRisks].sort((a, b) => b.riskScore - a.riskScore)[0]! : null;
  const eventRiskStatus = topEventRisk?.eventRiskStatus ?? 'NONE';
  const eventWarning = topEventRisk?.analystWarning ?? '';
  const dateOnly = generatedAt.slice(0, 10);
  const opportunityId = `${dateOnly}_${market}_${session}_v1`;
  const analystAction: 'ENTER_NOW' | 'WAIT_FOR_PREFERRED_ZONE' =
    marketState.currentZone === zone ? 'ENTER_NOW' : 'WAIT_FOR_PREFERRED_ZONE';
  const condition = assessCondition({
    currentPrice: marketState.currentPrice,
    priceAtGeneration: marketState.currentPrice,
    zoneAtGeneration: marketState.currentZone ?? '',
    currentZone: marketState.currentZone,
    atr14: marketState.atr14,
    staleAtrThreshold, forceRecalcAtrThreshold,
  });
  const riskRange = formatGuidanceRange({
    entryMid: entryStopTarget.entryMid,
    distanceLow: entryStopTarget.riskRangeLow,
    distanceHigh: entryStopTarget.riskRangeHigh,
    direction, type: 'risk',
    displayPrecision: marketDisplayPrecision,
  });
  const targetRange = formatGuidanceRange({
    entryMid: entryStopTarget.entryMid,
    distanceLow: entryStopTarget.targetRangeLow,
    distanceHigh: entryStopTarget.targetRangeHigh,
    direction, type: 'target',
    displayPrecision: marketDisplayPrecision,
  });
  const opportunity: OpportunityOutput = {
    opportunityId, market, session, date: dateOnly, direction,
    currentZone: marketState.currentZone, preferredEntryZone: zone, analystAction,
    expectedR: expected.expectedR, triggerProbability: trigger.triggerProbability,
    assignedAnalystId: profile.assignedAnalyst, opportunityLifecycleStatus: 'GENERATED',
  };
  const recommendationVersion: RecommendationVersionOutput = {
    recommendationVersionId, opportunityId, versionNumber: 1,
    entryRangeLow: entryStopTarget.entryRangeLow, entryRangeHigh: entryStopTarget.entryRangeHigh,
    riskRange, targetRange,
    recommendationValidityStatus: condition.recommendationValidityStatus, requiresRefresh: condition.requiresRefresh,
    zoneAtGeneration: marketState.currentZone, priceAtGeneration: marketState.currentPrice,
    eventRiskStatus, regimeTags: marketRegime?.regimeTags ?? [],
    parameterSnapshot, parameterSnapshotHash,
    volatilityWarning: condition.volatilityWarning, atrMoveSinceGeneration: condition.atrMoveSinceGeneration,
  };
  const hiddenExecutionLevels: HiddenExecutionLevels = {
    entryMid: entryStopTarget.entryMid, stop: entryStopTarget.stop, target: entryStopTarget.target, rr: entryStopTarget.rr,
  };
  const diagnostics: RecommendationDiagnostics = {
    templateSource: template.templateSource, templateAvgR: template.templateAvgR, templateWinRate: template.templateWinRate,
    templateTrades: template.templateTrades, templateQuality: template.templateQuality,
    profileSource: profile.profileSource, profileAvgR: profile.profileAvgR, profileWinRate: profile.profileWinRate,
    profileTrades: profile.profileTrades, profileQuality: profile.profileQuality,
    eligibleAnalysts: profile.eligibleAnalysts,
    eventWarning,
  };
  return { opportunity, recommendationVersion, hiddenExecutionLevels, diagnostics };
}
