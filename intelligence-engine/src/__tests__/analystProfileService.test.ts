import { describe, it, expect } from 'vitest';
import {
  buildAnalystProfiles, selectBestAnalyst,
  type AnalystHistoricalTrade, type ActiveAnalyst,
} from '../services/analystProfileService.js';

function trade(overrides: Partial<AnalystHistoricalTrade> = {}): AnalystHistoricalTrade {
  return { analyst: 'TIV', market: 'EURUSD', direction: 'BUY', entryZone: 'ZONE_2', resultR: 1.5, ...overrides };
}

const analysts: ActiveAnalyst[] = [
  { analyst: 'TIV', active: true, sessionEligibility: { EUROPEAN: true, US: true, APAC: true } },
  { analyst: 'IAN', active: true, sessionEligibility: { EUROPEAN: true, US: true, APAC: false } },
  { analyst: 'MOH', active: true, sessionEligibility: { EUROPEAN: true, US: true, APAC: true } },
  { analyst: 'INACTIVE_GUY', active: false, sessionEligibility: { EUROPEAN: true, US: true, APAC: true } },
];

describe('buildAnalystProfiles', () => {
  it('groups by (analyst, market, direction, entryZone) -- has no triggerRate field at all', () => {
    const profiles = buildAnalystProfiles([trade(), trade()]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).not.toHaveProperty('triggerRate');
    expect(profiles[0]!.trades).toBe(2);
  });

  it('requires both trade count and avgR > 0 for quality, same as TemplateService', () => {
    const trades = Array.from({ length: 60 }, () => trade({ resultR: -1 }));
    expect(buildAnalystProfiles(trades)[0]!.profileQuality).toBe('LOW');
  });
});

describe('selectBestAnalyst', () => {
  it('filters eligibility by active AND session, excluding inactive analysts and session-ineligible ones', () => {
    const result = selectBestAnalyst('EURUSD', 'BUY', 'ZONE_2', [], analysts, 'APAC');
    expect(result.eligibleAnalysts.sort()).toEqual(['MOH', 'TIV']); // IAN not APAC-eligible, INACTIVE_GUY not active
  });

  it('tier 1 (exact_profile): prefers an exact market+direction+zone match over a market-only match', () => {
    const profiles = buildAnalystProfiles([
      trade({ analyst: 'TIV', direction: 'BUY', entryZone: 'ZONE_2', resultR: 1.0 }),  // exact match for the query below
      trade({ analyst: 'IAN', direction: 'SELL', entryZone: 'ZONE_3', resultR: 5.0 }), // better avgR but wrong direction/zone
    ]);
    const result = selectBestAnalyst('EURUSD', 'BUY', 'ZONE_2', profiles, analysts, 'EUROPEAN');
    expect(result.profileSource).toBe('exact_profile');
    expect(result.assignedAnalyst).toBe('TIV');
  });

  it('tier 2 (market_profile): falls back to a market-only match when no exact direction+zone match exists', () => {
    const profiles = buildAnalystProfiles([
      trade({ analyst: 'IAN', direction: 'SELL', entryZone: 'ZONE_4', resultR: 2.0 }), // same market, different direction/zone
    ]);
    const result = selectBestAnalyst('EURUSD', 'BUY', 'ZONE_2', profiles, analysts, 'EUROPEAN');
    expect(result.profileSource).toBe('market_profile');
    expect(result.assignedAnalyst).toBe('IAN');
  });

  it('tier 3 (fallback): picks the literal FIRST eligible analyst with no scoring at all when no profile data exists', () => {
    const result = selectBestAnalyst('EURUSD', 'BUY', 'ZONE_2', [], analysts, 'EUROPEAN');
    expect(result.profileSource).toBe('fallback');
    // Eligible order for EUROPEAN is TIV, IAN, MOH (in the order given in
    // the analysts array, filtered) -- first one wins, not the "best" one.
    expect(result.assignedAnalyst).toBe('TIV');
    expect(result.profileQuality).toBe('LOW');
    expect(result.profileTrades).toBe(0);
  });

  it('returns assignedAnalyst null when no analyst is eligible for the session at all', () => {
    const noOneEligible: ActiveAnalyst[] = [{ analyst: 'X', active: true, sessionEligibility: { EUROPEAN: false } }];
    const result = selectBestAnalyst('EURUSD', 'BUY', 'ZONE_2', [], noOneEligible, 'EUROPEAN');
    expect(result.assignedAnalyst).toBeNull();
    expect(result.eligibleAnalysts).toEqual([]);
  });

  it('excludes a profile from the exact tier if the analyst is not eligible for this session, even with a perfect match', () => {
    const profiles = buildAnalystProfiles([
      trade({ analyst: 'IAN', direction: 'BUY', entryZone: 'ZONE_2', resultR: 10 }), // perfect exact match, but...
    ]);
    // IAN is not APAC-eligible -- must not be selected even via fallback.
    const result = selectBestAnalyst('EURUSD', 'BUY', 'ZONE_2', profiles, analysts, 'APAC');
    expect(result.assignedAnalyst).not.toBe('IAN');
  });
});
