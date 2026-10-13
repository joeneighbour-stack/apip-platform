import { formatR } from './format'

// Shared types + aggregation for the management analytics page's "All Signals" tab --
// combines actual_trades (human analyst), pattern_trades, and ai_trades into one
// side-by-side comparison. Each signal type has its own canonical "which rows count as
// a result" methodology (see the per-type comments in /api/analytics/combined/route.ts,
// which resolves that per-table logic before calling into this file): this module only
// does the generic number-crunching once that resolution is done, so the three types
// share one implementation instead of three near-duplicates.

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// A signal with a usable result -- `rr: null` rows are deliberately still passed in (not
// pre-filtered by the caller) so buildSignalTypeData can be handed every signal for
// totalSignals/firstSignalDate/lastSignalDate while only counting the subset with a
// result for win rate/avg R/total R/drawdown.
export interface NormalisedSignal {
  date: string
  rr: number | null
}

// Extends NormalisedSignal with the two extra fields the By Asset Class/By Market
// breakdowns need -- structurally still a NormalisedSignal (buildSignalTypeData only
// ever reads date/rr), so the route can build ONE enriched array per signal type and
// hand it to every function in this file instead of building separate arrays.
export interface EnrichedSignal extends NormalisedSignal {
  assetClass: string | null
  symbol: string | null
}

export interface SignalTypeSummary {
  // Deduplicated signal count (is_reiteration = false for AI; every row for
  // analyst/patterns, which have no reiteration concept) -- same population every other
  // field here (winRate/avgR/totalR/etc) is computed from.
  totalSignals: number
  // Every row actually published, including AI reiterations -- the caller
  // (/api/analytics/combined/route.ts) passes this in directly from the raw row count,
  // since it deliberately covers a DIFFERENT population than totalSignals for AI.
  totalPublished: number
  // Rows with triggered = true, from the same raw population as totalPublished (not
  // totalSignals) -- a reiteration can itself have triggered an entry even though it's
  // excluded from performance stats for being stacked on an already-open position.
  totalTriggered: number
  winRate: number | null
  avgR: number | null
  totalR: number
  maxDrawdownR: number
  firstSignalDate: string | null
  lastSignalDate: string | null
  // Not in the task's literal field list, but needed to honestly pool win rate across
  // signal types (winRate alone can't be weighted correctly without knowing each type's
  // sample size) for the tab's "X% of signals with a recorded outcome were profitable"
  // callout -- totalSignals isn't usable for that weighting since it counts every
  // published signal, not just the ones with a recorded result.
  outcomeCount: number
}

export interface MonthlyRPoint {
  month: string
  totalR: number
  trades: number
}

export interface CumulativeRPoint {
  date: string
  cumulativeR: number
}

export interface SignalTypeData {
  summary: SignalTypeSummary
  monthlyR: MonthlyRPoint[]
  cumulativeR: CumulativeRPoint[]
}

export function buildSignalTypeData(
  signals: NormalisedSignal[], totalPublished: number, totalTriggered: number,
): SignalTypeData {
  const totalSignals = signals.length
  const dates = signals.map(s => s.date).filter(Boolean).sort()
  const firstSignalDate = dates[0] ?? null
  const lastSignalDate = dates[dates.length - 1] ?? null

  const withOutcome = signals
    .filter((s): s is NormalisedSignal & { rr: number } => s.rr !== null)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))

  const wins = withOutcome.filter(s => s.rr > 0)
  const winRate = withOutcome.length > 0 ? wins.length / withOutcome.length : null
  const totalRSum = round2(withOutcome.reduce((sum, s) => sum + s.rr, 0))
  const avgR = withOutcome.length > 0 ? round2(totalRSum / withOutcome.length) : null

  let running = 0
  const cumulativeR: CumulativeRPoint[] = withOutcome.map(s => {
    running += s.rr
    return { date: s.date, cumulativeR: round2(running) }
  })

  let equity = 0, peak = 0, maxDD = 0
  for (const s of withOutcome) {
    equity += s.rr
    if (equity > peak) peak = equity
    else if (equity - peak < maxDD) maxDD = equity - peak
  }

  const monthlyMap = new Map<string, { totalR: number; trades: number }>()
  for (const s of withOutcome) {
    const month = s.date.slice(0, 7)
    const cur = monthlyMap.get(month) ?? { totalR: 0, trades: 0 }
    cur.totalR += s.rr
    cur.trades += 1
    monthlyMap.set(month, cur)
  }
  const monthlyR: MonthlyRPoint[] = [...monthlyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, totalR: round2(v.totalR), trades: v.trades }))

  return {
    summary: {
      totalSignals, totalPublished, totalTriggered, winRate, avgR, totalR: totalRSum, maxDrawdownR: round2(maxDD),
      firstSignalDate, lastSignalDate, outcomeCount: withOutcome.length,
    },
    monthlyR,
    cumulativeR,
  }
}

export interface IndexPoint {
  date: string
  value: number
}

// Rebases a series to START at 100 -- every series's FIRST point reads 100 regardless of
// sign or magnitude (shifted by its own first value, then scaled by the magnitude of its
// own total move), which is what makes three tracks of very different absolute R totals
// and different start dates into directly comparable growth curves: the winner's own
// final point lands at exactly 200, the loser's at exactly 0, and every point in between
// reads as relative growth from a shared 100 baseline. Shifting by firstVal before
// scaling (rather than dividing by the final value the way an earlier version of this
// function did) means it no longer matters whether the series' first, last, or any
// intermediate point is negative -- only a perfectly flat series (first === last) needs
// a special case, handled below by pinning every point to 100.
export function normaliseToIndex(points: { date: string; value: number }[]): IndexPoint[] {
  if (points.length === 0) return []
  const firstVal = points[0]!.value
  const lastVal = points[points.length - 1]!.value
  const span = lastVal - firstVal
  if (span === 0) return points.map(p => ({ date: p.date, value: 100 }))
  return points.map(p => ({ date: p.date, value: round2(100 + ((p.value - firstVal) / Math.abs(span)) * 100) }))
}

export interface CombinedCumulativePoint {
  date: string
  analyst: number | null
  patterns: number | null
  ai: number | null
}

// Merges three independent cumulative-R series (each only has a point on dates it had a
// closed signal) onto one shared date axis for a 3-line chart -- each series' value is
// forward-filled (step function) across dates where only the OTHER series moved, which
// is the standard way to overlay equity curves which don't move in lockstep. Works
// equally well for raw-R series or normaliseToIndex()'d series -- it only cares that
// each input point has {date, cumulativeR}.
export function mergeCumulativeSeries(
  analyst: CumulativeRPoint[], patterns: CumulativeRPoint[], ai: CumulativeRPoint[]
): CombinedCumulativePoint[] {
  const allDates = [...new Set([...analyst, ...patterns, ...ai].map(p => p.date))].sort()
  const analystByDate = new Map(analyst.map(p => [p.date, p.cumulativeR]))
  const patternsByDate = new Map(patterns.map(p => [p.date, p.cumulativeR]))
  const aiByDate = new Map(ai.map(p => [p.date, p.cumulativeR]))

  let aVal: number | null = null, pVal: number | null = null, iVal: number | null = null
  return allDates.map(date => {
    if (analystByDate.has(date)) aVal = analystByDate.get(date)!
    if (patternsByDate.has(date)) pVal = patternsByDate.get(date)!
    if (aiByDate.has(date)) iVal = aiByDate.get(date)!
    return { date, analyst: aVal, patterns: pVal, ai: iVal }
  })
}

export type SignalTypeKey = 'analyst' | 'patterns' | 'ai'
export const TYPE_LABELS: Record<SignalTypeKey, string> = {
  analyst: 'Analyst Signals',
  patterns: 'Pattern Signals',
  ai: 'AI Signals',
}
export const TYPE_ORDER: SignalTypeKey[] = ['analyst', 'patterns', 'ai']

export function monthYear(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

// Shared by CombinedSignalsTab.tsx (live dashboard) and CombinedSignalsReportBuilder.tsx
// (PDF report) -- kept here rather than in either component file so neither has to
// import the other (the tab dynamic-imports the report builder; a static import back
// from the report builder into the tab would be a real circular module dependency).
// Every callout is computed from whatever the current data actually shows, not
// asserted -- same honesty rule already applied throughout the Patterns/AI Signals
// report builders (e.g. their own confidence/timeframe insight callouts). A type with no
// data simply doesn't produce a callout about itself rather than a fabricated one.
export function buildKeyCallouts(types: Record<SignalTypeKey, SignalTypeData>): string[] {
  const callouts: string[] = []
  const entries = TYPE_ORDER.map(key => [key, types[key]] as const)

  const withWinRate = entries.filter(([, d]) => d.summary.winRate !== null)
  if (withWinRate.length > 0) {
    const [bestKey, bestData] = withWinRate.reduce((best, cur) => cur[1].summary.winRate! > best[1].summary.winRate! ? cur : best)
    callouts.push(
      `${TYPE_LABELS[bestKey]} have the highest win rate at ${Math.round(bestData.summary.winRate! * 100)}% ` +
      `across ${bestData.summary.outcomeCount.toLocaleString()} signals since ${monthYear(bestData.summary.firstSignalDate!)}.`
    )
  }

  const withFirstDate = entries.filter(([, d]) => d.summary.firstSignalDate !== null)
  if (withFirstDate.length > 0) {
    const [longestKey, longestData] = withFirstDate.reduce((best, cur) => cur[1].summary.firstSignalDate! < best[1].summary.firstSignalDate! ? cur : best)
    callouts.push(`${TYPE_LABELS[longestKey]} cover the longest track record, publishing since ${monthYear(longestData.summary.firstSignalDate!)}.`)
  }

  const totalOutcomes = entries.reduce((s, [, d]) => s + d.summary.outcomeCount, 0)
  if (totalOutcomes > 0) {
    const pooledWins = entries.reduce((s, [, d]) => s + (d.summary.winRate ?? 0) * d.summary.outcomeCount, 0)
    callouts.push(`Across all signal types, ${Math.round((pooledWins / totalOutcomes) * 100)}% of signals with a recorded outcome were profitable.`)
  }

  if (withFirstDate.length > 0) {
    const totalR = round2(entries.reduce((s, [, d]) => s + d.summary.totalR, 0))
    const earliestDate = withFirstDate.reduce((min, [, d]) => d.summary.firstSignalDate! < min ? d.summary.firstSignalDate! : min, withFirstDate[0]![1].summary.firstSignalDate!)
    callouts.push(`Combined total R across all signal types: ${formatR(totalR)} since ${monthYear(earliestDate)}.`)
  }

  return callouts
}

// ---------------------------------------------------------------------------
// Generic "group signals with an outcome by some key, sum R / count wins" primitive --
// shared by the By Asset Class, By Day of Week, By Month of Year, and Top Markets
// breakdowns below, which all differ only in WHAT they group by (asset class, weekday,
// calendar month, symbol) and whether they report per-type or pooled-across-type
// figures. Signals with no recorded outcome (rr === null) or a null key are excluded
// entirely -- there's nothing to attribute to a bucket without a result.
// ---------------------------------------------------------------------------

interface KeyedAggregate {
  totalR: number
  outcomeCount: number
  wins: number
}

function aggregateByKey<T extends NormalisedSignal>(
  signals: T[], keyFn: (signal: T) => string | null
): Map<string, KeyedAggregate> {
  const map = new Map<string, KeyedAggregate>()
  for (const s of signals) {
    if (s.rr === null) continue
    const key = keyFn(s)
    if (key === null) continue
    const cur = map.get(key) ?? { totalR: 0, outcomeCount: 0, wins: 0 }
    cur.totalR += s.rr
    cur.outcomeCount += 1
    if (s.rr > 0) cur.wins += 1
    map.set(key, cur)
  }
  return map
}

function poolAcrossTypes(maps: Map<string, KeyedAggregate>[]): Map<string, KeyedAggregate> {
  const pooled = new Map<string, KeyedAggregate>()
  for (const map of maps) {
    for (const [key, agg] of map.entries()) {
      const cur = pooled.get(key) ?? { totalR: 0, outcomeCount: 0, wins: 0 }
      cur.totalR += agg.totalR
      cur.outcomeCount += agg.outcomeCount
      cur.wins += agg.wins
      pooled.set(key, cur)
    }
  }
  return pooled
}

// ---------------------------------------------------------------------------
// Fix 2 -- By Asset Class
// ---------------------------------------------------------------------------

// Analyst signals get their asset_class from a real DB join (markets.asset_class, via
// the market_id embed in /api/analytics/combined/route.ts) -- which stores it UPPERCASE
// ('COMMODITY', 'INDEX', 'CRYPTO'), while pattern_trades/ai_trades store it Title Case
// ('Commodity', 'Index', 'Crypto'). Without normalising, the same real-world asset class
// would silently split into two separate rows (one per casing) instead of merging across
// signal types, which defeats the entire point of this breakdown. Falls back to the raw
// value, Title-Cased, for anything outside this known set rather than dropping it.
const ASSET_CLASS_CANONICAL: Record<string, string> = {
  FX: 'FX', EQUITY: 'Equity', COMMODITY: 'Commodity', CRYPTO: 'Crypto', INDEX: 'Index',
}

function canonicalAssetClass(raw: string | null): string | null {
  if (!raw) return null
  const upper = raw.toUpperCase()
  return ASSET_CLASS_CANONICAL[upper] ?? (raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase())
}

export interface CombinedAssetClassRow {
  assetClass: string
  // Each type's OWN total R contribution within this asset class (null if that type has
  // no outcome-bearing signals in this class at all) -- analystR + patternR + aiR sums
  // to combinedTotalR, so the reader can see which type drives each class.
  analystR: number | null
  patternR: number | null
  aiR: number | null
  combinedTotalR: number
  combinedWinRate: number | null
}

export function buildAssetClassBreakdown(
  analyst: EnrichedSignal[], patterns: EnrichedSignal[], ai: EnrichedSignal[]
): CombinedAssetClassRow[] {
  const aMap = aggregateByKey(analyst, s => canonicalAssetClass(s.assetClass))
  const pMap = aggregateByKey(patterns, s => canonicalAssetClass(s.assetClass))
  const iMap = aggregateByKey(ai, s => canonicalAssetClass(s.assetClass))
  const allClasses = [...new Set([...aMap.keys(), ...pMap.keys(), ...iMap.keys()])].sort()

  return allClasses
    .map(assetClass => {
      const a = aMap.get(assetClass), p = pMap.get(assetClass), i = iMap.get(assetClass)
      const combinedOutcomeCount = (a?.outcomeCount ?? 0) + (p?.outcomeCount ?? 0) + (i?.outcomeCount ?? 0)
      const combinedWins = (a?.wins ?? 0) + (p?.wins ?? 0) + (i?.wins ?? 0)
      return {
        assetClass,
        analystR: a ? round2(a.totalR) : null,
        patternR: p ? round2(p.totalR) : null,
        aiR: i ? round2(i.totalR) : null,
        combinedTotalR: round2((a?.totalR ?? 0) + (p?.totalR ?? 0) + (i?.totalR ?? 0)),
        combinedWinRate: combinedOutcomeCount > 0 ? round2(combinedWins / combinedOutcomeCount) : null,
      }
    })
    .sort((a, b) => b.combinedTotalR - a.combinedTotalR)
}

// ---------------------------------------------------------------------------
// Fix 3/4 -- By Day of Week / By Month of Year (pooled across all three types)
// ---------------------------------------------------------------------------

const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const MONTH_ORDER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Noon UTC avoids any DST/timezone edge case shifting a date string across a weekday
// boundary -- every date this module handles is already a plain "YYYY-MM-DD" string.
function weekdayKey(dateStr: string): string | null {
  const day = new Date(dateStr + 'T12:00:00Z').getUTCDay() // 0=Sun..6=Sat
  return day >= 1 && day <= 5 ? WEEKDAY_ORDER[day - 1]! : null // weekends excluded -- Mon-Fri only, per the task
}

function monthOfYearKey(dateStr: string): string {
  const monthNum = Number(dateStr.slice(5, 7)) // 1-12
  return MONTH_ORDER[monthNum - 1]!
}

export interface PeriodRow {
  avgR: number | null
  winRate: number | null
  trades: number
}

function buildPooledPeriodBreakdown(
  analyst: NormalisedSignal[], patterns: NormalisedSignal[], ai: NormalisedSignal[],
  keyFn: (dateStr: string) => string | null, order: string[],
): Map<string, PeriodRow> {
  const pooled = poolAcrossTypes([
    aggregateByKey(analyst, s => keyFn(s.date)),
    aggregateByKey(patterns, s => keyFn(s.date)),
    aggregateByKey(ai, s => keyFn(s.date)),
  ])
  const result = new Map<string, PeriodRow>()
  for (const key of order) {
    const agg = pooled.get(key)
    const trades = agg?.outcomeCount ?? 0
    result.set(key, {
      avgR: trades > 0 ? round2(agg!.totalR / trades) : null,
      winRate: trades > 0 ? round2(agg!.wins / trades) : null,
      trades,
    })
  }
  return result
}

export interface DayOfWeekRow extends PeriodRow {
  day: string
}

export function buildDayOfWeekBreakdown(
  analyst: NormalisedSignal[], patterns: NormalisedSignal[], ai: NormalisedSignal[]
): DayOfWeekRow[] {
  const rows = buildPooledPeriodBreakdown(analyst, patterns, ai, weekdayKey, WEEKDAY_ORDER)
  return WEEKDAY_ORDER.map(day => ({ day, ...rows.get(day)! }))
}

export interface MonthOfYearRow extends PeriodRow {
  month: string
}

export function buildMonthBreakdown(
  analyst: NormalisedSignal[], patterns: NormalisedSignal[], ai: NormalisedSignal[]
): MonthOfYearRow[] {
  const rows = buildPooledPeriodBreakdown(analyst, patterns, ai, monthOfYearKey, MONTH_ORDER)
  return MONTH_ORDER.map(month => ({ month, ...rows.get(month)! }))
}

// ---------------------------------------------------------------------------
// Fix 5 -- Year-by-year grid (per type, NOT pooled -- a heat-map grid is meant to show
// each type's own year, side by side, not a single merged figure)
// ---------------------------------------------------------------------------

export interface CombinedYearRow {
  year: number
  analyst: number | null
  pattern: number | null
  ai: number | null
}

function totalRByYear(signals: NormalisedSignal[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const s of signals) {
    if (s.rr === null) continue
    const year = Number(s.date.slice(0, 4))
    map.set(year, round2((map.get(year) ?? 0) + s.rr))
  }
  return map
}

// Rows span every year from 2017 (the earliest any signal type's history goes back to)
// through the current year, even a year with zero rows for every type, so the grid reads
// as a continuous timeline rather than skipping gaps -- a year before a type's own first
// signal (or one with literally no outcome-bearing signals) shows as null ("—"), which
// is indistinguishable from "didn't exist yet" by design: there's no data to show either way.
const YEAR_GRID_START = 2017

export function buildYearGrid(
  analyst: NormalisedSignal[], patterns: NormalisedSignal[], ai: NormalisedSignal[]
): CombinedYearRow[] {
  const aYears = totalRByYear(analyst)
  const pYears = totalRByYear(patterns)
  const iYears = totalRByYear(ai)
  const currentYear = new Date().getUTCFullYear()

  const years: number[] = []
  for (let y = YEAR_GRID_START; y <= currentYear; y++) years.push(y)

  return years.map(year => ({
    year,
    analyst: aYears.get(year) ?? null,
    pattern: pYears.get(year) ?? null,
    ai: iYears.get(year) ?? null,
  }))
}

// ---------------------------------------------------------------------------
// Fix 6 -- Top markets combined (per type, like By Asset Class, but keyed by symbol and
// capped to the top N by combined total R)
// ---------------------------------------------------------------------------

export interface CombinedMarketRow {
  symbol: string
  analystR: number | null
  patternR: number | null
  aiR: number | null
  combinedTotalR: number
  combinedWinRate: number | null
  trades: number
}

export function buildTopMarkets(
  analyst: EnrichedSignal[], patterns: EnrichedSignal[], ai: EnrichedSignal[], limit = 20
): CombinedMarketRow[] {
  const aMap = aggregateByKey(analyst, s => s.symbol)
  const pMap = aggregateByKey(patterns, s => s.symbol)
  const iMap = aggregateByKey(ai, s => s.symbol)
  const allSymbols = new Set([...aMap.keys(), ...pMap.keys(), ...iMap.keys()])

  const rows: CombinedMarketRow[] = [...allSymbols].map(symbol => {
    const a = aMap.get(symbol), p = pMap.get(symbol), i = iMap.get(symbol)
    const combinedOutcomeCount = (a?.outcomeCount ?? 0) + (p?.outcomeCount ?? 0) + (i?.outcomeCount ?? 0)
    const combinedWins = (a?.wins ?? 0) + (p?.wins ?? 0) + (i?.wins ?? 0)
    return {
      symbol,
      analystR: a ? round2(a.totalR) : null,
      patternR: p ? round2(p.totalR) : null,
      aiR: i ? round2(i.totalR) : null,
      combinedTotalR: round2((a?.totalR ?? 0) + (p?.totalR ?? 0) + (i?.totalR ?? 0)),
      combinedWinRate: combinedOutcomeCount > 0 ? round2(combinedWins / combinedOutcomeCount) : null,
      trades: combinedOutcomeCount,
    }
  })

  return rows.sort((a, b) => b.combinedTotalR - a.combinedTotalR).slice(0, limit)
}
