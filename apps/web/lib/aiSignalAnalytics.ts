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
  // Computed server-side by the ai_trades_with_reiteration() SQL window function
  // (migrations/068_ai_trades_reiteration.sql) -- true when an earlier signal on the
  // same symbol was still open at this signal's publication time. Always present on
  // rows returned by /api/analytics/ai-signals and /api/analytics/combined.
  is_reiteration: boolean
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
  // Count of DEDUPLICATED signals only (is_reiteration = false) -- see
  // computeAiSignalSummary()'s own comment. The route layers its own top-level
  // totalSignals/uniqueSignals/reiterations fields over this for the raw, all-signals
  // count; this field keeps its pre-existing "dedup count" meaning so nothing that
  // already reads it (e.g. AiSignalsReportBuilder.tsx) silently starts counting
  // reiterations as real signals.
  totalSignals: number
  triggerRate: number | null
  winRate: number | null
  avgR: number | null
  cumulativeR: number
  payoutRatio: number | null
  breakEvenWinRate: number | null
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

// Trades with a definitive outcome. Unlike pattern_trades (lib/patternAnalytics.ts),
// AI signals that reach their expiry still get a recorded rr (~47% of closed AI trades
// are Expired, and they're mostly positive) -- excluding them understated both win rate
// and avg R. Win/loss itself is decided by the rr sign, not the status label: a status
// like "Expired" doesn't say win or loss on its own, only that the trade has a result.
const STATUSES_WITH_OUTCOME = ['Closed - Profit', 'Closed - Loss', 'Closed - Flat', 'Expired']

interface Aggregate {
  count: number
  triggerPct: number | null
  winPct: number | null
  avgR: number | null
  totalR: number
  maxDD: number
  profitFactor: number | null
  payoutRatio: number | null
  breakEvenWinRate: number | null
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

  // Null-coalescing to 0 in a reference implementation would also mean withOutcome
  // containing zero rows still reports "0%"/"0R" rather than "no data" -- kept as null
  // here instead, matching every other null-sentinel in this file/AttributionRow (the
  // UI already renders null as "—"), so an empty confidence/asset-class bucket isn't
  // misrepresented as a real zero result.
  const withOutcome = rows.filter(r => r.status !== null && STATUSES_WITH_OUTCOME.includes(r.status) && r.rr !== null)
  const wins = withOutcome.filter(r => (r.rr ?? 0) > 0)
  const losers = withOutcome.filter(r => (r.rr ?? 0) < 0)
  const winPct = withOutcome.length > 0 ? wins.length / withOutcome.length : null

  const rrValues = withOutcome
    .map(r => r.rr)
    .filter((rr): rr is number => rr !== null)
  const avgR = rrValues.length > 0 ? rrValues.reduce((s, rr) => s + rr, 0) / rrValues.length : null
  const totalR = round2(rrValues.reduce((s, rr) => s + rr, 0))

  const winRRs = wins.map(r => r.rr as number)
  const lossRRs = losers.map(r => r.rr as number)
  const gains = winRRs.reduce((s, rr) => s + rr, 0)
  const losses = lossRRs.reduce((s, rr) => s + rr, 0)
  const profitFactor = losses !== 0 ? round2(gains / Math.abs(losses)) : null

  let payoutRatio: number | null = null
  let breakEvenWinRate: number | null = null
  if (winRRs.length > 0 && lossRRs.length > 0) {
    const avgWin = gains / winRRs.length
    const avgLoss = Math.abs(losses / lossRRs.length)
    if (avgLoss > 0) {
      payoutRatio = round2(avgWin / avgLoss)
      breakEvenWinRate = round2(1 / (1 + payoutRatio))
    }
  }

  const maxDD = sequenceDrawdown(withOutcome)

  return { count, triggerPct, winPct, avgR, totalR, maxDD, profitFactor, payoutRatio, breakEvenWinRate }
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

// Reiterations (a continuing-opportunity signal published while an earlier signal on the
// same symbol was still open -- see migrations/068_ai_trades_reiteration.sql) are
// excluded from every statistic here: win rate, avg R, total R, drawdown, and all three
// breakdowns. They're recorded data, not noise, but counting several simultaneous
// signals on one name as independent bets overstates performance (see the deduplication
// analysis that motivated this: Total R drops from +5,387R to +1,755R once a symbol can
// only hold one open "position" worth of signal at a time). Callers that need the raw,
// non-deduplicated count (e.g. the "Total Signals" KPI tile's reiteration subtitle)
// should count the full row set themselves before calling this function.
export function computeAiSignalSummary(allRows: AiTradePoint[]): AiSignalSummary {
  const rows = allRows.filter(r => !r.is_reiteration)
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
    payoutRatio: overall.payoutRatio,
    breakEvenWinRate: overall.breakEvenWinRate,
    byConfidence,
    byAssetClass,
    byDirection,
  }
}