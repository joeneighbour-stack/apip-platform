import { describe, it, expect } from 'vitest';
import { buildTemplateProfiles, selectBestTemplate, type HistoricalTradeForProfiling } from '../services/templateService.js';

function trade(overrides: Partial<HistoricalTradeForProfiling> = {}): HistoricalTradeForProfiling {
  return { market: 'EURUSD', direction: 'BUY', entryZone: 'ZONE_2', resultR: 1.5, triggered: true, ...overrides };
}

describe('buildTemplateProfiles', () => {
  it('groups by (market, direction, entryZone) and computes trades/avgR/winRate/triggerRate', () => {
    const trades = [
      trade({ resultR: 2 }), trade({ resultR: -1 }), trade({ resultR: 1 }),
    ];
    const profiles = buildTemplateProfiles(trades);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.trades).toBe(3);
    expect(profiles[0]!.avgR).toBeCloseTo((2 - 1 + 1) / 3, 10);
    expect(profiles[0]!.winRate).toBeCloseTo(2 / 3, 10); // 2 of 3 have resultR > 0
  });

  it('pools null-entryZone trades into their own group rather than excluding them (V1.1 Section 12 item 1, now resolved)', () => {
    const trades = [trade({ entryZone: null }), trade({ entryZone: null }), trade({ entryZone: 'ZONE_2' })];
    const profiles = buildTemplateProfiles(trades);
    expect(profiles).toHaveLength(2);
    const nullGroup = profiles.find((p) => p.entryZone === null);
    expect(nullGroup).toBeDefined();
    expect(nullGroup!.trades).toBe(2);
  });

  it('produces avgR = NaN when every trade in a group has resultR === null (pandas skipna mean of nothing)', () => {
    const trades = [trade({ resultR: null }), trade({ resultR: null })];
    const profiles = buildTemplateProfiles(trades);
    expect(Number.isNaN(profiles[0]!.avgR)).toBe(true);
    // winRate must still be a real number (0), not NaN -- comparisons with
    // NaN yield false, not NaN, in both pandas and JS.
    expect(profiles[0]!.winRate).toBe(0);
  });

  it('requires BOTH trade count AND avgR > 0 for HIGH/MEDIUM quality -- high trade count alone is not sufficient', () => {
    // 60 trades (above HIGH threshold of 50) but avgR negative -- must be LOW, not HIGH.
    const trades = Array.from({ length: 60 }, () => trade({ resultR: -0.5 }));
    const profiles = buildTemplateProfiles(trades);
    expect(profiles[0]!.trades).toBe(60);
    expect(profiles[0]!.templateQuality).toBe('LOW');
  });

  it('classifies HIGH quality only with >=50 trades AND avgR > 0', () => {
    const trades = Array.from({ length: 50 }, () => trade({ resultR: 0.5 }));
    expect(buildTemplateProfiles(trades)[0]!.templateQuality).toBe('HIGH');
  });

  it('classifies MEDIUM quality with >=20 (but <50) trades AND avgR > 0', () => {
    const trades = Array.from({ length: 20 }, () => trade({ resultR: 0.5 }));
    expect(buildTemplateProfiles(trades)[0]!.templateQuality).toBe('MEDIUM');
  });
});

describe('selectBestTemplate', () => {
  it('returns the exact fallback shape when no group meets min_template_trades (10)', () => {
    const trades = Array.from({ length: 9 }, () => trade()); // one below the threshold of 10
    const profiles = buildTemplateProfiles(trades);
    const result = selectBestTemplate('EURUSD', profiles);
    expect(result).toEqual({
      templateSource: 'fallback', direction: 'BUY', preferredEntryZone: 'ZONE_1',
      templateAvgR: 0, templateWinRate: null, templateTrades: 0, templateQuality: 'LOW',
    });
  });

  it('selects the group with the highest avgR among groups meeting the 10-trade floor', () => {
    const trades = [
      ...Array.from({ length: 10 }, () => trade({ direction: 'BUY', entryZone: 'ZONE_1', resultR: 0.5 })),
      ...Array.from({ length: 10 }, () => trade({ direction: 'SELL', entryZone: 'ZONE_3', resultR: 2.0 })),
    ];
    const profiles = buildTemplateProfiles(trades);
    const result = selectBestTemplate('EURUSD', profiles);
    expect(result.templateSource).toBe('historical_template');
    expect(result.direction).toBe('SELL');
    expect(result.preferredEntryZone).toBe('ZONE_3');
    expect(result.templateAvgR).toBeCloseTo(2.0, 10);
  });

  it('defaults preferredEntryZone to ZONE_1 when the winning group has a null entryZone (does not propagate null)', () => {
    const trades = Array.from({ length: 10 }, () => trade({ entryZone: null, resultR: 5 })); // huge avgR, no real zone
    const profiles = buildTemplateProfiles(trades);
    const result = selectBestTemplate('EURUSD', profiles);
    expect(result.templateSource).toBe('historical_template');
    expect(result.preferredEntryZone).toBe('ZONE_1'); // not null
  });

  it('places NaN-avgR groups last in the sort, never lets them win over a real group with a meeting-threshold trade count', () => {
    const trades = [
      ...Array.from({ length: 10 }, () => trade({ direction: 'BUY', entryZone: 'ZONE_1', resultR: null })), // avgR = NaN
      ...Array.from({ length: 10 }, () => trade({ direction: 'SELL', entryZone: 'ZONE_2', resultR: 0.1 })), // avgR = 0.1, real and positive
    ];
    const profiles = buildTemplateProfiles(trades);
    const result = selectBestTemplate('EURUSD', profiles);
    // The real, positive-avgR group must win, not the NaN one, even though
    // NaN comparisons could otherwise produce undefined sort behaviour.
    expect(result.direction).toBe('SELL');
  });

  it('only considers groups for the requested market', () => {
    const trades = [
      ...Array.from({ length: 10 }, () => trade({ market: 'EURUSD', resultR: 0.5 })),
      ...Array.from({ length: 10 }, () => trade({ market: 'GBPUSD', resultR: 5.0 })), // much better, but wrong market
    ];
    const profiles = buildTemplateProfiles(trades);
    const result = selectBestTemplate('EURUSD', profiles);
    expect(result.templateAvgR).toBeCloseTo(0.5, 10);
  });
});
