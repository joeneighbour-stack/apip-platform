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
  tier: 'zone' | 'market_direction' | 'market_only' | 'none'
  avgR: number | null
  winRate: number | null
  trades: number
  quality: string | null
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
  symbol: string
  marketId: string
  direction: 'BUY' | 'SELL' | null
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
  coachingNote: string | null
  shownAt: string
  session: string | null
  assetClass: string | null
  displayPrecision: number | null
  distanceLanguage: string | null
  sessionEndIso: string
  priorityScore: number
  currentPrice: number | null
  priceHistory: PriceBar[]
}
