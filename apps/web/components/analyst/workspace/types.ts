import type { ZoneBoundaries } from '@/lib/workspaceUtils'

export interface RegimeInfo {
  trendState: string | null
  volatilityState: string | null
  confidence: string | null
  adx14: number | null
  ema20: number | null
  ema50: number | null
  ema200: number | null
  directionalPersistence: number | null
  atrPercentile: number | null
  priorAtrPercentile: number | null
}

export interface EventRiskItem {
  eventName: string
  impact: string
  eventTimeUk: string
  riskScore: number | null
  analystWarning: string | null
  forecast: string | null
  previous: string | null
  actual: string | null
}

export interface PreviousDaySummary {
  date: string
  open: number
  high: number
  low: number
  close: number
  atr14: number | null
}

export interface YesterdayTradeOutcome {
  direction: string
  triggered: boolean
  resultR: number | null
}

export interface HistoricalEdge {
  tier: 'zone' | 'regime_direction' | 'market_direction' | 'market_only' | 'none'
  avgR: number | null
  winRate: number | null
  trades: number
  quality: string | null
  // Set only when tier === 'regime_direction' -- the regime this edge is scoped to
  // (e.g. "TRENDING_DOWN"), for the "comparable conditions" label.
  regimeLabel: string | null
}

export interface PriceBar {
  date: string
  open: number
  high: number
  low: number
  close: number
}

export interface WorkspaceRow {
  recommendationId: string
  opportunityId: string | null
  symbol: string
  marketId: string
  direction: 'BUY' | 'SELL' | null
  analystAction: 'ENTER_NOW' | 'WAIT_FOR_PREFERRED_ZONE' | null
  currentZone: string | null
  preferredZone: string | null
  entryLow: number | null
  entryHigh: number | null
  riskRange: string | null
  targetRange: string | null
  riskAtrDistance: number | null
  targetAtrDistance: number | null
  riskMid: number | null
  targetMid: number | null
  triggerProbability: number | null
  expectedR: number | null
  validityStatus: string
  volatilityWarning: string | null
  isDoNotUse: boolean
  isEntryPassed: boolean
  isStale: boolean
  regime: RegimeInfo | null
  hasHighImpactEventToday: boolean
  eventRiskItems: EventRiskItem[]
  eventRiskOverflowCount: number
  previousDay: PreviousDaySummary | null
  yesterdayTradeOutcome: YesterdayTradeOutcome | null
  historicalEdge: HistoricalEdge
  // Section 4 Block 4 ("Why You're Seeing This") -- derived from analyst_profiles
  // only, never fabricated. Null when there's no meaningful differentiation to
  // report (caller falls back to a neutral, still-honest statement in that case).
  personalisation: string | null
  coachingNote: string | null
  shownAt: string
  session: string | null
  assetClass: string | null
  displayPrecision: number | null
  distanceLanguage: string | null
  sessionEndIso: string
  priorityScore: number
  currentPrice: number | null
  currentPriceSource: 'live' | 'close' | null
  priceHistory: PriceBar[]
  zoneBoundaries: ZoneBoundaries | null
}
