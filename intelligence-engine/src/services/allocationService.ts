// ============================================================================
// AllocationService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 12 (allocate_coverage)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.9.md Section 3.12
// ============================================================================
// CORRECTION TO V1.1-V1.8 ARCHITECTURE DOCUMENT (Section 1.7):
// V1.1 described five separate scoring columns (market_fit_score,
// regime_fit_score, workload_score, availability_score, final_score).
// Confirmed against the live coverage_allocation schema: ONLY
// allocation_score exists. The notebook itself only ever computes ONE
// combined score -- the five-column description in V1.1 was an imagined
// future extension, not a current schema reality. Built here against the
// real single-column shape. Needs a V1.9 architecture amendment.
//
// ALGORITHM: stateful, sequential -- not an independent per-row calculation.
// Sort opportunities by expected_r descending, then for each:
//   score = expected_r + (0.2 if analyst === preferredAnalyst else 0) - workload * 0.1
// Workload is incremented for the winning analyst BEFORE scoring the next
// opportunity. This means the order of processing genuinely changes the
// outcome -- an analyst assigned to one opportunity has higher workload
// when the next one is scored. Do not parallelize or reorder this loop.
//
// ANALYST AVAILABILITY: opt-out model (confirmed against live schema and
// product clarification). No row in analyst_availability for a given
// analyst/date/session = available by default. Only an explicit
// available=false row excludes an analyst. This service receives the
// already-filtered eligible list from its caller -- it does not query
// analyst_availability directly (pure function, no I/O).

export interface OpportunityForAllocation {
  opportunityId: string;
  recommendationVersionId: string;
  expectedR: number;
  assignedAnalystId: string | null; // the PREFERENCE from AnalystProfileService -- gets a +0.2 bonus
  eligibleAnalysts: string[];       // already filtered by session + availability by the caller
}

export interface AllocationOutput {
  allocationId: string;           // caller-generated -- pure function
  opportunityId: string;
  recommendationVersionId: string;
  assignedAnalystId: string;
  eligibleAnalysts: string[];
  allocationScore: number;
  allocationStatus: 'ASSIGNED';   // literal -- this service always produces ASSIGNED, never anything else
  reasonSummary: string;          // literal fixed string from the notebook, not computed per-allocation
}

export interface AllocateCoverageInput {
  opportunities: OpportunityForAllocation[];
  activeAnalysts: string[];        // list of ALL active analysts, used as the fallback when eligibleAnalysts is empty
  generateId: () => string;        // caller-supplied ID generator -- keeps this a pure, testable function
}

// Fixed string from the notebook -- not computed, not parameterised.
// See Architecture Section 3.12.
const REASON_SUMMARY = 'Assigned using expected R, profile fit and workload balancing.';

export function allocateCoverage(input: AllocateCoverageInput): AllocationOutput[] {
  const { opportunities, activeAnalysts, generateId } = input;

  if (opportunities.length === 0) return [];

  // Workload tracker -- keyed by analyst, incremented after each assignment.
  // Starts at 0 for every active analyst, not just those who appear in
  // eligible lists -- matching the notebook's `{a:0 for a in active_analysts}`.
  const workload: Record<string, number> = {};
  for (const analyst of activeAnalysts) {
    workload[analyst] = 0;
  }

  // Sort by expected_r descending -- this ordering is part of the algorithm,
  // not a presentation choice. Do not change it without a research re-validation.
  const sorted = [...opportunities].sort((a, b) => b.expectedR - a.expectedR);

  const results: AllocationOutput[] = [];

  for (const opp of sorted) {
    // eligible falls back to ALL active analysts if the opportunity's own
    // eligible list is empty -- matching the notebook's:
    // `eligible = r.eligible_analysts if ... and r.eligible_analysts else list(workload.keys())`
    const eligible = opp.eligibleAnalysts.length > 0
      ? opp.eligibleAnalysts
      : activeAnalysts;

    if (eligible.length === 0) {
      // No analysts available at all -- skip this opportunity rather than
      // crash or assign null. This shouldn't happen in production (there
      // must always be at least one active analyst) but must be handled
      // explicitly rather than letting the sort below blow up on an empty
      // array.
      continue;
    }

    const scores: { analyst: string; score: number }[] = eligible.map((analyst) => ({
      analyst,
      score:
        opp.expectedR +
        (analyst === opp.assignedAnalystId ? 0.2 : 0) -
        (workload[analyst] ?? 0) * 0.1,
    }));

    // Sort descending by score, take the first -- matching the notebook's
    // `sorted(scores, key=lambda x:x[1], reverse=True)[0][0]`
    scores.sort((a, b) => b.score - a.score);
    const winner = scores[0]!;

    // Increment workload BEFORE processing the next opportunity -- this is
    // what makes the algorithm stateful and sequential.
    workload[winner.analyst] = (workload[winner.analyst] ?? 0) + 1;

    results.push({
      allocationId: generateId(),
      opportunityId: opp.opportunityId,
      recommendationVersionId: opp.recommendationVersionId,
      assignedAnalystId: winner.analyst,
      eligibleAnalysts: eligible,
      allocationScore: winner.score,
      allocationStatus: 'ASSIGNED',
      reasonSummary: REASON_SUMMARY,
    });
  }

  return results;
}
