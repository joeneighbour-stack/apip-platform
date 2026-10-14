'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { computeAiSignalSummary, type AiSignalSummary, type AiBreakdownRow, type AiTradePoint } from '@/lib/aiSignalAnalytics'
import {
  triggeredTrades, totalR, winRate, avgR, maxDrawdown, cumulativeSeries, drawdownSeries, monthlyMatrix,
  attributionBy, rankAttribution, type MetricsTrade, type RollingRow, type AttributionRow,
} from '@/lib/metrics'
import { formatR, formatPercent, positivityClass } from '@/lib/format'
import { CumulativePerformanceChart, DrawdownChart, ContributionChart } from './LazyCharts'
import { RollingPerformanceTable } from './RollingPerformanceTable'
import { MonthlyPerformanceMatrix } from './MonthlyPerformanceMatrix'
import { AttributionTable } from './AttributionTable'
import { Tooltip } from '@/components/ui/Tooltip'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { type AiFilterState, DEFAULT_AI_FILTERS, hasActiveAiFilters } from '@/lib/analyticsFilters'
import { DATE_PRESET_OPTIONS, resolveDateRange } from '@/lib/dateRanges'

const REITERATION_TOOLTIP = 'A reiteration is published when the model identifies a continuing opportunity on a symbol that already has an open signal. Reiterations are recorded but excluded from performance statistics.'

// AI Signals reports use their own component (AiSignalsReportBuilder), not
// PatternReportBuilder or the shared analyst ReportBuilder -- see that file's own
// header comment for why. Dynamic-imported for the same reason as PatternsTab.tsx's
// own PatternReportBuilder import: keeps recharts out of the initial bundle until the
// user actually clicks "Generate Report".
const AiSignalsReportBuilder = dynamic(() => import('./AiSignalsReportBuilder').then(m => ({ default: m.AiSignalsReportBuilder })), {
  ssr: false,
})

// Same structure as PatternsTab.tsx, adapted for ai_trades (migrations/066_ai_trades.sql):
// confidence replaces family/granularity (AI signals have no pattern family or chart
// timeframe concept), and there's no PDF report builder equivalent here -- not asked
// for, and this tab's own headline finding (confidence doesn't predict outcome) is
// already front-and-centre in the dashboard itself.
type AiSignalsApiResponse = AiSignalSummary & {
  totalSignals: number
  uniqueSignals: number
  reiterations: number
  trades: AiTradePoint[]
}

// Same literal option sets as AnalyticsFilters.tsx's own (unexported) constants --
// duplicated rather than shared, matching this codebase's existing convention of
// self-contained sibling tab components (see e.g. PatternsTab.tsx's identical copy).
const DIRECTION_OPTIONS = [{ value: 'BUY', label: 'BUY' }, { value: 'SELL', label: 'SELL' }]
const SESSION_OPTIONS = [
  { value: 'EUROPEAN', label: 'European' }, { value: 'US', label: 'US' },
  { value: 'APAC', label: 'APAC' }, { value: 'CRYPTO', label: 'Crypto' },
]

// Same minimum sample used elsewhere in the app for market/entity ranking
// (lib/metrics.ts's MIN_TRADES_FOR_MARKET_RANKING).
const MIN_TRADES_FOR_SYMBOL_RANKING = 10

// By Market can run to hundreds of symbols -- capped to the top 20 by Total R (the
// order attributionBy() already returns) by default, with a toggle to see the rest.
const MARKET_TABLE_LIMIT = 20

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// AI trades use `rr` directly as the result (not result_r). A recorded rr is what
// defines "has a usable result" here -- NOT the DB `triggered` boolean: a meaningful
// share of AI signals close at expiry with a real recorded rr (mostly positive) while
// apparently carrying triggered=false, so gating result_r on t.triggered (as the
// Patterns tab adapter does) was silently dropping them from every lib/metrics.ts-driven
// calculation that reads this adapted shape -- cumulativeSeries/drawdownSeries/
// rollingTradeWindows/monthlyMatrix/byMarket/best-worst symbols all key off
// triggeredTrades(), which is `t.triggered && t.result_r !== null`. Setting both fields
// from rr !== null alone makes every one of those consistently include exactly the same
// population, so the KPI tile, the chart, and the rolling table's "Since Inception" row
// all agree. asset_name is extended on top purely so the By Market table below can label
// rows with a human-readable name instead of a bare ticker; none of lib/metrics.ts's
// functions read it.
function toAnalyticsTrade(t: AiTradePoint) {
  return {
    result_r: t.rr !== null ? t.rr : null,
    triggered: t.rr !== null,
    published_at: t.published_at,
    symbol: t.symbol ?? '',
    asset_class: t.asset_class ?? '',
    asset_name: t.asset_name ?? null,
  }
}

// lib/metrics.ts's own rollingWindows() is a fixed DATE-window table -- see
// PatternsTab.tsx's identical copy of this function for why a trade-COUNT version is
// needed instead. Duplicated here rather than shared, matching this codebase's existing
// convention of self-contained sibling tab components (see e.g.
// backfillAiTrades.ts/backfillPatternTrades.ts, which mirror each other file-for-file
// rather than sharing a module).
const ROLLING_TRADE_COUNTS = [20, 50, 100] as const

function rollingTradeWindows(trades: MetricsTrade[]): RollingRow[] {
  const triggered = triggeredTrades(trades).slice().sort((a, b) => a.published_at.localeCompare(b.published_at))
  const windows: { label: string; n: number }[] = [
    ...ROLLING_TRADE_COUNTS.map(n => ({ label: `Last ${n}`, n })),
    { label: 'Since Inception', n: triggered.length },
  ]
  return windows.map(w => {
    if (w.n === 0 || triggered.length < w.n) {
      return { label: w.label, totalR: null, avgR: null, winRate: null, maxDD: null, trades: 0, insufficientData: true }
    }
    const windowTrades = triggered.slice(-w.n)
    const avg = avgR(windowTrades)
    return {
      label: w.label,
      totalR: round2(totalR(windowTrades)),
      avgR: avg !== null ? round2(avg) : null,
      winRate: winRate(windowTrades),
      maxDD: maxDrawdown(windowTrades).value,
      trades: windowTrades.length,
      insufficientData: false,
    }
  })
}

// Maps the server-computed AiBreakdownRow (status-based win %, trigger % --
// lib/aiSignalAnalytics.ts's own formulas, kept as-is for these tables) onto
// AttributionTable's AttributionRow shape, same approach as PatternsTab.tsx's
// toAttributionRow.
function toAttributionRow(row: AiBreakdownRow): AttributionRow {
  return {
    key: row.key,
    label: row.label,
    trades: row.count,
    winRate: row.winPct,
    totalR: row.totalR,
    avgR: row.avgR,
    maxDD: row.maxDD,
    profitFactor: row.profitFactor,
  }
}

// Confidence 25 vs 100 is the dataset's own headline finding, but the actual direction
// of that finding must come from the data, not be asserted -- a document/dashboard
// telling a manager "higher confidence doesn't predict better outcomes" when the current
// filtered slice actually shows the opposite would be actively misleading, not just a
// copy-editing nicety.
function buildConfidenceInsight(rows: AttributionRow[]): string {
  const c25 = rows.find(r => r.key === '25')
  const c100 = rows.find(r => r.key === '100')
  if (c25?.avgR == null || c100?.avgR == null) {
    return 'Insufficient data to compare confidence 25 and confidence 100 signals yet.'
  }
  const diff = round2(c25.avgR - c100.avgR)
  if (diff > 0) {
    return `Signals with confidence score 25 outperform confidence 100 signals by ${formatR(diff)} avg R — higher confidence does not predict better outcomes in this dataset.`
  }
  if (diff < 0) {
    return `Confidence 100 signals outperform confidence 25 signals by ${formatR(round2(-diff))} avg R, consistent with higher confidence predicting better outcomes in this dataset.`
  }
  return 'Confidence 25 and confidence 100 signals show no meaningful difference in average R in this dataset.'
}

type AttributionSortCol = 'trades' | 'winRate' | 'totalR' | 'avgR' | 'profitFactor'
interface AttributionSort { col: AttributionSortCol; dir: 'asc' | 'desc' }

const SORTABLE_COLUMNS: { key: AttributionSortCol; label: string }[] = [
  { key: 'trades', label: 'Trades' },
  { key: 'winRate', label: 'Win %' },
  { key: 'totalR', label: 'Total R' },
  { key: 'avgR', label: 'Avg R' },
  { key: 'profitFactor', label: 'Profit Factor' },
]

function sortAttributionRows(rows: AttributionRow[], sort: AttributionSort): AttributionRow[] {
  return rows.slice().sort((a, b) => {
    const av = a[sort.col]
    const bv = b[sort.col]
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    return sort.dir === 'asc' ? av - bv : bv - av
  })
}

// Same click-to-sort table as PatternsTab.tsx's SortableAttributionTable (AttributionTable
// itself has no sort support) -- duplicated rather than shared for the same reason as
// rollingTradeWindows above.
const SORTABLE_COL_WIDTHS = ['26%', '12%', '12%', '18%', '16%', '16%']

function SortableAttributionTable({ title, rows, minTrades = 0, entityLabel = 'Rows', sort, onSortChange }: {
  title: string
  rows: AttributionRow[]
  minTrades?: number
  entityLabel?: string
  sort: AttributionSort
  onSortChange: (sort: AttributionSort) => void
}) {
  const qualifying = rows.filter(r => r.trades >= minTrades)
  const visible = useMemo(() => sortAttributionRows(qualifying, sort), [qualifying, sort])
  const excludedCount = rows.length - qualifying.length

  function toggleSort(col: AttributionSortCol) {
    onSortChange(sort.col === col ? { col, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' })
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">{title}</p>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">Insufficient data.</p>
      ) : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                {SORTABLE_COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap" />
                  {SORTABLE_COLUMNS.map(col => (
                    <th key={col.key} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <button onClick={() => toggleSort(col.key)}
                        className="flex items-center gap-1 hover:text-foreground transition-colors">
                        {col.label}
                        {sort.col === col.key && <span>{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((row, i) => (
                  <tr key={row.key} className={`hover:bg-muted/30 transition-colors ${i % 2 === 1 ? 'print:bg-black/[0.03]' : ''}`}>
                    <td className="px-4 py-2.5 font-medium truncate">{row.label}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.trades.toLocaleString()}</td>
                    <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatPercent(row.winRate)}</td>
                    <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${positivityClass(row.totalR)}`}>{formatR(row.totalR)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{formatR(row.avgR)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.profitFactor !== null ? row.profitFactor.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {minTrades > 0 && excludedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {entityLabel} with fewer than {minTrades} triggered trades excluded.
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function AiSignalsTab() {
  const [filters, setFilters] = useState<AiFilterState>(DEFAULT_AI_FILTERS)
  const [moreOpen, setMoreOpen] = useState(false)

  const [allTrades, setAllTrades] = useState<AiTradePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confidenceSort, setConfidenceSort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })
  const [assetClassSort, setAssetClassSort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })
  const [directionSort, setDirectionSort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })
  const [showAllMarkets, setShowAllMarkets] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  // Fetched once, unfiltered -- every filter below runs client-side against this set,
  // matching AnalyticsPage.tsx's (the Analyst Signals tab's) own fetch-once/filter-
  // client-side approach, and PatternsTab.tsx's identical rework.
  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/analytics/ai-signals')
      .then(r => r.json())
      .then((data: AiSignalsApiResponse | { error: string }) => {
        if ('error' in data) { setError(data.error); return }
        setAllTrades(data.trades)
      })
      .catch(() => setError('Failed to load AI signal data.'))
      .finally(() => setLoading(false))
  }, [])

  const dateRange = useMemo(
    () => resolveDateRange(filters.datePreset, filters.customStart ?? undefined, filters.customEnd ?? undefined),
    [filters.datePreset, filters.customStart, filters.customEnd]
  )

  // Filter option lists are derived from the fetched data itself -- ai_trades has no
  // separate reference table the way markets does for the Analyst tab.
  const assetClassOptions = useMemo(() => {
    const classes = [...new Set(allTrades.map(t => t.asset_class).filter((c): c is string => !!c))].sort()
    return classes.map(c => ({ value: c, label: c }))
  }, [allTrades])

  // Market options are symbols, not market_ids -- ai_trades carries no market_id at all
  // (see AiTradeRow), only a symbol string, so filters.marketIds holds symbols here.
  // Narrowed by selected asset classes, same as AnalyticsFilters.tsx's own
  // filteredMarkets. Labelled with asset_name when available, matching the By Market
  // table's own labeling below.
  const marketOptions = useMemo(() => {
    const bySymbol = new Map<string, { assetClass: string; label: string }>()
    for (const t of allTrades) {
      if (t.symbol && !bySymbol.has(t.symbol)) {
        bySymbol.set(t.symbol, { assetClass: t.asset_class ?? '', label: t.asset_name || t.symbol })
      }
    }
    const entries = filters.assetClasses.length === 0
      ? [...bySymbol.entries()]
      : [...bySymbol.entries()].filter(([, v]) => filters.assetClasses.includes(v.assetClass))
    return entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([symbol, v]) => ({ value: symbol, label: v.label }))
  }, [allTrades, filters.assetClasses])

  // ai_trades has no `session` column at all (migrations/066_ai_trades.sql -- same as
  // pattern_trades, see PatternsTab.tsx's identical note). filters.sessions is
  // intentionally never read below: there's no field on AiTradePoint to filter against.
  // The control is still shown for visual/UX parity with the Analyst tab's filter bar,
  // but it has no effect on this tab's results.
  const filteredTrades = useMemo(() => {
    return allTrades.filter(t => {
      const d = t.published_at.slice(0, 10)
      if (d < dateRange.start || d > dateRange.end) return false
      if (filters.assetClasses.length > 0 && (!t.asset_class || !filters.assetClasses.includes(t.asset_class))) return false
      if (filters.marketIds.length > 0 && (!t.symbol || !filters.marketIds.includes(t.symbol))) return false
      if (filters.directions.length > 0 && (!t.direction || !filters.directions.includes(t.direction))) return false
      return true
    })
  }, [allTrades, filters, dateRange])

  // totalSignals/uniqueSignals/reiterations were layered on top of AiSignalSummary by
  // the route (see the previous version's own comment) -- now computed client-side over
  // filteredTrades instead of the full unfiltered set, same split: totalSignals means
  // ALL filtered rows including reiterations, uniqueSignals is the deduplicated count.
  const summary = useMemo(() => {
    const uniqueSignals = filteredTrades.filter(t => !t.is_reiteration).length
    return {
      ...computeAiSignalSummary(filteredTrades),
      totalSignals: filteredTrades.length,
      uniqueSignals,
      reiterations: filteredTrades.length - uniqueSignals,
    }
  }, [filteredTrades])

  // Every chart/table below is built from dedupTrades, not the raw filtered array --
  // reiterations are recorded data (kept for the reiterations count/tooltip) but must
  // never feed cumulative/drawdown/rolling/monthly/breakdowns, same as
  // lib/aiSignalAnalytics.ts's own computeAiSignalSummary() already does internally for
  // win rate/avg R/total R/drawdown/breakdowns.
  const dedupTrades = useMemo(() => filteredTrades.filter(t => !t.is_reiteration), [filteredTrades])
  const analyticsTrades = useMemo(() => dedupTrades.map(toAnalyticsTrade) as unknown as MetricsTrade[], [dedupTrades])
  const cumulative = useMemo(() => cumulativeSeries(analyticsTrades), [analyticsTrades])
  const drawdown = useMemo(() => drawdownSeries(analyticsTrades), [analyticsTrades])
  const monthly = useMemo(() => monthlyMatrix(analyticsTrades), [analyticsTrades])
  const rolling = useMemo(() => rollingTradeWindows(analyticsTrades), [analyticsTrades])
  const maxDD = useMemo(() => maxDrawdown(analyticsTrades).value, [analyticsTrades])

  // KPI tile computed directly from the deduplicated trades array (not summary.cumulativeR,
  // which uses lib/aiSignalAnalytics.ts's status-gated "with outcome" definition for win
  // rate/avg R) -- Cumulative R here is simply every recorded rr summed across
  // deduplicated signals, matching the rolling table's "Since Inception" Total R row
  // above (both now key off rr !== null via the adapter, so the two numbers agree).
  const cumulativeRTotal = useMemo(
    () => round2(dedupTrades.filter(t => t.rr !== null).reduce((sum, t) => sum + (t.rr ?? 0), 0)),
    [dedupTrades]
  )

  const confidenceRows = useMemo(() => summary.byConfidence.map(toAttributionRow), [summary])
  // FX/Commodity/Index never appear in this dataset -- filtered out rather than shown
  // as permanent empty rows (ASSET_CLASS_ORDER in lib/aiSignalAnalytics.ts always
  // produces one row per fixed category, present or not).
  const assetClassRows = useMemo(
    () => summary.byAssetClass.map(toAttributionRow).filter(r => r.trades > 0),
    [summary]
  )
  const directionRows = useMemo(() => summary.byDirection.map(toAttributionRow), [summary])
  const confidenceInsight = useMemo(() => buildConfidenceInsight(confidenceRows), [confidenceRows])

  // By-symbol breakdown, computed directly from the trade series -- same
  // attributionBy() + AttributionTable minTrades pattern PatternsTab.tsx uses for its
  // own By Market table, labeled with asset_name (e.g. "Apple Inc.") when available
  // since that reads far better than a bare ticker for stocks/crypto.
  const byMarket = useMemo(
    () => attributionBy(analyticsTrades, t => {
      const assetName = (t as unknown as { asset_name: string | null }).asset_name
      return { key: t.symbol, label: assetName || t.symbol }
    }),
    [analyticsTrades]
  )
  const bestSymbols = useMemo(() => rankAttribution(byMarket, MIN_TRADES_FOR_SYMBOL_RANKING, 'best', 5), [byMarket])
  const worstSymbols = useMemo(() => rankAttribution(byMarket, MIN_TRADES_FOR_SYMBOL_RANKING, 'worst', 5), [byMarket])
  const displayedMarkets = useMemo(
    () => showAllMarkets ? byMarket : byMarket.slice(0, MARKET_TABLE_LIMIT),
    [byMarket, showAllMarkets]
  )

  return (
    <>
    {/* print:hidden is scoped to the dashboard chrome only, matching PatternsTab.tsx's
        own root return -- AiSignalsReportBuilder (and the print layout it mounts)
        renders as a sibling below, outside this div, since a display:none ancestor
        can't be overridden by a descendant's print:static rule. */}
    <div className="space-y-6 print:hidden">
      {/* Filter bar -- styled to match AnalyticsFilters.tsx (the Analyst Signals tab's
          own filter card) for visual consistency across tabs. No pattern type, analyst,
          or trigger status filters: ai_trades has no family/analyst_id concept and no
          untriggered state distinct from "closed with no result" the way actual_trades
          does. */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">Filters</p>
          {hasActiveAiFilters(filters) && (
            <button onClick={() => setFilters(DEFAULT_AI_FILTERS)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Clear all
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Date</p>
          <div className="flex flex-wrap gap-1.5">
            {DATE_PRESET_OPTIONS.map(opt => (
              <button key={opt.key} onClick={() => setFilters(f => ({ ...f, datePreset: opt.key }))}
                className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                  filters.datePreset === opt.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/50'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
          {filters.datePreset === 'CUSTOM' && (
            <div className="flex items-center gap-2 pt-1">
              <input type="date" value={filters.customStart ?? ''} onChange={e => setFilters(f => ({ ...f, customStart: e.target.value || null }))}
                className="text-xs px-2 py-1.5 rounded-md border border-border bg-background" />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="date" value={filters.customEnd ?? ''} onChange={e => setFilters(f => ({ ...f, customEnd: e.target.value || null }))}
                className="text-xs px-2 py-1.5 rounded-md border border-border bg-background" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <MultiSelect label="Asset Class" options={assetClassOptions} selected={filters.assetClasses}
            onChange={v => setFilters(f => ({ ...f, assetClasses: v, marketIds: [] }))} placeholder="All classes" />
          <MultiSelect label="Market" options={marketOptions} selected={filters.marketIds}
            onChange={v => setFilters(f => ({ ...f, marketIds: v }))} placeholder="All markets" />
        </div>

        <div className="border-t border-border pt-3">
          <button onClick={() => setMoreOpen(!moreOpen)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {moreOpen ? '▲ Fewer filters' : '▼ More filters'}
          </button>
          {moreOpen && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mt-3">
              <MultiSelect label="Direction" options={DIRECTION_OPTIONS} selected={filters.directions}
                onChange={v => setFilters(f => ({ ...f, directions: v }))} placeholder="Both" />
              <MultiSelect label="Session" options={SESSION_OPTIONS} selected={filters.sessions}
                onChange={v => setFilters(f => ({ ...f, sessions: v }))} placeholder="All sessions" />
            </div>
          )}
        </div>
      </div>

      {/* KPI strip -- Total Signals shows the deduplicated (unique) count with a
          reiterations subtitle (see REITERATION_TOOLTIP); Win Rate/Avg R/Cumulative R
          are already deduplicated client-side (computeAiSignalSummary() filters
          is_reiteration out internally); Max Drawdown is computed client-side from the
          same deduplicated trade series. */}
      <div className="flex items-start justify-between gap-4">
        <div className="grid grow grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Signals</p>
            <p className="text-2xl font-semibold tabular-nums">{!loading ? summary.uniqueSignals.toLocaleString() : '—'}</p>
            {!loading && summary.reiterations > 0 && (
              <Tooltip content={REITERATION_TOOLTIP}>
                <p className="text-xs text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40 inline-block">
                  + {summary.reiterations.toLocaleString()} reiterations
                </p>
              </Tooltip>
            )}
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Win Rate</p>
            <p className="text-2xl font-semibold tabular-nums">{!loading ? formatPercent(summary.winRate) : '—'}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avg R</p>
            <p className={`text-2xl font-semibold tabular-nums ${!loading ? positivityClass(summary.avgR) : ''}`}>
              {!loading ? formatR(summary.avgR) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cumulative R</p>
            <p className={`text-2xl font-semibold tabular-nums ${!loading ? positivityClass(cumulativeRTotal) : ''}`}>
              {!loading ? formatR(cumulativeRTotal) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Max Drawdown</p>
            <p className="text-2xl font-semibold tabular-nums text-red-700">{dedupTrades.length > 0 ? formatR(maxDD) : '—'}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payout Ratio</p>
              <Tooltip content="Average winning trade R divided by average losing trade R. A ratio above 1.0 means winners are larger than losers on average.">
                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground/60 text-[9px] cursor-default select-none leading-none">i</span>
              </Tooltip>
            </div>
            <p className="text-2xl font-semibold tabular-nums">
              {!loading && summary.payoutRatio != null ? summary.payoutRatio.toFixed(2) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Break-Even Win Rate</p>
              <Tooltip content="The minimum win rate needed to break even given the current payout ratio. Calculated as 1 ÷ (1 + Payout Ratio).">
                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground/60 text-[9px] cursor-default select-none leading-none">i</span>
              </Tooltip>
            </div>
            <p className="text-2xl font-semibold tabular-nums">
              {!loading && summary.breakEvenWinRate != null ? formatPercent(summary.breakEvenWinRate) : '—'}
            </p>
          </div>
        </div>
        <button onClick={() => setReportOpen(true)} disabled={loading || filteredTrades.length === 0}
          className="shrink-0 text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          Generate Report
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-border p-12 text-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="space-y-6">
          <CumulativePerformanceChart data={cumulative} />
          <DrawdownChart data={drawdown} />

          <RollingPerformanceTable rows={rolling} />
          <MonthlyPerformanceMatrix rows={monthly} />

          {/* By Confidence is this tab's headline table -- see buildConfidenceInsight. */}
          <SortableAttributionTable title="By Confidence" rows={confidenceRows} entityLabel="Signals"
            sort={confidenceSort} onSortChange={setConfidenceSort} />
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm">{confidenceInsight}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SortableAttributionTable title="By Asset Class" rows={assetClassRows} entityLabel="Signals"
              sort={assetClassSort} onSortChange={setAssetClassSort} />
            <SortableAttributionTable title="By Direction" rows={directionRows} entityLabel="Signals"
              sort={directionSort} onSortChange={setDirectionSort} />
          </div>
          <AttributionTable title="By Market" rows={displayedMarkets} minTrades={10} entityLabel="Markets" />
          {byMarket.length > MARKET_TABLE_LIMIT && (
            <button onClick={() => setShowAllMarkets(s => !s)}
              className="text-xs text-muted-foreground hover:text-foreground underline">
              {showAllMarkets ? 'Show top 20' : `Show all ${byMarket.length} markets`}
            </button>
          )}

          <ContributionChart title="Contribution by Confidence" rows={confidenceRows} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AttributionTable title={`Best Performing Symbols (min. ${MIN_TRADES_FOR_SYMBOL_RANKING} trades)`}
              rows={bestSymbols} entityLabel="Symbols" showMaxDD={false} />
            <AttributionTable title={`Worst Performing Symbols (min. ${MIN_TRADES_FOR_SYMBOL_RANKING} trades)`}
              rows={worstSymbols} entityLabel="Symbols" showMaxDD={false} />
          </div>
        </div>
      )}
    </div>

    {/* AiSignalsReportBuilder's own summary.totalSignals is written assuming
        lib/aiSignalAnalytics.ts's original "dedup count" meaning of that field -- the
        client-side summary above overrides totalSignals to mean ALL filtered signals
        including reiterations (summary.uniqueSignals is the dedup count instead), so
        that field has to be remapped back here before handing summary off, or the
        report would silently show an inflated "Total Signals" figure. */}
    {reportOpen && (
      <AiSignalsReportBuilder
        trades={analyticsTrades} summary={{ ...summary, totalSignals: summary.uniqueSignals }}
        confidenceRows={confidenceRows} assetClassRows={assetClassRows} directionRows={directionRows}
        byMarket={byMarket}
        onClose={() => setReportOpen(false)}
      />
    )}
    </>
  )
}
