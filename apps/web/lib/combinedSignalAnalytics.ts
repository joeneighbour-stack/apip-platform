// apps/web/lib/combinedSignalAnalytics.ts

// ─── Signal type keys / labels / order ──────────────────────────────────────

export type SignalTypeKey = 'analyst' | 'patterns' | 'ai'

export const TYPE_ORDER: SignalTypeKey[] = ['analyst', 'patterns', 'ai']

export const TYPE_LABELS: Record<SignalTypeKey, string> = {
  analyst: 'Analyst Signals',
  patterns: 'Pattern Signals',
  ai: 'AI Signals',
}

// ─── Core data shapes ────────────────────────────────────────────────────────

export interface EnrichedSignal {
  date: string          // YYYY-MM-DD
  rr: number | null
  assetClass: string | null
  symbol: string | null
}

export interface CumulativeRPoint {
  date: string
  cumulativeR: number
}

// Alias used by CombinedCumulativeChart.tsx and CombinedSignalsReportBuilder.tsx
export type CombinedCumulativePoint = { date: string; analyst?: number | null; patterns?: number | null; ai?: number | null }

export interface NormalisedPoint {
  date: string
  value: number
}

export interface SignalTypeSummary {
  totalPublished: number
  totalSignals: number
  winRate: number        // fraction 0–1
  avgR: number
  totalR: number
  maxDrawdownR: number
  payoutRatio: number | null
  breakEvenWinRate: number | null
  firstSignalDate: string | null
  lastSignalDate: string | null
}

export interface SignalTypeData {
  summary: SignalTypeSummary
  cumulativeR: CumulativeRPoint[]
}

export interface CombinedAssetClassRow {
  assetClass: string
  analystR: number | null
  patternR: number | null
  aiR: number | null
  combinedTotalR: number | null
  combinedWinRate: number | null  // fraction 0–1
}

export interface CombinedMarketRow {
  symbol: string
  analystR: number | null
  patternR: number | null
  aiR: number | null
  combinedTotalR: number | null
  combinedWinRate: number | null  // fraction 0–1
  trades: number
}

export interface CombinedYearRow {
  year: number
  analyst: number | null
  pattern: number | null
  ai: number | null
}

export interface DayOfWeekRow {
  day: string
  trades: number
  winRate: number | null  // fraction 0–1
  avgR: number | null
}

export interface MonthOfYearRow {
  month: string
  trades: number
  winRate: number | null  // fraction 0–1
  avgR: number | null
}

// ─── Canonical maps ──────────────────────────────────────────────────────────

const ASSET_CLASS_CANONICAL: Record<string, string> = {
  COMMODITY: 'Commodity',
  COMMODITIES: 'Commodity',
  INDEX: 'Index',
  INDICES: 'Index',
  CRYPTO: 'Crypto',
  CRYPTOCURRENCY: 'Crypto',
  FX: 'FX',
  FOREX: 'FX',
  EQUITY: 'Equity',
  EQUITIES: 'Equity',
}

function canonicalAssetClass(raw: string | null): string | null {
  if (!raw) return null
  return ASSET_CLASS_CANONICAL[raw.toUpperCase()] ?? raw
}

const SYMBOL_CANONICAL: Record<string, string> = {
  Bitcoin: 'BTC',
  BITCOIN: 'BTC',
  Ethereum: 'ETH',
  ETHEREUM: 'ETH',
  Ripple: 'XRP',
  RIPPLE: 'XRP',
  Solana: 'SOL',
  SOLANA: 'SOL',
  DOW: 'US30',
  Dow: 'US30',
  NASDAQ: 'US100',
  Nasdaq: 'US100',
  SP500: 'US500',
  'S&P500': 'US500',
  'S&P 500': 'US500',
  ASX200: 'AU200',
  DAX: 'DE40',
  Dax: 'DE40',
  NIKKEI: 'Nikkei',
}

function canonicalSymbol(raw: string | null): string | null {
  if (!raw) return null
  return SYMBOL_CANONICAL[raw] ?? raw
}

// ─── Utility exports ─────────────────────────────────────────────────────────

export function monthYear(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

// ─── Shared aggregation primitive ────────────────────────────────────────────

interface AggBucket {
  totalR: number
  wins: number
  outcomes: number
}

function aggregateByKey<T>(
  signals: T[],
  keyFn: (s: T) => string | null,
  rrFn: (s: T) => number | null,
): Map<string, AggBucket> {
  const map = new Map<string, AggBucket>()
  for (const s of signals) {
    const key = keyFn(s)
    if (!key) continue
    const rr = rrFn(s)
    if (rr === null) continue
    const bucket = map.get(key) ?? { totalR: 0, wins: 0, outcomes: 0 }
    bucket.totalR += rr
    bucket.outcomes += 1
    if (rr > 0) bucket.wins += 1
    map.set(key, bucket)
  }
  return map
}

// ─── Normalise cumulative series to start at 100 ─────────────────────────────

export function normaliseToIndex(points: NormalisedPoint[]): NormalisedPoint[] {
  if (points.length === 0) return []
  const firstVal = points[0].value
  const lastVal = points[points.length - 1].value
  const span = Math.abs(lastVal - firstVal) || 1
  return points.map(p => ({
    date: p.date,
    value: 100 + ((p.value - firstVal) / span) * 100,
  }))
}

// ─── Max drawdown ─────────────────────────────────────────────────────────────

function maxDrawdown(signals: EnrichedSignal[]): number {
  const withOutcome = signals.filter(s => s.rr !== null).sort((a, b) => a.date.localeCompare(b.date))
  let peak = 0
  let cumulative = 0
  let maxDD = 0
  for (const s of withOutcome) {
    cumulative += s.rr!
    if (cumulative > peak) peak = cumulative
    const dd = peak - cumulative
    if (dd > maxDD) maxDD = dd
  }
  return Math.round(maxDD * 100) / 100
}

// ─── Cumulative R series builder ─────────────────────────────────────────────

function buildCumulativeR(signals: EnrichedSignal[]): CumulativeRPoint[] {
  const sorted = [...signals]
    .filter(s => s.rr !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
  let cumulative = 0
  return sorted.map(s => {
    cumulative += s.rr!
    return { date: s.date, cumulativeR: cumulative }
  })
}

// ─── Merge cumulative series (outer join by date) ────────────────────────────

export function mergeCumulativeSeries(
  analyst: CumulativeRPoint[],
  patterns: CumulativeRPoint[],
  ai: CumulativeRPoint[],
): CombinedCumulativePoint[] {
  const allDates = new Set([
    ...analyst.map(p => p.date),
    ...patterns.map(p => p.date),
    ...ai.map(p => p.date),
  ])
  const sorted = [...allDates].sort()

  const aMap = new Map(analyst.map(p => [p.date, p.cumulativeR]))
  const pMap = new Map(patterns.map(p => [p.date, p.cumulativeR]))
  const iMap = new Map(ai.map(p => [p.date, p.cumulativeR]))

  let lastA: number | undefined
  let lastP: number | undefined
  let lastI: number | undefined

  return sorted.map(date => {
    if (aMap.has(date)) lastA = aMap.get(date)
    if (pMap.has(date)) lastP = pMap.get(date)
    if (iMap.has(date)) lastI = iMap.get(date)
    return { date, analyst: lastA, patterns: lastP, ai: lastI }
  })
}

// ─── buildSignalTypeData ──────────────────────────────────────────────────────

export function buildSignalTypeData(
  signals: EnrichedSignal[],
  totalPublished: number,
): SignalTypeData {
  const withOutcome = signals.filter(s => s.rr !== null)
  const totalR = withOutcome.reduce((sum, s) => sum + s.rr!, 0)
  const wins = withOutcome.filter(s => s.rr! > 0).length
  const outcomeCount = withOutcome.length

  const winRRs = withOutcome.filter(s => s.rr! > 0).map(s => s.rr!)
  const lossRRs = withOutcome.filter(s => s.rr! < 0).map(s => s.rr!)
  let payoutRatio: number | null = null
  let breakEvenWinRate: number | null = null
  if (winRRs.length > 0 && lossRRs.length > 0) {
    const avgWin = winRRs.reduce((s, rr) => s + rr, 0) / winRRs.length
    const avgLoss = Math.abs(lossRRs.reduce((s, rr) => s + rr, 0) / lossRRs.length)
    if (avgLoss > 0) {
      payoutRatio = Math.round((avgWin / avgLoss) * 100) / 100
      breakEvenWinRate = Math.round((1 / (1 + payoutRatio)) * 100) / 100
    }
  }

  const dated = signals.filter(s => s.date).map(s => s.date).sort()
  const firstSignalDate = dated[0] ?? null
  const lastSignalDate = dated[dated.length - 1] ?? null

  return {
    summary: {
      totalPublished,
      totalSignals: outcomeCount,
      winRate: outcomeCount > 0 ? wins / outcomeCount : 0,
      avgR: outcomeCount > 0 ? Math.round((totalR / outcomeCount) * 100) / 100 : 0,
      totalR: Math.round(totalR * 100) / 100,
      maxDrawdownR: maxDrawdown(signals),
      payoutRatio,
      breakEvenWinRate,
      firstSignalDate,
      lastSignalDate,
    },
    cumulativeR: buildCumulativeR(signals),
  }
}

// ─── buildKeyCallouts ─────────────────────────────────────────────────────────

export function buildKeyCallouts(types: Record<SignalTypeKey, SignalTypeData>): string[] {
  const callouts: string[] = []

  for (const key of TYPE_ORDER) {
    const d = types[key].summary
    if (d.totalSignals < 10) continue
    const label = TYPE_LABELS[key]
    callouts.push(
      `${label}: ${d.totalSignals.toLocaleString()} closed signals, ${formatWinRate(d.winRate)} win rate, ${formatTotalR(d.totalR)} total R.`
    )
  }

  const ranked = TYPE_ORDER
    .map(k => ({ key: k, totalR: types[k].summary.totalR, count: types[k].summary.totalSignals }))
    .filter(x => x.count >= 10)
    .sort((a, b) => b.totalR - a.totalR)

  if (ranked.length >= 2) {
    callouts.push(`${TYPE_LABELS[ranked[0].key]} leads on total R with ${formatTotalR(ranked[0].totalR)}.`)
  }

  return callouts
}

function formatWinRate(wr: number): string {
  return `${(wr * 100).toFixed(1)}%`
}

function formatTotalR(r: number): string {
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`
}

// ─── buildAssetClassBreakdown ─────────────────────────────────────────────────

export function buildAssetClassBreakdown(
  analystSignals: EnrichedSignal[],
  patternSignals: EnrichedSignal[],
  aiSignals: EnrichedSignal[],
): CombinedAssetClassRow[] {
  const aMap = aggregateByKey(analystSignals, s => canonicalAssetClass(s.assetClass), s => s.rr)
  const pMap = aggregateByKey(patternSignals, s => canonicalAssetClass(s.assetClass), s => s.rr)
  const iMap = aggregateByKey(aiSignals, s => canonicalAssetClass(s.assetClass), s => s.rr)

  const allClasses = new Set([...aMap.keys(), ...pMap.keys(), ...iMap.keys()])

  return [...allClasses].sort().map(cls => {
    const a = aMap.get(cls)
    const p = pMap.get(cls)
    const i = iMap.get(cls)

    const combinedOutcomes = (a?.outcomes ?? 0) + (p?.outcomes ?? 0) + (i?.outcomes ?? 0)
    const combinedWins = (a?.wins ?? 0) + (p?.wins ?? 0) + (i?.wins ?? 0)
    const combinedR = (a?.totalR ?? 0) + (p?.totalR ?? 0) + (i?.totalR ?? 0)

    return {
      assetClass: cls,
      analystR: a ? Math.round(a.totalR * 100) / 100 : null,
      patternR: p ? Math.round(p.totalR * 100) / 100 : null,
      aiR: i ? Math.round(i.totalR * 100) / 100 : null,
      combinedTotalR: combinedOutcomes > 0 ? Math.round(combinedR * 100) / 100 : null,
      combinedWinRate: combinedOutcomes > 0 ? combinedWins / combinedOutcomes : null,
    }
  })
}

// ─── buildTopMarkets ──────────────────────────────────────────────────────────

export function buildTopMarkets(
  analystSignals: EnrichedSignal[],
  patternSignals: EnrichedSignal[],
  aiSignals: EnrichedSignal[],
  topN = 20,
): CombinedMarketRow[] {
  const aMap = aggregateByKey(analystSignals, s => canonicalSymbol(s.symbol), s => s.rr)
  const pMap = aggregateByKey(patternSignals, s => canonicalSymbol(s.symbol), s => s.rr)
  const iMap = aggregateByKey(aiSignals, s => canonicalSymbol(s.symbol), s => s.rr)

  const allSymbols = new Set([...aMap.keys(), ...pMap.keys(), ...iMap.keys()])

  const rows: CombinedMarketRow[] = [...allSymbols].map(sym => {
    const a = aMap.get(sym)
    const p = pMap.get(sym)
    const i = iMap.get(sym)

    const combinedOutcomes = (a?.outcomes ?? 0) + (p?.outcomes ?? 0) + (i?.outcomes ?? 0)
    const combinedWins = (a?.wins ?? 0) + (p?.wins ?? 0) + (i?.wins ?? 0)
    const combinedR = (a?.totalR ?? 0) + (p?.totalR ?? 0) + (i?.totalR ?? 0)

    return {
      symbol: sym,
      analystR: a ? Math.round(a.totalR * 100) / 100 : null,
      patternR: p ? Math.round(p.totalR * 100) / 100 : null,
      aiR: i ? Math.round(i.totalR * 100) / 100 : null,
      combinedTotalR: combinedOutcomes > 0 ? Math.round(combinedR * 100) / 100 : null,
      combinedWinRate: combinedOutcomes > 0 ? combinedWins / combinedOutcomes : null,
      trades: combinedOutcomes,
    }
  })

  return rows.sort((a, b) => (b.combinedTotalR ?? 0) - (a.combinedTotalR ?? 0)).slice(0, topN)
}

// ─── buildYearGrid ────────────────────────────────────────────────────────────

export function buildYearGrid(
  analystSignals: EnrichedSignal[],
  patternSignals: EnrichedSignal[],
  aiSignals: EnrichedSignal[],
): CombinedYearRow[] {
  const yearFn = (s: EnrichedSignal) => s.date.slice(0, 4)

  const aMap = aggregateByKey(analystSignals, yearFn, s => s.rr)
  const pMap = aggregateByKey(patternSignals, yearFn, s => s.rr)
  const iMap = aggregateByKey(aiSignals, yearFn, s => s.rr)

  const allYears = new Set([...aMap.keys(), ...pMap.keys(), ...iMap.keys()])

  return [...allYears].sort().map(year => ({
    year: parseInt(year, 10),
    analyst: aMap.has(year) ? Math.round(aMap.get(year)!.totalR * 100) / 100 : null,
    pattern: pMap.has(year) ? Math.round(pMap.get(year)!.totalR * 100) / 100 : null,
    ai: iMap.has(year) ? Math.round(iMap.get(year)!.totalR * 100) / 100 : null,
  }))
}

// ─── buildDayOfWeekBreakdown ──────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function buildDayOfWeekBreakdown(
  analystSignals: EnrichedSignal[],
  patternSignals: EnrichedSignal[],
  aiSignals: EnrichedSignal[],
): DayOfWeekRow[] {
  const dayFn = (s: EnrichedSignal) => DAY_NAMES[new Date(s.date + 'T00:00:00Z').getUTCDay()]

  const allSignals = [...analystSignals, ...patternSignals, ...aiSignals]
  const map = aggregateByKey(allSignals, dayFn, s => s.rr)

  return DAY_NAMES.map(day => {
    const b = map.get(day)
    return {
      day,
      trades: b?.outcomes ?? 0,
      winRate: b && b.outcomes > 0 ? b.wins / b.outcomes : null,
      avgR: b && b.outcomes > 0 ? Math.round((b.totalR / b.outcomes) * 100) / 100 : null,
    }
  })
}

// ─── buildMonthBreakdown ──────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function buildMonthBreakdown(
  analystSignals: EnrichedSignal[],
  patternSignals: EnrichedSignal[],
  aiSignals: EnrichedSignal[],
): MonthOfYearRow[] {
  const monthFn = (s: EnrichedSignal) => MONTH_NAMES[parseInt(s.date.slice(5, 7), 10) - 1]

  const allSignals = [...analystSignals, ...patternSignals, ...aiSignals]
  const map = aggregateByKey(allSignals, monthFn, s => s.rr)

  return MONTH_NAMES.map(month => {
    const b = map.get(month)
    return {
      month,
      trades: b?.outcomes ?? 0,
      winRate: b && b.outcomes > 0 ? b.wins / b.outcomes : null,
      avgR: b && b.outcomes > 0 ? Math.round((b.totalR / b.outcomes) * 100) / 100 : null,
    }
  })
}