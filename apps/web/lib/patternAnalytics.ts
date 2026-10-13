// Shared types + aggregation for the management analytics page's Patterns tab.
// pattern_trades (migrations/065_pattern_trades.sql) holds ReportType='Pattern'
// webhook records, separate from actual_trades (ReportType='Analyst').

export interface PatternTradeRow {
  family: string | null
  granularity: string | null
  asset_class: string | null
  direction: string | null
  status: string | null
  triggered: boolean | null
  rr: number | null
}

// Lightweight trade-level record returned alongside the aggregated PatternSummary so
// the Patterns tab can compute charts/rolling/monthly views client-side via
// lib/metrics.ts, the same way the Performance tab does for actual_trades. Nullable
// fields mirror PatternTradeRow/the real DB columns (not guaranteed non-null the way a
// stricter adapter type might assume).
export interface PatternTradePoint extends PatternTradeRow {
  published_at: string
  symbol: string | null
}

export interface PatternBreakdownRow {
  key: string
  label: string
  count: number
  triggerPct: number | null
  winPct: number | null
  avgR: number | null
  // Added so the Patterns tab can render these breakdowns through AttributionTable
  // (lib/metrics.ts's AttributionRow shape) without fabricating figures -- totalR/maxDD/
  // profitFactor are derived from the exact same closed-trade rr values as avgR/winPct
  // above, just summed/sequenced instead of averaged.
  totalR: number
  maxDD: number
  profitFactor: number | null
}

export interface PatternSummary {
  totalPatterns: number
  triggerRate: number | null
  winRate: number | null
  avgR: number | null
  byFamily: PatternBreakdownRow[]
  byGranularity: PatternBreakdownRow[]
  byAssetClass: PatternBreakdownRow[]
}

export const FAMILY_LABELS: Record<string, string> = {
  FLAG: 'Flag',
  PENNANT: 'Pennant',
  CONT_WEDGE: 'Continuation Wedge',
  TB: 'Triple Bottom',
  TT: 'Triple Top',
  IHS: 'Inverse Head & Shoulders',
  HS: 'Head & Shoulders',
  SYM_TRIANGLE_BULL_REV: 'Sym. Triangle (Bull Reversal)',
  SYM_TRIANGLE_BULL_CONT: 'Sym. Triangle (Bull Continuation)',
  SYM_TRIANGLE_BEAR_CONT: 'Sym. Triangle (Bear Continuation)',
  SYM_TRIANGLE_BEAR_REV: 'Sym. Triangle (Bear Reversal)',
  RECTANGLE_BULL_CONT: 'Rectangle (Bull Continuation)',
  RECTANGLE_BULL_REV: 'Rectangle (Bull Reversal)',
  RECTANGLE_BEAR_CONT: 'Rectangle (Bear Continuation)',
  RECTANGLE_BEAR_REV: 'Rectangle (Bear Reversal)',
  DT: 'Double Top',
  DB: 'Double Bottom',
  DESC_TRIANGLE_CONT: 'Descending Triangle (Continuation)',
}

// Fixed, always-shown row sets -- unlike Family (a dynamic "what actually showed up,
// sorted by count" table), Granularity and Asset Class are meant to read as a
// complete breakdown of the feed's own fixed categories, present or not.
export const GRANULARITY_ORDER = ['1h', '4h', '1d']
export const ASSET_CLASS_ORDER = ['FX', 'Equity', 'Commodity', 'Crypto', 'Index']

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
// approach as lib/metrics.ts's maxDrawdown(), reimplemented here because these rows
// are keyed by rr/status, not result_r/triggered.
function sequenceDrawdown(closedRows: PatternTradePoint[]): number {
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

function aggregate(rows: PatternTradePoint[]): Aggregate {
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

function groupBy(rows: PatternTradePoint[], field: 'family' | 'granularity' | 'asset_class'): Map<string, PatternTradePoint[]> {
  const map = new Map<string, PatternTradePoint[]>()
  for (const row of rows) {
    const key = row[field]
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(row)
  }
  return map
}

function toBreakdownRow(key: string, label: string, rows: PatternTradePoint[]): PatternBreakdownRow {
  const agg = aggregate(rows)
  return {
    key, label, count: agg.count, triggerPct: agg.triggerPct, winPct: agg.winPct, avgR: agg.avgR,
    totalR: agg.totalR, maxDD: agg.maxDD, profitFactor: agg.profitFactor,
  }
}

export function computePatternSummary(rows: PatternTradePoint[]): PatternSummary {
  const overall = aggregate(rows)

  const byFamilyMap = groupBy(rows, 'family')
  const byFamily = [...byFamilyMap.entries()]
    .map(([key, groupRows]) => toBreakdownRow(key, FAMILY_LABELS[key] ?? key, groupRows))
    .sort((a, b) => b.count - a.count)

  const byGranularityMap = groupBy(rows, 'granularity')
  const byGranularity = GRANULARITY_ORDER.map(key => toBreakdownRow(key, key, byGranularityMap.get(key) ?? []))

  const byAssetClassMap = groupBy(rows, 'asset_class')
  const byAssetClass = ASSET_CLASS_ORDER.map(key => toBreakdownRow(key, key, byAssetClassMap.get(key) ?? []))

  return {
    totalPatterns: overall.count,
    triggerRate: overall.triggerPct,
    winRate: overall.winPct,
    avgR: overall.avgR,
    byFamily,
    byGranularity,
    byAssetClass,
  }
}
