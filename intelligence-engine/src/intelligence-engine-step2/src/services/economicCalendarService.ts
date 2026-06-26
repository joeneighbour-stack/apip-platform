// ============================================================================
// EconomicCalendarService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 7 (map_event_risk)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md Section 3.3
// ============================================================================
// Pure function. No I/O.
//
// INVARIANT: the exact time-window thresholds below are research IP, not
// arbitrary defaults. Do not round, "simplify", or make these configurable
// away from these exact values without a research re-validation.
//
// CURRENCY_MARKET_MAP is passed in, not hardcoded -- the notebook's 4-entry
// table is sample-data scaffolding (Architecture V1.1 Section 3.3); production
// must supply a real mapping (open item, Architecture V1.1 Section 12.5).

export type EventImpact = 'HIGH' | 'MEDIUM' | 'LOW';
export type EventRiskStatus = 'NONE' | 'WATCH' | 'HIGH_RISK' | 'EVENT_ACTIVE';

export interface EconomicEvent {
  eventTimeUk: string; // ISO datetime
  currency: string;
  eventName: string;
  impact: EventImpact;
}

export interface EconomicCalendarInput {
  events: EconomicEvent[];
  currencyMarketMap: Record<string, string[]>;
  now: string; // ISO datetime
}

export interface MarketEventRiskOutput {
  marketId: string;
  eventName: string;
  currency: string;
  impact: EventImpact;
  eventTimeUk: string;
  eventRiskStatus: EventRiskStatus;
  riskScore: number;
  analystWarning: string;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function mapEventRisk(input: EconomicCalendarInput): MarketEventRiskOutput[] {
  const { events, currencyMarketMap, now } = input;
  const nowMs = new Date(now).getTime();
  const results: MarketEventRiskOutput[] = [];

  for (const event of events) {
    const currency = event.currency.toUpperCase();
    const impact = event.impact.toUpperCase() as EventImpact;
    const affectedMarkets = currencyMarketMap[currency] ?? [];

    const eventTimeMs = new Date(event.eventTimeUk).getTime();
    const hrs = Number.isFinite(eventTimeMs) ? (eventTimeMs - nowMs) / (1000 * 60 * 60) : NaN;

    for (const marketId of affectedMarkets) {
      let status: EventRiskStatus;
      let score: number;

      // Exact precedence and thresholds from the notebook -- do not reorder.
      if (impact === 'HIGH' && hrs >= -1 && hrs <= 3) {
        status = hrs <= 0 ? 'EVENT_ACTIVE' : 'HIGH_RISK';
        score = 0.9;
      } else if ((impact === 'HIGH' || impact === 'MEDIUM') && hrs > 0 && hrs <= 8) {
        status = 'WATCH';
        score = impact === 'MEDIUM' ? 0.5 : 0.7;
      } else {
        status = 'NONE';
        score = 0;
      }

      const analystWarning = status !== 'NONE'
        ? `${titleCase(impact)} impact ${currency} event: ${event.eventName} at ${event.eventTimeUk}`
        : '';

      results.push({
        marketId,
        eventName: event.eventName,
        currency,
        impact,
        eventTimeUk: event.eventTimeUk,
        eventRiskStatus: status,
        riskScore: score,
        analystWarning,
      });
    }
  }

  return results;
}
