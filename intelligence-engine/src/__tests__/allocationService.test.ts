import { describe, it, expect } from 'vitest';
import { allocateCoverage, type OpportunityForAllocation } from '../services/allocationService.js';

let idCounter = 0;
const generateId = () => `alloc-${++idCounter}`;

function opp(overrides: Partial<OpportunityForAllocation> = {}): OpportunityForAllocation {
  return {
    opportunityId: 'opp-1', recommendationVersionId: 'rv-1',
    expectedR: 1.0, assignedAnalystId: 'TIV', eligibleAnalysts: ['TIV', 'IAN', 'MOH'],
    ...overrides,
  };
}

const analysts = ['TIV', 'IAN', 'MOH'];

describe('allocateCoverage', () => {
  it('returns empty array when no opportunities are provided', () => {
    expect(allocateCoverage({ opportunities: [], activeAnalysts: analysts, generateId })).toEqual([]);
  });

  it('applies the exact notebook scoring formula: expectedR + (0.2 if preferred) - workload * 0.1', () => {
    const result = allocateCoverage({
      opportunities: [opp({ opportunityId: 'opp-1', assignedAnalystId: 'TIV', expectedR: 1.0 })],
      activeAnalysts: analysts, generateId,
    });
    // TIV gets +0.2 preference bonus, all workloads start at 0:
    // TIV: 1.0 + 0.2 - 0 = 1.2, IAN: 1.0 + 0 - 0 = 1.0, MOH: 1.0 + 0 - 0 = 1.0
    expect(result[0]!.assignedAnalystId).toBe('TIV');
    expect(result[0]!.allocationScore).toBeCloseTo(1.2, 10);
  });

  it('picks the highest-expectedR opportunity first -- sort order is part of the algorithm', () => {
    const result = allocateCoverage({
      opportunities: [
        opp({ opportunityId: 'opp-low', expectedR: 0.5, eligibleAnalysts: ['TIV'] }),
        opp({ opportunityId: 'opp-high', expectedR: 2.0, eligibleAnalysts: ['TIV'] }),
      ],
      activeAnalysts: analysts, generateId,
    });
    // Both go to TIV (only eligible analyst), but opp-high must be processed first.
    expect(result[0]!.opportunityId).toBe('opp-high');
    expect(result[1]!.opportunityId).toBe('opp-low');
  });

  it('THE STATEFUL SEQUENTIAL INVARIANT: workload increments BEFORE the next opportunity is scored, changing who wins', () => {
    // Two opportunities, both with TIV as preferred (+0.2 bonus).
    // After the first assignment to TIV, workload['TIV'] = 1.
    // On the second opportunity:
    //   TIV: 1.0 + 0.2 - 1*0.1 = 1.1
    //   IAN: 1.0 + 0.0 - 0*0.1 = 1.0
    //   TIV still wins, but the score reflects the accumulated workload.
    // Now with THREE opportunities, TIV's workload becomes a real factor:
    //   After two assignments: TIV workload = 2
    //   Third: TIV: 1.0 + 0.2 - 2*0.1 = 1.0, IAN: 1.0 + 0 - 0 = 1.0 -- tie, TIV wins by sort stability
    //   After three: TIV workload = 3
    //   Fourth: TIV: 1.0 + 0.2 - 3*0.1 = 0.9, IAN: 1.0 + 0 - 0 = 1.0 -- IAN wins
    const opps = [
      opp({ opportunityId: 'opp-1', expectedR: 1.5, assignedAnalystId: 'TIV' }),
      opp({ opportunityId: 'opp-2', expectedR: 1.4, assignedAnalystId: 'TIV' }),
      opp({ opportunityId: 'opp-3', expectedR: 1.3, assignedAnalystId: 'TIV' }),
      opp({ opportunityId: 'opp-4', expectedR: 1.2, assignedAnalystId: 'TIV' }),
    ];
    const result = allocateCoverage({ opportunities: opps, activeAnalysts: analysts, generateId });
    expect(result[0]!.assignedAnalystId).toBe('TIV'); // workload 0 -> 1
    expect(result[1]!.assignedAnalystId).toBe('TIV'); // workload 1 -> 2
    expect(result[2]!.assignedAnalystId).toBe('TIV'); // workload 2 -> 3 (tie, TIV wins)
    expect(result[3]!.assignedAnalystId).toBe('IAN'); // TIV score 0.9 < IAN score 1.0 -- workload finally tips it
  });

  it('falls back to ALL active analysts when eligibleAnalysts is empty', () => {
    const result = allocateCoverage({
      opportunities: [opp({ eligibleAnalysts: [], assignedAnalystId: null })],
      activeAnalysts: ['TIV', 'IAN'], generateId,
    });
    expect(['TIV', 'IAN']).toContain(result[0]!.assignedAnalystId);
  });

  it('uses the exact fixed reason_summary string from the notebook, not a computed one', () => {
    const result = allocateCoverage({
      opportunities: [opp()], activeAnalysts: analysts, generateId,
    });
    expect(result[0]!.reasonSummary).toBe('Assigned using expected R, profile fit and workload balancing.');
  });

  it('always sets allocationStatus to ASSIGNED -- literal, not a dynamic value', () => {
    const result = allocateCoverage({
      opportunities: [opp()], activeAnalysts: analysts, generateId,
    });
    expect(result[0]!.allocationStatus).toBe('ASSIGNED');
  });

  it('skips rather than crashes when no analysts are eligible and no active analysts exist', () => {
    const result = allocateCoverage({
      opportunities: [opp({ eligibleAnalysts: [] })],
      activeAnalysts: [], generateId,
    });
    expect(result).toHaveLength(0);
  });

  it('produces one allocation row per opportunity, linked correctly via FK fields', () => {
    const result = allocateCoverage({
      opportunities: [
        opp({ opportunityId: 'opp-A', recommendationVersionId: 'rv-A', expectedR: 2.0 }),
        opp({ opportunityId: 'opp-B', recommendationVersionId: 'rv-B', expectedR: 1.0 }),
      ],
      activeAnalysts: analysts, generateId,
    });
    expect(result).toHaveLength(2);
    expect(result.find(r => r.opportunityId === 'opp-A')!.recommendationVersionId).toBe('rv-A');
    expect(result.find(r => r.opportunityId === 'opp-B')!.recommendationVersionId).toBe('rv-B');
  });
});
