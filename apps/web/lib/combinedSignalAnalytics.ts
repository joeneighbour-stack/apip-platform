// apps/web/lib/combinedSignalAnalytics.ts

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

export interface NormalisedPoint {
  date: string
  value: number
}

export interface SignalTypeData {
  uniqueSignals: number
  triggeredSignals: number
  outcomeCount: number
  totalR: number
  winRate: number
  avgR: number
  cumulativeR: CumulativeRPoint[]
}

export interface AssetClassRow {
  assetClass: string
  analystCount: number
  analystR: number | null
  analystWinRate: number | null
  patternCount: number
  patternR: number | null
  patternWinRate: number | null
  aiCount: number
  aiR: number | null
  aiWinRate: number | null
}

export interface TopMarketRow {
  symbol: string
  analystCount: number
  analystR: number | null
  analystWinRate: number | null
  patternCount: number
  patternR: number | null
  patternWinRate: number | null
  aiCount: number
  aiR: number | null
  aiWinRate: number | null
  totalSignals: number
}

export interface YearGridRow {
  year: number
  analystCount: number
  analystR: number | null
  analystWinRate: number | null
  patternCount: number
  patternR: number | null
  patternWinRate: number | null
  aiCount: number
  aiR: number | null
  aiWinRate: number | null
  combinedCount: number
  combinedR: number | null
  combinedWinRate: number | null
}

export interface DayOfWeekRow {
  day: string
  analystCount: number
  analystR: number | null
  patternCount: number
  patternR: number | null
  aiCount: number
  aiR: number | null
}

export interface MonthRow {
  month: string
  analystCount: number
  analystR: number | null
  patternCount: number
  patternR: number | null
  aiCount: number
  aiR: number | null
}

// ---------------------------------------------------------------------------
// Canonical maps
// ---------------------------------------------------------------------------

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
  // Crypto display names → tickers
  Bitcoin: 'BTC',
  BITCOIN: 'BTC',
  Ethereum: 'ETH',
  ETHEREUM: 'ETH',
  Ripple: 'XRP',
  RIPPLE: 'XRP',
  Solana: 'SOL',
  SOLANA: 'SOL',
  // Index display names → tickers
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
  // Oil stays as-is; Brent stays as-is (separate instruments)
}

function canonicalSymbol(raw: string | null): string | null {
  if (!raw) return null
  return SYMBOL_CANONICAL[raw] ?? raw
}

// ---------------------------------------------------------------------------
// Shared aggregation primitive
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Normalise cumulative series to start at 100
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Cumulative R series builder
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Merge cumulative series (outer join by date)
// ---------------------------------------------------------------------------

export function mergeCumulativeSeries(
  analyst: CumulativeRPoint[],
  patterns: CumulativeRPoint[],
  ai: CumulativeRPoint[],
): Array<{ date: string; analyst?: number; patterns?: number; ai?: number }> {
  const allDates = new Set([
    ...analyst.map(p => p.date),
    ...patterns.map(p => p.date),
    ...ai.map(p => p.date),
  ])
  const sorted = [...allDates].sort()

  const aMap = new Map(analyst.map(p => [p.date, p.cumulativeR]))
  const pMap = new Map(patterns.map(p => [p.date, p.cumulativeR]))
  const iMap = new Map(ai.map(p => [p.date, p.cumulativeR]))

  // Forward-fill
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

// ---------------------------------------------------------------------------
// buildSignalTypeData
// ---------------------------------------------------------------------------

export function buildSignalTypeData(
  signals: EnrichedSignal[],
  uniqueSignals: number,
  triggeredSignals: number,
): SignalTypeData {
  const withOutcome = signals.filter(s => s.rr !== null)
  const totalR = withOutcome.reduce((sum, s) => sum + s.rr!, 0)
  const wins = withOutcome.filter(s => s.rr! > 0).length
  const outcomeCount = withOutcome.length

  return {
    uniqueSignals,
    triggeredSignals,
    outcomeCount,
    totalR: Math.round(totalR * 100) / 100,
    winRate: outcomeCount > 0 ? Math.round((wins / outcomeCount) * 1000) / 10 : 0,
    avgR: outcomeCount > 0 ? Math.round((totalR / outcomeCount) * 100) / 100 : 0,
    cumulativeR: buildCumulativeR(signals),
  }
}

// ---------------------------------------------------------------------------
// buildAssetClassBreakdown
// ---------------------------------------------------------------------------

export function buildAssetClassBreakdown(
  analystSignals: EnrichedSignal[],
  patternSignals: EnrichedSignal[],
  aiSignals: EnrichedSignal[],
): AssetClassRow[] {
  const aMap = aggregateByKey(analystSignals, s => canonicalAssetClass(s.assetClass), s => s.rr)
  const pMap = aggregateByKey(patternSignals, s => canonicalAssetClass(s.assetClass), s => s.rr)
  const iMap = aggregateByKey(aiSignals, s => canonicalAssetClass(s.assetClass), s => s.rr)

  const allClasses = new Set([...aMap.keys(), ...pMap.keys(), ...iMap.keys()])

  return [...allClasses]
    .sort()
    .map(cls => {
      const a = aMap.get(cls)
      const p = pMap.get(cls)
      const i = iMap.get(cls)
      return {
        assetClass: cls,
        analystCount: a?.outcomes ?? 0,
        analystR: a ? Math.round(a.totalR * 100) / 100 : null,
        analystWinRate: a && a.outcomes > 0 ? Math.round((a.wins / a.outcomes) * 1000) / 10 : null,
        patternCount: p?.outcomes ?? 0,
        patternR: p ? Math.round(p.totalR * 100) / 100 : null,
        patternWinRate: p && p.outcomes > 0 ? Math.round((p.wins / p.outcomes) * 1000) / 10 : null,
        aiCount: i?.outcomes ?? 0,
        aiR: i ? Math.round(i.totalR * 100) / 100 : null,
        aiWinRate: i && i.outcomes > 0 ? Math.round((i.wins / i.outcomes) * 1000) / 10 : null,
      }
    })
}

// ---------------------------------------------------------------------------
// buildTopMarkets
// ---------------------------------------------------------------------------

export function buildTopMarkets(
  analystSignals: EnrichedSignal[],
  patternSignals: EnrichedSignal[],
  aiSignals: EnrichedSignal[],
  topN = 20,
): TopMarketRow[] {
  const aMap = aggregateByKey(analystSignals, s => canonicalSymbol(s.symbol), s => s.rr)
  const pMap = aggregateByKey(patternSignals, s => canonicalSymbol(s.symbol), s => s.rr)
  const iMap = aggregateByKey(aiSignals, s => canonicalSymbol(s.symbol), s => s.rr)

  const allSymbols = new Set([...aMap.keys(), ...pMap.keys(), ...iMap.keys()])

  const rows: TopMarketRow[] = [...allSymbols].map(sym => {
    const a = aMap.get(sym)
    const p = pMap.get(sym)
    const i = iMap.get(sym)
    return {
      symbol: sym,
      analystCount: a?.outcomes ?? 0,
      analystR: a ? Math.round(a.totalR * 100) / 100 : null,
      analystWinRate: a && a.outcomes > 0 ? Math.round((a.wins / a.outcomes) * 1000) / 10 : null,
      patternCount: p?.outcomes ?? 0,
      patternR: p ? Math.round(p.totalR * 100) / 100 : null,
      patternWinRate: p && p.outcomes > 0 ? Math.round((p.wins / p.outcomes) * 1000) / 10 : null,
      aiCount: i?.outcomes ?? 0,
      aiR: i ? Math.round(i.totalR * 100) / 100 : null,
      aiWinRate: i && i.outcomes > 0 ? Math.round((i.wins / i.outcomes) * 1000) / 10 : null,
      totalSignals: (a?.outcomes ?? 0) + (p?.outcomes ?? 0) + (i?.outcomes ?? 0),
    }
  })

  return rows
    .sort((a, b) => b.totalSignals - a.totalSignals)
    .slice(0, topN)
}

// ---------------------------------------------------------------------------
// buildYearGrid
// ---------------------------------------------------------------------------

export function buildYearGrid(
  analystSignals: EnrichedSignal[],
  patternSignals: EnrichedSignal[],
  aiSignals: EnrichedSignal[],
): YearGridRow[] {
  const yearFn = (s: EnrichedSignal) => s.date.slice(0, 4)

  const aMap = aggregateByKey(analystSignals, yearFn, s => s.rr)
  const pMap = aggregateByKey(patternSignals, yearFn, s => s.rr)
  const iMap = aggregateByKey(aiSignals, yearFn, s => s.rr)

  const allYears = new Set([...aMap.keys(), ...pMap.keys(), ...iMap.keys()])

  return [...allYears]
    .sort()
    .map(year => {
      const a = aMap.get(year)
      const p = pMap.get(year)
      const i = iMap.get(year)

      const combinedR = (a?.totalR ?? 0) + (p?.totalR ?? 0) + (i?.totalR ?? 0)
      const combinedOutcomes = (a?.outcomes ?? 0) + (p?.outcomes ?? 0) + (i?.outcomes ?? 0)
      const combinedWins = (a?.wins ?? 0) + (p?.wins ?? 0) + (i?.wins ?? 0)

      return {
        year: parseInt(year, 10),
        analystCount: a?.outcomes ?? 0,
        analystR: a ? Math.round(a.totalR * 100) / 100 : null,
        analystWinRate: a && a.outcomes > 0 ? Math.round((a.wins / a.outcomes) * 1000) / 10 : null,
        patternCount: p?.outcomes ?? 0,
        patternR: p ? Math.round(p.totalR * 100) / 100 : null,
        patternWinRate: p && p.outcomes > 0 ? Math.round((p.wins / p.outcomes) * 1000) / 10 : null,
        aiCount: i?.outcomes ?? 0,
        aiR: i ? Math.round(i.totalR * 100) / 100 : null,
        aiWinRate: i && i.outcomes > 0 ? Math.round((i.wins / i.outcomes) * 1000) / 10 : null,
        combinedCount: combinedOutcomes,
        combinedR: combinedOutcomes > 0 ? Math.round(combinedR * 100) / 100 : null,
        combinedWinRate: combinedOutcomes > 0 ? Math.round((combinedWins / combinedOutcomes) * 1000) / 10 : null,
      }
    })
}

// ---------------------------------------------------------------------------
// buildDayOfWeekBreakdown
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function buildDayOfWeekBreakdown(
  analystSignals: EnrichedSignal[],
  patternSignals: EnrichedSignal[],
  aiSignals: EnrichedSignal[],
): DayOfWeekRow[] {
  const dayFn = (s: EnrichedSignal) => {
    const d = new Date(s.date + 'T00:00:00Z')
    return DAY_NAMES[d.getUTCDay()]
  }

  const aMap = aggregateByKey(analystSignals, dayFn, s => s.rr)
  const pMap = aggregateByKey(patternSignals, dayFn, s => s.rr)
  const iMap = aggregateByKey(aiSignals, dayFn, s => s.rr)

  return DAY_NAMES.map(day => {
    const a = aMap.get(day)
    const p = pMap.get(day)
    const i = iMap.get(day)
    return {
      day,
      analystCount: a?.outcomes ?? 0,
      analystR: a ? Math.round(a.totalR * 100) / 100 : null,
      patternCount: p?.outcomes ?? 0,
      patternR: p ? Math.round(p.totalR * 100) / 100 : null,
      aiCount: i?.outcomes ?? 0,
      aiR: i ? Math.round(i.totalR * 100) / 100 : null,
    }
  })
}

// ---------------------------------------------------------------------------
// buildMonthBreakdown
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function buildMonthBreakdown(
  analystSignals: EnrichedSignal[],
  patternSignals: EnrichedSignal[],
  aiSignals: EnrichedSignal[],
): MonthRow[] {
  const monthFn = (s: EnrichedSignal) => {
    const m = parseInt(s.date.slice(5, 7), 10) - 1
    return MONTH_NAMES[m]
  }

  const aMap = aggregateByKey(analystSignals, monthFn, s => s.rr)
  const pMap = aggregateByKey(patternSignals, monthFn, s => s.rr)
  const iMap = aggregateByKey(aiSignals, monthFn, s => s.rr)

  return MONTH_NAMES.map(month => {
    const a = aMap.get(month)
    const p = pMap.get(month)
    const i = iMap.get(month)
    return {
      month,
      analystCount: a?.outcomes ?? 0,
      analystR: a ? Math.round(a.totalR * 100) / 100 : null,
      patternCount: p?.outcomes ?? 0,
      patternR: p ? Math.round(p.totalR * 100) / 100 : null,
      aiCount: i?.outcomes ?? 0,
      aiR: i ? Math.round(i.totalR * 100) / 100 : null,
    }
  })
}