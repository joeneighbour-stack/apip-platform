// Single source of truth for trading-performance calculations used by both the
// interactive Analytics page and generated PDF reports. Do not reimplement these
// formulas elsewhere -- import from here.

export interface MetricsTrade {
  analyst_id: string
  market_id: string
  symbol: string
  asset_class: string
  direction: 'BUY' | 'SELL'
  session: string | null
  source_system: string
  triggered: boolean
  result_r: number | null
  published_at: string
  closed_at?: string | null
}

export interface MetricsPublication {
  analyst_id: string
  market_id: string | null
  published_at: string
  reconciliation_status: string
}

const MIN_TRIGGER_SAMPLE = 5

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function isTriggeredWithResult(t: MetricsTrade): boolean {
  return t.triggered && t.result_r !== null
}

export function triggeredTrades(trades: MetricsTrade[]): MetricsTrade[] {
  return trades.filter(isTriggeredWithResult)
}

export function totalR(trades: MetricsTrade[]): number {
  return triggeredTrades(trades).reduce((s, t) => s + (t.result_r ?? 0), 0)
}

export function winRate(trades: MetricsTrade[]): number | null {
  const triggered = triggeredTrades(trades)
  if (triggered.length === 0) return null
  const wins = triggered.filter(t => (t.result_r ?? 0) > 0).length
  return wins / triggered.length
}

export function avgR(trades: MetricsTrade[]): number | null {
  const triggered = triggeredTrades(trades)
  if (triggered.length === 0) return null
  return totalR(trades) / triggered.length
}

// An "infinite" profit factor (wins with zero losses) is not a meaningful number to
// display -- treat it the same as insufficient data (null / "--") rather than showing
// a misleading large value or literal Infinity.
export function profitFactor(trades: MetricsTrade[]): number | null {
  const triggered = triggeredTrades(trades)
  if (triggered.length === 0) return null
  const gains = triggered.filter(t => (t.result_r ?? 0) > 0).reduce((s, t) => s + (t.result_r ?? 0), 0)
  const losses = triggered.filter(t => (t.result_r ?? 0) < 0).reduce((s, t) => s + (t.result_r ?? 0), 0)
  if (losses === 0) return null
  return gains / Math.abs(losses)
}

// Mirrors calculateKpis.ts's actual formula exactly: both numerator and denominator
// come from `analyst_publications` alone (reconciliation_status), with no join back
// to actual_trades. (An earlier version of this function cross-referenced
// ACUITY_PERFORMANCE_API-sourced trades for the numerator -- empirically verified
// against production data to be wrong: actual_trades only carries that source_system
// from MIN_API_DATE onward, while analyst_publications' webhook history goes back to
// ~2022, so the numerator was structurally starved and produced a ~1% rate. Publication
// reconciliation_status alone gives ~35%, consistent with this codebase's own
// triggered_rate target.)
//
// Per calculateKpis.ts's "hasUntriggered" gate: a month where every publication shows
// WEBHOOK_TRUE hasn't had its untriggered outcomes reconciled (common in backfill-era
// months where only triggered setups were ever recorded) -- including it would treat
// an unreconciled month as 100% triggered. Only months with a genuine untriggered
// baseline (and a minimum sample) count, and each qualifying month's own rate is
// averaged in (not trade-volume-weighted), same as the batch job.
export function triggerRate(pubs: MetricsPublication[]): number | null {
  const pubsByMonth = new Map<string, MetricsPublication[]>()
  for (const p of pubs) {
    const key = p.published_at.slice(0, 7)
    if (!pubsByMonth.has(key)) pubsByMonth.set(key, [])
    pubsByMonth.get(key)!.push(p)
  }

  const monthRates: number[] = []
  for (const [, monthPubs] of pubsByMonth.entries()) {
    if (monthPubs.length < MIN_TRIGGER_SAMPLE) continue
    const triggeredCount = monthPubs.filter(p => p.reconciliation_status === 'WEBHOOK_TRUE').length
    const hasUntriggered = triggeredCount < monthPubs.length
    if (!hasUntriggered) continue
    monthRates.push(triggeredCount / monthPubs.length)
  }

  if (monthRates.length === 0) return null
  return monthRates.reduce((s, r) => s + r, 0) / monthRates.length
}

export interface DrawdownResult {
  value: number
  sequenceLength: number
}

export function maxDrawdown(trades: MetricsTrade[]): DrawdownResult {
  const sorted = triggeredTrades(trades).slice().sort((a, b) => a.published_at.localeCompare(b.published_at))
  let equity = 0, peak = 0, maxDD = 0, maxSeq = 0, currentSeq = 0
  for (const t of sorted) {
    equity += t.result_r ?? 0
    if (equity > peak) {
      peak = equity
      currentSeq = 0
    } else {
      const dd = equity - peak
      if (dd < maxDD) maxDD = dd
      if ((t.result_r ?? 0) < 0) {
        currentSeq++
        if (currentSeq > maxSeq) maxSeq = currentSeq
      } else {
        currentSeq = 0
      }
    }
  }
  return { value: round2(maxDD), sequenceLength: maxSeq }
}

export interface PerformanceSummary {
  totalR: number
  avgR: number | null
  winRate: number | null
  triggerRate: number | null
  maxDrawdown: number
  profitFactor: number | null
  triggeredCount: number
  generatedCount: number
}

export function computeSummary(trades: MetricsTrade[], pubs: MetricsPublication[]): PerformanceSummary {
  const avg = avgR(trades)
  const pf = profitFactor(trades)
  return {
    totalR: round2(totalR(trades)),
    avgR: avg !== null ? round2(avg) : null,
    winRate: winRate(trades),
    triggerRate: triggerRate(pubs),
    maxDrawdown: maxDrawdown(trades).value,
    profitFactor: pf !== null ? round2(pf) : null,
    triggeredCount: triggeredTrades(trades).length,
    generatedCount: pubs.length,
  }
}

export interface CumulativePoint {
  date: string
  cumulativeR: number
  tradeR: number
}

export function cumulativeSeries(trades: MetricsTrade[]): CumulativePoint[] {
  const sorted = triggeredTrades(trades).slice().sort((a, b) => a.published_at.localeCompare(b.published_at))
  let running = 0
  return sorted.map(t => {
    running += t.result_r ?? 0
    return { date: t.published_at.slice(0, 10), cumulativeR: round2(running), tradeR: round2(t.result_r ?? 0) }
  })
}

export interface DrawdownPoint {
  date: string
  drawdown: number
}

export function drawdownSeries(trades: MetricsTrade[]): DrawdownPoint[] {
  const sorted = triggeredTrades(trades).slice().sort((a, b) => a.published_at.localeCompare(b.published_at))
  let equity = 0, peak = 0
  return sorted.map(t => {
    equity += t.result_r ?? 0
    if (equity > peak) peak = equity
    return { date: t.published_at.slice(0, 10), drawdown: round2(equity - peak) }
  })
}

export interface MonthCell {
  totalR: number | null
  trades: number
  winRate: number | null
  maxDD: number | null
}

export interface MonthlyMatrixRow {
  year: number
  months: MonthCell[]
  ytd: number | null
}

// Cells with no triggered trades are `totalR: null` (no data), distinct from a month
// that closed flat at exactly 0.00R (a real, valid neutral result).
export function monthlyMatrix(trades: MetricsTrade[]): MonthlyMatrixRow[] {
  const triggered = triggeredTrades(trades)
  const byYearMonth = new Map<string, MetricsTrade[]>()
  for (const t of triggered) {
    const key = t.published_at.slice(0, 7)
    if (!byYearMonth.has(key)) byYearMonth.set(key, [])
    byYearMonth.get(key)!.push(t)
  }
  const years = [...new Set([...byYearMonth.keys()].map(k => Number(k.slice(0, 4))))].sort()
  return years.map(year => {
    const months: MonthCell[] = []
    let ytd: number | null = null
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`
      const monthTrades = byYearMonth.get(key)
      if (!monthTrades || monthTrades.length === 0) {
        months.push({ totalR: null, trades: 0, winRate: null, maxDD: null })
        continue
      }
      const r = round2(totalR(monthTrades))
      months.push({ totalR: r, trades: monthTrades.length, winRate: winRate(monthTrades), maxDD: maxDrawdown(monthTrades).value })
      ytd = (ytd ?? 0) + r
    }
    return { year, months, ytd: ytd !== null ? round2(ytd) : null }
  })
}

export interface RollingRow {
  label: string
  totalR: number | null
  avgR: number | null
  winRate: number | null
  maxDD: number | null
  trades: number
  insufficientData: boolean
}

const ROLLING_WINDOWS: { label: string; days: number | null }[] = [
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '6M', days: 182 },
  { label: '1Y', days: 365 },
  { label: 'Since Inception', days: null },
]

// Rolling windows are always measured back from "today", independent of whatever
// date-range preset is active on the page -- this is how institutional rolling-return
// tables work (a fixed, standard set of lookback periods), not a filtered sub-view.
export function rollingWindows(trades: MetricsTrade[], asOf: Date): RollingRow[] {
  const triggered = triggeredTrades(trades)
  const earliest = triggered.length > 0
    ? triggered.reduce((min, t) => t.published_at < min ? t.published_at : min, triggered[0]!.published_at).slice(0, 10)
    : null

  return ROLLING_WINDOWS.map(w => {
    const windowStart = w.days === null
      ? earliest
      : new Date(asOf.getTime() - w.days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    if (windowStart === null) {
      return { label: w.label, totalR: null, avgR: null, winRate: null, maxDD: null, trades: 0, insufficientData: true }
    }
    // A fixed-length window (not Since Inception) needs data reaching back at least
    // as far as its nominal start -- otherwise it would silently understate a
    // "30 day" figure as if it were a full 30 days when there's only, say, 6.
    const insufficientData = w.days !== null && earliest !== null && earliest > windowStart
    if (insufficientData) {
      return { label: w.label, totalR: null, avgR: null, winRate: null, maxDD: null, trades: 0, insufficientData: true }
    }

    const windowTrades = trades.filter(t => t.published_at.slice(0, 10) >= windowStart && t.published_at.slice(0, 10) <= asOf.toISOString().slice(0, 10))
    const windowTriggered = triggeredTrades(windowTrades)
    if (windowTriggered.length === 0) {
      return { label: w.label, totalR: null, avgR: null, winRate: null, maxDD: null, trades: 0, insufficientData: false }
    }
    return {
      label: w.label,
      totalR: round2(totalR(windowTrades)),
      avgR: avgR(windowTrades) !== null ? round2(avgR(windowTrades)!) : null,
      winRate: winRate(windowTrades),
      maxDD: maxDrawdown(windowTrades).value,
      trades: windowTriggered.length,
      insufficientData: false,
    }
  })
}

export interface AttributionRow {
  key: string
  label: string
  trades: number
  winRate: number | null
  totalR: number
  avgR: number | null
  maxDD: number
  profitFactor: number | null
}

export function attributionBy(trades: MetricsTrade[], dimension: (t: MetricsTrade) => { key: string; label: string }): AttributionRow[] {
  const groups = new Map<string, { label: string; trades: MetricsTrade[] }>()
  for (const t of trades) {
    const { key, label } = dimension(t)
    if (!groups.has(key)) groups.set(key, { label, trades: [] })
    groups.get(key)!.trades.push(t)
  }
  return [...groups.entries()]
    .map(([key, { label, trades: groupTrades }]) => {
      const avg = avgR(groupTrades)
      const pf = profitFactor(groupTrades)
      return {
        key, label,
        trades: triggeredTrades(groupTrades).length,
        winRate: winRate(groupTrades),
        totalR: round2(totalR(groupTrades)),
        avgR: avg !== null ? round2(avg) : null,
        maxDD: maxDrawdown(groupTrades).value,
        profitFactor: pf !== null ? round2(pf) : null,
      }
    })
    .filter(row => row.trades > 0)
    .sort((a, b) => b.totalR - a.totalR)
}

// Shared by the interactive dashboard and the PDF report so both rank markets under
// the identical threshold -- one authoritative number, not three copies.
export const MIN_TRADES_FOR_MARKET_RANKING = 20

// Ranks already-grouped attribution rows (e.g. by market) by Total R, applying a
// minimum-sample floor so single-trade groups can't dominate a "best/worst" list --
// a market's worst possible single trade is capped at -1R, so raw trade-level
// worst-performer lists are meaningless; ranking by aggregate Total R per market
// with a real sample size is what actually surfaces where performance is won or lost.
export function rankAttribution(rows: AttributionRow[], minTrades: number, direction: 'best' | 'worst', n = 10): AttributionRow[] {
  const qualifying = rows.filter(r => r.trades >= minTrades)
  const sorted = direction === 'best'
    ? qualifying.sort((a, b) => b.totalR - a.totalR)
    : qualifying.sort((a, b) => a.totalR - b.totalR)
  return sorted.slice(0, n)
}

export interface DistributionBucket {
  label: string
  rangeStart: number
  rangeEnd: number
  count: number
}

export function resultDistribution(trades: MetricsTrade[], bucketSize = 1): DistributionBucket[] {
  const values = triggeredTrades(trades).map(t => t.result_r ?? 0)
  if (values.length === 0) return []
  const min = Math.floor(Math.min(...values, 0) / bucketSize) * bucketSize
  const max = Math.ceil(Math.max(...values, 0) / bucketSize) * bucketSize
  const buckets: DistributionBucket[] = []
  for (let start = min; start < max; start += bucketSize) {
    const end = start + bucketSize
    buckets.push({
      label: `${start}R to ${end}R`,
      rangeStart: start,
      rangeEnd: end,
      count: values.filter(v => v >= start && v < end).length,
    })
  }
  return buckets
}

export interface ComparisonResult {
  current: PerformanceSummary
  previous: PerformanceSummary | null
  label: string
}

export function compareSummaries(
  currentTrades: MetricsTrade[], currentPubs: MetricsPublication[],
  previousTrades: MetricsTrade[] | null, previousPubs: MetricsPublication[],
  label: string
): ComparisonResult {
  return {
    current: computeSummary(currentTrades, currentPubs),
    previous: previousTrades !== null ? computeSummary(previousTrades, previousPubs) : null,
    label,
  }
}

export function distinctAnalystCount(trades: MetricsTrade[]): number {
  return new Set(triggeredTrades(trades).map(t => t.analyst_id)).size
}

// Ties are common at the -1R floor (a capped loss), and Array.sort's stability means a
// plain sort-then-slice(-n) on ties silently surfaces whichever end of the tied block
// happens to sit at the array's tail -- since `trades` arrives published_at-descending
// from the API, that tail is the OLDEST tied trades, not the most recent. Breaking ties
// by recency explicitly avoids depending on incoming array order at all.
export function bestWorstTrades(trades: MetricsTrade[], n = 10): { best: MetricsTrade[]; worst: MetricsTrade[] } {
  const triggered = triggeredTrades(trades)
  const sorted = (direction: 'best' | 'worst') => {
    const sign = direction === 'worst' ? 1 : -1
    return [...triggered].sort((a, b) => {
      const resultDiff = sign * ((a.result_r ?? 0) - (b.result_r ?? 0))
      if (resultDiff !== 0) return resultDiff
      return b.published_at.localeCompare(a.published_at)
    })
  }
  return { best: sorted('best').slice(0, n), worst: sorted('worst').slice(0, n) }
}

export interface TradeStatisticsSummary {
  winRate: number | null
  lossRate: number | null
  avgWinner: number | null
  avgLoser: number | null
  avgR: number | null
  profitFactor: number | null
  triggerRate: number | null
  generated: number
  triggered: number
  expired: number
  avgDurationHours: number | null
}

// "Generated", "Triggered", "Expired" and "Trigger Rate" here all derive from the SAME
// array (`pubs`), the record of every setup actually published, so the four reconcile
// by construction (generated = triggered + expired, trigger rate = triggered/generated)
// -- not from `trades` (actual_trades): that table mixes in MANUAL_BACKFILL rows, which
// either duplicate recent API-sourced trades or (for genuinely historical dates) were
// never published through the webhook feed at all, so counting any of these four off
// `trades` inflates or deflates them relative to the others depending on the window.
// `triggered` here used to come from triggeredTrades(trades).length -- a different
// dataset than generated/expired's `pubs`, so the three never summed correctly and this
// table's own displayed Trigger Rate (via triggerRate()'s calculateKpis.ts-matching
// monthly-averaged formula, see that function's own comment) didn't equal
// triggered/generated either, since it isn't a plain ratio by design. That formula is
// still correct and still used by computeSummary() above for parity with
// calculateKpis.ts's actual KPI figure -- it's just not what this table's four adjacent
// fields need to visibly reconcile with each other.
export function computeTradeStatistics(trades: MetricsTrade[], pubs: MetricsPublication[]): TradeStatisticsSummary {
  const triggered = triggeredTrades(trades)
  const wins = triggered.filter(t => (t.result_r ?? 0) > 0)
  const losses = triggered.filter(t => (t.result_r ?? 0) < 0)
  const avgWinner = wins.length > 0 ? wins.reduce((s, t) => s + (t.result_r ?? 0), 0) / wins.length : null
  const avgLoser = losses.length > 0 ? losses.reduce((s, t) => s + (t.result_r ?? 0), 0) / losses.length : null

  const generated = pubs.length
  const triggeredCount = pubs.filter(p => p.reconciliation_status === 'WEBHOOK_TRUE').length
  const expired = generated - triggeredCount

  const durations = trades
    .filter(t => t.triggered && t.closed_at)
    .map(t => (new Date(t.closed_at as string).getTime() - new Date(t.published_at).getTime()) / (60 * 60 * 1000))
    .filter(h => h >= 0)
  const avgDurationHours = durations.length > 0 ? durations.reduce((s, h) => s + h, 0) / durations.length : null
  const wr = winRate(trades)
  const avg = avgR(trades)
  const pf = profitFactor(trades)

  return {
    winRate: wr,
    lossRate: wr !== null ? round2(1 - wr) : null,
    avgWinner: avgWinner !== null ? round2(avgWinner) : null,
    avgLoser: avgLoser !== null ? round2(avgLoser) : null,
    avgR: avg !== null ? round2(avg) : null,
    profitFactor: pf !== null ? round2(pf) : null,
    triggerRate: generated > 0 ? triggeredCount / generated : null,
    generated,
    triggered: triggeredCount,
    expired,
    avgDurationHours: avgDurationHours !== null ? Math.round(avgDurationHours * 10) / 10 : null,
  }
}
