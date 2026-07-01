// ============================================================================
// ValidationService (Behavioural Equivalence Engine)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.9.md Section 10
// ============================================================================
// There is NO notebook implementation of ValidationService -- the notebook
// treats equivalence as a principle (cell 14: "Research Notebook
// Recommendation ≈ Production Platform Recommendation... The implementation
// can differ. The behaviour should not."), not as implemented code. This
// entire service is our own design, built precisely against the architecture
// document's Section 10.1-10.6 contract.
//
// WHAT THIS DOES: given a production recommendation output and a research
// notebook output for the same market/session/parameter snapshot, compare
// them field by field, classify any differences (with reason and severity),
// and produce a structured BehaviouralDifferenceReport ready to persist into
// engine_validation_runs.
//
// WHAT THIS DOES NOT DO: it does not query the notebook, fetch live data, or
// write to the database -- pure function, no I/O, consistent with every other
// service in this engine. The caller is responsible for running the notebook
// and providing its output as a plain object.
//
// FLOATING-POINT TOLERANCE: per Section 10.1, 1e-9 relative tolerance for
// numeric fields. Fields matching within this band are MATCH, not drift.

import { stableHash } from './stableHash.js';

export type DriftReason =
  | 'FLOATING_POINT_ROUNDING'     // delta within 2x tolerance band
  | 'INPUT_DATA_DIFFERENCE'       // runs did not receive identical input data
  | 'PARAMETER_SNAPSHOT_MISMATCH' // parameter_snapshot_hash differs
  | 'ENUM_MAPPING_ERROR'          // Section 1.2/1.3 naming mismatch slipped through
  | 'LOGIC_DIVERGENCE'            // the formulas themselves disagree -- the serious case
  | 'UNCLASSIFIED';               // could not be automatically attributed -- always escalate

export type DriftSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type EquivalenceStatus = 'MATCH' | 'DRIFT_DETECTED' | 'NOT_COMPARABLE';
export type ResolutionType = 'NOTEBOOK_UPDATED' | 'PRODUCTION_BUG_FIXED' | 'ACCEPTED_AS_INTENTIONAL_VARIANCE';

export interface FieldDifference {
  field: string;
  researchValue: unknown;
  productionValue: unknown;
  delta: number | string;
  deltaUnit: 'absolute' | 'atr_multiple' | 'percentage' | 'categorical';
  reason: DriftReason;
  severity: DriftSeverity;
}

export interface BehaviouralDifferenceReport {
  validationRunId: string;       // caller-generated
  recommendationVersionId: string;
  researchEngineVersion: string;
  productionEngineVersion: string;
  parameterSnapshotHash: string;
  recommendationHash: string;
  researchRecommendationHash: string | null;
  overallStatus: EquivalenceStatus;
  differences: FieldDifference[]; // empty when overallStatus === 'MATCH'
  highestSeverity: DriftSeverity | null;
  validatedAt: string;
}

// The fields we actually compare -- mapped from production output field names.
// Only fields that have a direct notebook equivalent are included; fields that
// exist ONLY in production (e.g. parameterSnapshotHash, opportunityId) are
// not compared, since the notebook doesn't produce them.
const NUMERIC_FIELDS = [
  'entryRangeLow', 'entryRangeHigh', 'entryMid',
  'stop', 'target', 'rr',
  'triggerProbability', 'expectedR', 'rawExpectedR',
] as const;

const CATEGORICAL_FIELDS = [
  'direction', 'preferredEntryZone', 'currentZone',
  'analystAction', 'recommendationValidityStatus', 'templateSource',
] as const;

// Numeric tolerance per Section 10.1: 1e-9 relative tolerance.
const NUMERIC_TOLERANCE = 1e-9;

function relativeError(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  const magnitude = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / magnitude;
}

function classifyNumericSeverity(relErr: number): DriftSeverity {
  if (relErr <= 2 * NUMERIC_TOLERANCE) return 'LOW';    // within 2x tolerance band -- likely floating-point rounding
  if (relErr <= 0.05) return 'MEDIUM';                  // within 5% relative difference
  return 'HIGH';
}

function classifyCategoricalSeverity(field: string, a: unknown, b: unknown): DriftSeverity {
  // Per Section 10.5: recommendationValidityStatus is CRITICAL only when
  // DO_NOT_USE_RECALCULATE is involved (either side) -- that's the specific
  // condition that would change whether an analyst acts on a recommendation
  // at all. VALID↔STALE_PRICE does NOT involve DO_NOT_USE_RECALCULATE, so
  // it is not automatically CRITICAL.
  if (field === 'recommendationValidityStatus') {
    if (String(a) === 'DO_NOT_USE_RECALCULATE' || String(b) === 'DO_NOT_USE_RECALCULATE') return 'CRITICAL';
    const adjacentPairs = new Set(['VALID|STALE_PRICE', 'STALE_PRICE|VALID']);
    if (adjacentPairs.has(`${String(a)}|${String(b)}`)) return 'MEDIUM';
    return 'HIGH';
  }
  // direction and analystAction directly change what an analyst does -- always CRITICAL.
  if (field === 'direction' || field === 'analystAction') return 'CRITICAL';
  // All other categorical fields -- adjacent zone states would be MEDIUM, others HIGH.
  return 'HIGH';
}

function autoClassifyReason(
  field: string, relErr: number, paramHashMatch: boolean,
): DriftReason {
  if (!paramHashMatch) return 'PARAMETER_SNAPSHOT_MISMATCH';
  if (relErr <= 2 * NUMERIC_TOLERANCE) return 'FLOATING_POINT_ROUNDING';
  // Cannot automatically determine LOGIC_DIVERGENCE vs INPUT_DATA_DIFFERENCE
  // or ENUM_MAPPING_ERROR -- return UNCLASSIFIED and let a human decide.
  return 'UNCLASSIFIED';
}

export interface ValidateEquivalenceInput {
  validationRunId: string;
  recommendationVersionId: string;
  researchEngineVersion: string;
  productionEngineVersion: string;
  parameterSnapshotHash: string;
  // The production recommendation output (from RecommendationService/
  // EntryOptimizerService etc.) as a plain record -- caller extracts
  // whichever fields are relevant.
  productionOutput: Record<string, unknown>;
  // The research notebook output for the same market/session/parameters,
  // provided as a plain record with field names translated per Sections
  // 1.2/1.3 (the caller handles the translation, not this service).
  // null if the notebook output is unavailable for this run -- produces
  // NOT_COMPARABLE rather than MATCH/DRIFT_DETECTED.
  researchOutput: Record<string, unknown> | null;
  atr14: number | null; // for ATR-multiple delta unit computation
  validatedAt: string;
}

export function validateEquivalence(input: ValidateEquivalenceInput): BehaviouralDifferenceReport {
  const {
    validationRunId, recommendationVersionId, researchEngineVersion,
    productionEngineVersion, parameterSnapshotHash,
    productionOutput, researchOutput, atr14, validatedAt,
  } = input;

  const recommendationHash = stableHash(productionOutput);

  if (researchOutput === null) {
    return {
      validationRunId, recommendationVersionId, researchEngineVersion, productionEngineVersion,
      parameterSnapshotHash, recommendationHash, researchRecommendationHash: null,
      overallStatus: 'NOT_COMPARABLE', differences: [], highestSeverity: null, validatedAt,
    };
  }

  const researchRecommendationHash = stableHash(researchOutput);
  const paramHashMatch = productionOutput['parameterSnapshotHash'] === researchOutput['parameterSnapshotHash'];

  // Quick path: identical hashes means identical outputs -- no need to diff.
  if (recommendationHash === researchRecommendationHash) {
    return {
      validationRunId, recommendationVersionId, researchEngineVersion, productionEngineVersion,
      parameterSnapshotHash, recommendationHash, researchRecommendationHash,
      overallStatus: 'MATCH', differences: [], highestSeverity: null, validatedAt,
    };
  }

  const differences: FieldDifference[] = [];

  // Compare numeric fields.
  for (const field of NUMERIC_FIELDS) {
    const pVal = productionOutput[field];
    const rVal = researchOutput[field];
    if (pVal === undefined || rVal === undefined) continue;
    if (typeof pVal !== 'number' || typeof rVal !== 'number') continue;
    if (Number.isNaN(pVal) && Number.isNaN(rVal)) continue; // both NaN -- match
    const relErr = relativeError(pVal, rVal);
    if (relErr <= NUMERIC_TOLERANCE) continue; // within tolerance -- match

    const severity = classifyNumericSeverity(relErr);
    const reason = autoClassifyReason(field, relErr, paramHashMatch);
    // Express delta as ATR multiple when atr14 is available and the field
    // is a price-level (not a ratio/probability), for human readability.
    const isPriceLevel = ['entryRangeLow', 'entryRangeHigh', 'entryMid', 'stop', 'target'].includes(field);
    const deltaUnit = isPriceLevel && atr14 && atr14 > 0 ? 'atr_multiple' : 'absolute';
    const delta = isPriceLevel && atr14 && atr14 > 0
      ? (pVal - rVal) / atr14
      : pVal - rVal;

    differences.push({ field, researchValue: rVal, productionValue: pVal, delta, deltaUnit, reason, severity });
  }

  // Compare categorical fields.
  for (const field of CATEGORICAL_FIELDS) {
    const pVal = productionOutput[field];
    const rVal = researchOutput[field];
    if (pVal === undefined || rVal === undefined) continue;
    if (pVal === rVal) continue; // exact match
    const severity = classifyCategoricalSeverity(field, rVal, pVal);
    differences.push({
      field, researchValue: rVal, productionValue: pVal,
      delta: `${String(rVal)} → ${String(pVal)}`, deltaUnit: 'categorical',
      reason: paramHashMatch ? 'UNCLASSIFIED' : 'PARAMETER_SNAPSHOT_MISMATCH',
      severity,
    });
  }

  const severityOrder: DriftSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const highestSeverity = differences.length === 0 ? null
    : differences.reduce<DriftSeverity>((max, d) =>
        severityOrder.indexOf(d.severity) > severityOrder.indexOf(max) ? d.severity : max,
      'LOW');

  return {
    validationRunId, recommendationVersionId, researchEngineVersion, productionEngineVersion,
    parameterSnapshotHash, recommendationHash, researchRecommendationHash,
    overallStatus: differences.length === 0 ? 'MATCH' : 'DRIFT_DETECTED',
    differences, highestSeverity, validatedAt,
  };
}
