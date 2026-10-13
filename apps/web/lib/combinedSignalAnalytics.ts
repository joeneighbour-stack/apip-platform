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

// US public holidays (approximate, non-exhaustive -- add years as needed). Markets this
// app covers trade through some of these on some asset classes (Crypto never closes),
// but this denominator is about Acuity's own typical publication calendar (Mon-Fri,
// standard market holidays), not a per-asset-class trading calendar.
const US_HOLIDAYS = new Set([
  // New Year's Day
  '2017-01-02', '2018-01-01', '2019-01-01', '2020-01-01', '2021-01-01',
  '2022-01-03', '2023-01-02', '2024-01-01', '2025-01-01', '2026-01-01',
  // Christmas
  '2017-12-25', '2018-12-25', '2019-12-25', '2020-12-25', '2021-12-24',
  '2022-12-26', '2023-12-25', '2024-12-25', '2025-12-25', '2026-12-25',
  // Add MLK, Presidents Day, Memorial Day, Independence Day, Labor Day, Thanksgiving as needed
])

// Counts Mon-Fri dates between from/to (inclusive), excluding US_HOLIDAYS. Dates are
// parsed/compared entirely in UTC (not the task's literal `new Date(from)` +
// `d.getDay()`/`toISOString()` mix) -- those use the server process's LOCAL timezone for
// getDay() while toISOString() is always UTC, which can silently misclassify the weekday
// of a date right at a timezone boundary depending on where/when this code runs. Working
// in UTC throughout avoids that entirely, which matters here since every date this
// module handles elsewhere is already a plain UTC "YYYY-MM-DD" string (published_at
// sliced to its date portion).
function countTradingDays(fromDateStr: string, toDateStr: string): number {
  let count = 0
  const oneDayMs = 24 * 60 * 60 * 1000
  let cursor = new Date(fromDateStr + 'T00:00:00Z').getTime()
  const end = new Date(toDateStr + 'T00:00:00Z').getTime()
  while (cursor <= end) {
    const d = new Date(cursor)
    const day = d.getUTCDay() // 0=Sun, 6=Sat
    const iso = d.toISOString().slice(0, 10)
    if (day !== 0 && day !== 6 && !US_HOLIDAYS.has(iso)) count++
    cursor += oneDayMs
  }
  return count
}

// "Trading days" here means Mon-Fri dates (excluding US_HOLIDAYS) within the full
// calendar span from the earliest to the latest signal date across the input -- not
// distinct dates that happened to have a signal, which undercounts whenever a type
// publishes on weekends (Crypto signals land on Saturdays/Sundays, which would otherwise
// count as a full "trading day" and dilute the average) or simply has a quiet weekday
// with zero signals (which would otherwise disappear from the denominator entirely).
// Every signal's own publication date counts once in the numerator regardless of
// whether it has a recorded outcome -- this measures signal OUTPUT, not closed-trade
// performance. Friday has no APAC session (so Analyst Signals volume is naturally lower
// that day) -- Fridays are still counted as trading days here; that's intentional, it
// should average out rather than be excluded.
export function computeTotalSignalsPerDay(allSignalDates: string[]): number {
  if (allSignalDates.length === 0) return 0
  const sorted = allSignalDates.slice().sort()
  const earliest = sorted[0]!
  const latest = sorted[sorted.length - 1]!
  const tradingDays = countTradingDays(earliest, latest)
  return tradingDays > 0 ? round2(allSignalDates.length / tradingDays) : 0
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
// is the standard way to overlay equity curves which don't move in lockstep.
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

function monthYear(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
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
