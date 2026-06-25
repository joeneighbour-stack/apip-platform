import { describe, it, expect } from 'vitest';
import { deriveMarketRegime, type CloseBar } from '../services/marketRegimeService.js';
import { mapEventRisk } from '../services/economicCalendarService.js';

describe('MarketRegimeService', () => {
  it('classifies UNKNOWN volatility and LOW confidence with too few bars', () => {
    const bars: CloseBar[] = Array.from({ length: 5 }, (_, i) => ({ date: `2026-01-0${i + 1}`, close: 1.10 + i * 0.0001 }));
    const result = deriveMarketRegime({ marketId: 'TEST', closeSeries: bars });
    expect(result.volatilityState).toBe('UNKNOWN');
    expect(result.regimeConfidence).toBe('LOW'); // never 'HIGH', per the invariant
  });

  it('never produces HIGH confidence even with abundant clean data', () => {
    // 100 bars of low, steady noise -- plenty of data, should still cap at MEDIUM.
    const bars: CloseBar[] = [];
    let price = 1.10;
    for (let i = 0; i < 100; i++) {
      price += (i % 2 === 0 ? 0.0001 : -0.0001);
      bars.push({ date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, close: price });
    }
    const result = deriveMarketRegime({ marketId: 'TEST', closeSeries: bars });
    expect(result.regimeConfidence).not.toBe('HIGH');
    expect(['LOW', 'MEDIUM']).toContain(result.regimeConfidence);
  });

  it('produces lowercase regimeTags matching trendState/volatilityState', () => {
    const bars: CloseBar[] = Array.from({ length: 70 }, (_, i) => ({ date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, close: 1.10 + i * 0.001 }));
    const result = deriveMarketRegime({ marketId: 'TEST', closeSeries: bars });
    expect(result.regimeTags).toEqual([result.trendState.toLowerCase(), result.volatilityState.toLowerCase()]);
  });

  it('classifies a steadily rising series as TRENDING_UP', () => {
    const bars: CloseBar[] = Array.from({ length: 70 }, (_, i) => ({ date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, close: 1.00 + i * 0.005 }));
    const result = deriveMarketRegime({ marketId: 'TEST', closeSeries: bars });
    expect(result.trendState).toBe('TRENDING_UP');
  });
});

describe('EconomicCalendarService', () => {
  const baseEvent = { eventName: 'US CPI', currency: 'USD', impact: 'HIGH' as const };
  const map = { USD: ['EURUSD', 'SP500'] };

  function hoursFromNow(now: string, hrs: number): string {
    return new Date(new Date(now).getTime() + hrs * 60 * 60 * 1000).toISOString();
  }

  it('classifies a future HIGH-impact event within 3h as HIGH_RISK', () => {
    const now = '2026-06-01T00:00:00Z';
    const results = mapEventRisk({
      now, currencyMarketMap: map,
      events: [{ ...baseEvent, eventTimeUk: hoursFromNow(now, 2) }],
    });
    expect(results[0]!.eventRiskStatus).toBe('HIGH_RISK');
    expect(results[0]!.riskScore).toBe(0.9);
  });

  it('classifies a just-passed HIGH-impact event as EVENT_ACTIVE', () => {
    const now = '2026-06-01T00:00:00Z';
    const results = mapEventRisk({
      now, currencyMarketMap: map,
      events: [{ ...baseEvent, eventTimeUk: hoursFromNow(now, -0.5) }],
    });
    expect(results[0]!.eventRiskStatus).toBe('EVENT_ACTIVE');
    expect(results[0]!.riskScore).toBe(0.9);
  });

  it('classifies a HIGH-impact event 5h out (outside the 3h active window, inside the 8h watch window) as WATCH at 0.7', () => {
    const now = '2026-06-01T00:00:00Z';
    const results = mapEventRisk({
      now, currencyMarketMap: map,
      events: [{ ...baseEvent, eventTimeUk: hoursFromNow(now, 5) }],
    });
    expect(results[0]!.eventRiskStatus).toBe('WATCH');
    expect(results[0]!.riskScore).toBe(0.7);
  });

  it('classifies a MEDIUM-impact event 5h out as WATCH at 0.5', () => {
    const now = '2026-06-01T00:00:00Z';
    const results = mapEventRisk({
      now, currencyMarketMap: map,
      events: [{ ...baseEvent, impact: 'MEDIUM', eventTimeUk: hoursFromNow(now, 5) }],
    });
    expect(results[0]!.eventRiskStatus).toBe('WATCH');
    expect(results[0]!.riskScore).toBe(0.5);
  });

  it('classifies an event more than 8h out as NONE', () => {
    const now = '2026-06-01T00:00:00Z';
    const results = mapEventRisk({
      now, currencyMarketMap: map,
      events: [{ ...baseEvent, eventTimeUk: hoursFromNow(now, 9) }],
    });
    expect(results[0]!.eventRiskStatus).toBe('NONE');
    expect(results[0]!.riskScore).toBe(0);
    expect(results[0]!.analystWarning).toBe('');
  });

  it('classifies a MEDIUM-impact event that already passed as NONE (no active state for MEDIUM)', () => {
    const now = '2026-06-01T00:00:00Z';
    const results = mapEventRisk({
      now, currencyMarketMap: map,
      events: [{ ...baseEvent, impact: 'MEDIUM', eventTimeUk: hoursFromNow(now, -0.5) }],
    });
    expect(results[0]!.eventRiskStatus).toBe('NONE');
  });

  it('produces one result row per affected market, not one per event', () => {
    const now = '2026-06-01T00:00:00Z';
    const results = mapEventRisk({
      now, currencyMarketMap: map, // USD maps to 2 markets
      events: [{ ...baseEvent, eventTimeUk: hoursFromNow(now, 2) }],
    });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.marketId).sort()).toEqual(['EURUSD', 'SP500']);
  });

  it('returns an empty array for a currency with no mapped markets', () => {
    const now = '2026-06-01T00:00:00Z';
    const results = mapEventRisk({
      now, currencyMarketMap: map,
      events: [{ ...baseEvent, currency: 'JPY', eventTimeUk: hoursFromNow(now, 2) }],
    });
    expect(results).toHaveLength(0);
  });
});
