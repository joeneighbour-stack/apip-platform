// Shared types + aggregation for the management analytics page's AI Signals tab.
// ai_trades (migrations/066_ai_trades.sql) holds ReportType='AI' webhook records --
// same family as pattern_trades (lib/patternAnalytics.ts) but keyed on a confidence
// score instead of family/granularity, since AI signals have no pattern family or
// chart timeframe concept.

export interface AiTradeRow {
  confidence: number | null
  asset_class: string | null
  direction: string | null
  status: string | null
  triggered: boolean | null
  rr: number | null
}

// Lightweight trade-level record returned alongside the aggregated AiSignalSummary so
// the AI Signals tab can compute charts/rolling/monthly views client-side via
// lib/metrics.ts, the same way PatternsTab does for pattern_trades. Nullable fields
// mirror AiTradeRow/the real DB columns.
export interface AiTradePoint extends AiTradeRow {
  published_at: string
  symbol: string | null
  asset_name: string | null
}

export interface AiBreakdownRow {
  key: string
  label: string
  count: number
  triggerPct: number | null
  winPct: number | null
  avgR: number | null
  // Same reasoning as PatternBreakdownRow (lib/patternAnalytics.ts): derived from the
  // exact same closed-trade rr values as avgR/winPct above, so the AI Signals tab can
  // render these breakdowns through AttributionTable without fabricating figures.
  totalR: number
  maxDD: number
  profitFactor: number | null
}

export interface AiSignalSummary {
  totalSignals: number
  triggerRate: number | null
  winRate: number | null
  avgR: number | null
  cumulativeR: number
  byConfidence: AiBreakdownRow[]
  byAssetClass: AiBreakdownRow[]
  byDirection: AiBreakdownRow[]
}

// Fixed, always-shown row sets -- a complete breakdown of the feed's own fixed
// categories, present or not (same convention as GRANULARITY_ORDER/ASSET_CLASS_ORDER
// in lib/patternAnalytics.ts).
export const CONFIDENCE_LEVELS = [0, 25, 75, 100]
export const ASSET_CLASS_ORDER = ['FX', 'Equity', 'Commodity', 'Crypto', 'Index']
export const DIRECTION_ORDER = ['BUY', 'SELL']

const STATUS_CLOSED_PROFIT = 'Closed - Profit'
const STATUS_CLOSED_LOSS = 'Closed - Loss'

interface Aggregate {
  count: number
  triggerPct: number | null
  winPct: number | null
  avgR: number | null
  totalR: number
  maxDD: number
  profitFactor: number | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Peak-to-trough on the closed-trade rr sequence in chronological order -- same
// approach as lib/metrics.ts's maxDrawdown() / lib/patternAnalytics.ts's
// sequenceDrawdown(), reimplemented here because these rows are keyed by rr/status,
// not result_r/triggered.
function sequenceDrawdown(closedRows: AiTradePoint[]): number {
  const sorted = closedRows
    .filter(r => r.rr !== null)
    .slice()
    .sort((a, b) => a.published_at.localeCompare(b.published_at))
  let equity = 0, peak = 0, maxDD = 0
  for (const r of sorted) {
    equity += r.rr ?? 0
    if (equity > peak) peak = equity
    else if (equity - peak < maxDD) maxDD = equity - peak
  }
  return round2(maxDD)
}

function aggregate(rows: AiTradePoint[]): Aggregate {
  const count = rows.length
  const triggeredCount = rows.filter(r => r.triggered === true).length
  const triggerPct = count > 0 ? triggeredCount / count : null

  const closedProfit = rows.filter(r => r.status === STATUS_CLOSED_PROFIT)
  const closedLoss = rows.filter(r => r.status === STATUS_CLOSED_LOSS)
  const closedRows = [...closedProfit, ...closedLoss]
  const closedTotal = closedProfit.length + closedLoss.length
  const winPct = closedTotal > 0 ? closedProfit.length / closedTotal : null

  const rrValues = closedRows
    .map(r => r.rr)
    .filter((rr): rr is number => rr !== null)
  const avgR = rrValues.length > 0 ? rrValues.reduce((s, rr) => s + rr, 0) / rrValues.length : null
  const totalR = round2(rrValues.reduce((s, rr) => s + rr, 0))

  const gains = rrValues.filter(rr => rr > 0).reduce((s, rr) => s + rr, 0)
  const losses = rrValues.filter(rr => rr < 0).reduce((s, rr) => s + rr, 0)
  const profitFactor = losses !== 0 ? round2(gains / Math.abs(losses)) : null

  const maxDD = sequenceDrawdown(closedRows)

  return { count, triggerPct, winPct, avgR, totalR, maxDD, profitFactor }
}

function groupByConfidence(rows: AiTradePoint[]): Map<number, AiTradePoint[]> {
  const map = new Map<number, AiTradePoint[]>()
  for (const row of rows) {
    if (row.confidence === null) continue
    if (!map.has(row.confidence)) map.set(row.confidence, [])
    map.get(row.confidence)!.push(row)
  }
  return map
}

function groupBy(rows: AiTradePoint[], field: 'asset_class' | 'direction'): Map<string, AiTradePoint[]> {
  const map = new Map<string, AiTradePoint[]>()
  for (const row of rows) {
    const key = row[field]
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(row)
  }
  return map
}

function toBreakdownRow(key: string, label: string, rows: AiTradePoint[]): AiBreakdownRow {
  const agg = aggregate(rows)
  return {
    key, label, count: agg.count, triggerPct: agg.triggerPct, winPct: agg.winPct, avgR: agg.avgR,
    totalR: agg.totalR, maxDD: agg.maxDD, profitFactor: agg.profitFactor,
  }
}

export function computeAiSignalSummary(rows: AiTradePoint[]): AiSignalSummary {
  const overall = aggregate(rows)

  const byConfidenceMap = groupByConfidence(rows)
  const byConfidence = CONFIDENCE_LEVELS.map(level => toBreakdownRow(String(level), String(level), byConfidenceMap.get(level) ?? []))

  const byAssetClassMap = groupBy(rows, 'asset_class')
  const byAssetClass = ASSET_CLASS_ORDER.map(key => toBreakdownRow(key, key, byAssetClassMap.get(key) ?? []))

  const byDirectionMap = groupBy(rows, 'direction')
  const byDirection = DIRECTION_ORDER.map(key => toBreakdownRow(key, key, byDirectionMap.get(key) ?? []))

  return {
    totalSignals: overall.count,
    triggerRate: overall.triggerPct,
    winRate: overall.winPct,
    avgR: overall.avgR,
    cumulativeR: overall.totalR,
    byConfidence,
    byAssetClass,
    byDirection,
  }
}
