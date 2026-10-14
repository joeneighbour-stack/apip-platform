'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { computePatternSummary, FAMILY_LABELS, type PatternSummary, type PatternBreakdownRow, type PatternTradePoint } from '@/lib/patternAnalytics'
import { Tooltip } from '@/components/ui/Tooltip'
import { MultiSelect } from '@/components/ui/MultiSelect'
import {
  type PatternFilterState, DEFAULT_PATTERN_FILTERS, hasActivePatternFilters,
} from '@/lib/analyticsFilters'
import { DATE_PRESET_OPTIONS, resolveDateRange } from '@/lib/dateRanges'
import {
  triggeredTrades, totalR, winRate, avgR, maxDrawdown, cumulativeSeries, drawdownSeries, monthlyMatrix,
  attributionBy, rankAttribution, type MetricsTrade, type RollingRow, type AttributionRow,
} from '@/lib/metrics'
import { formatR, formatPercent, positivityClass } from '@/lib/format'
import { CumulativePerformanceChart, DrawdownChart, ContributionChart } from './LazyCharts'
import { RollingPerformanceTable } from './RollingPerformanceTable'
import { MonthlyPerformanceMatrix } from './MonthlyPerformanceMatrix'
import { AttributionTable } from './AttributionTable'

// Pattern reports use their own component (PatternReportBuilder), not the shared
// analyst ReportBuilder -- see that file's own header comment for why. Dynamic-imported
// for the same reason as AnalyticsPage.tsx's own ReportBuilder: keeps recharts out of
// the initial bundle until the user actually clicks "Generate Report".
const PatternReportBuilder = dynamic(() => import('./PatternReportBuilder').then(m => ({ default: m.PatternReportBuilder })), {
  ssr: false,
})

type PatternsApiResponse = PatternSummary & { trades: PatternTradePoint[] }

// ContributionChart's YAxis category width is a fixed 90px with no prop to widen it, so
// long family names (e.g. "Sym. Triangle (Bull Reversal)") get clipped -- truncate
// before handing rows to the chart. Only applied to the chart's own copy of the rows;
// AttributionTable gets the untruncated labels since its label column already
// text-truncates with real column width to spare.
const MAX_CONTRIBUTION_LABEL_LENGTH = 20
function truncateLabel(label: string): string {
  return label.length > MAX_CONTRIBUTION_LABEL_LENGTH ? `${label.slice(0, MAX_CONTRIBUTION_LABEL_LENGTH - 1)}…` : label
}

// Same literal option sets as AnalyticsFilters.tsx's own (unexported) constants --
// duplicated rather than shared, matching this codebase's existing convention of
// self-contained sibling tab components (see e.g. aiSignalAnalytics.ts/
// patternAnalytics.ts's own header comments on why they mirror each other file-for-file
// instead of sharing a module).
const DIRECTION_OPTIONS = [{ value: 'BUY', label: 'BUY' }, { value: 'SELL', label: 'SELL' }]
const SESSION_OPTIONS = [
  { value: 'EUROPEAN', label: 'European' }, { value: 'US', label: 'US' },
  { value: 'APAC', label: 'APAC' }, { value: 'CRYPTO', label: 'Crypto' },
]

// Same minimum sample used elsewhere in the app for market/entity ranking
// (lib/metrics.ts's MIN_TRADES_FOR_MARKET_RANKING) -- a single lucky/unlucky pattern
// family can't dominate a "best/worst" list.
const MIN_TRADES_FOR_FAMILY_RANKING = 20

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Pattern trades use `rr` directly as the result (not result_r) and "triggered" is a
// boolean column (not a separate status value) -- this adapts a pattern trade into the
// minimal shape lib/metrics.ts's series/window functions actually read at runtime
// (result_r, triggered, published_at, symbol, asset_class). It is deliberately NOT a
// full MetricsTrade (no analyst_id/market_id/direction/session/source_system -- those
// don't exist for pattern trades and none of the functions used below touch them).
function toAnalyticsTrade(t: PatternTradePoint) {
  return {
    result_r: t.triggered && t.rr !== null ? t.rr : null,
    triggered: t.triggered === true,
    published_at: t.published_at,
    symbol: t.symbol ?? '',
    asset_class: t.asset_class ?? '',
  }
}

// lib/metrics.ts's own rollingWindows() is a fixed DATE-window table (30D/90D/6M/1Y/
// Since Inception) -- there's no existing trade-COUNT rolling window function, which is
// what this tab needs (20/50/100 trade windows). Reuses the same metrics.ts primitives
// (totalR/avgR/winRate/maxDrawdown) over count-based slices instead of date-based ones.
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

// Maps the server-computed PatternBreakdownRow (status-based win %, trigger % --
// lib/patternAnalytics.ts's own formulas, kept as-is for these tables) onto
// AttributionTable's AttributionRow shape so the existing breakdown data can render
// through the same component used on the Performance tab. Note `trades` here is
// PatternBreakdownRow's `count` -- ALL patterns in the group regardless of trigger
// status -- not a triggered-only count the way AttributionRow normally carries it
// elsewhere (via attributionBy()); AttributionTable's "fewer than N triggered trades
// excluded" footnote text is slightly imprecise here as a result, but count is the only
// per-group sample size this data has.
function toAttributionRow(row: PatternBreakdownRow): AttributionRow {
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

// Best/worst families are ranked by Total R (lib/metrics.ts's rankAttribution(), the
// same ranking used for markets elsewhere in the app) -- a high-volume, modest-per-trade
// family is a genuine "best" contributor by total R even if a low-volume family has a
// flashier average R. Ranking by average R instead (an earlier version of this file did)
// put low-R, high-volume families like Flag in the "worst" list purely because their
// average R is unremarkable, despite being the single biggest total contributor.

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

// AttributionTable (used elsewhere in the app) has no sort support, so this is a
// click-to-sort replacement for the By Pattern Family/Granularity/Asset Class tables.
// Column set/widths match AttributionTable's own showMaxDD={false} layout for visual
// consistency, minus Max DD -- the task's column list for this table is exactly
// Trades/Win %/Total R/Avg R/Profit Factor, so Max DD isn't part of this table at all
// (it's still shown on the By Market and Best/Worst tables, which keep using the plain
// AttributionTable).
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

export function PatternsTab() {
  const [filters, setFilters] = useState<PatternFilterState>(DEFAULT_PATTERN_FILTERS)
  const [moreOpen, setMoreOpen] = useState(false)

  const [allTrades, setAllTrades] = useState<PatternTradePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [familySort, setFamilySort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })
  const [granularitySort, setGranularitySort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })
  const [assetClassSort, setAssetClassSort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })

  // Fetched once, unfiltered -- every filter below runs client-side against this set,
  // matching AnalyticsPage.tsx's (the Analyst Signals tab's) own fetch-once/filter-
  // client-side approach instead of the old per-filter-change API call.
  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/analytics/patterns')
      .then(r => r.json())
      .then((data: PatternsApiResponse | { error: string }) => {
        if ('error' in data) { setError(data.error); return }
        setAllTrades(data.trades)
      })
      .catch(() => setError('Failed to load pattern trade data.'))
      .finally(() => setLoading(false))
  }, [])

  const dateRange = useMemo(
    () => resolveDateRange(filters.datePreset, filters.customStart ?? undefined, filters.customEnd ?? undefined),
    [filters.datePreset, filters.customStart, filters.customEnd]
  )

  // Filter option lists are derived from the fetched data itself -- pattern_trades has
  // no separate reference table the way markets/analysts do for the Analyst tab, so
  // "what pattern types/asset classes/markets exist" is just whatever's actually present
  // in this fetch. Family is the raw code (e.g. "FLAG") -- labelled via FAMILY_LABELS,
  // same mapping the By Pattern Family table already uses.
  const patternTypeOptions = useMemo(() => {
    const codes = [...new Set(allTrades.map(t => t.family).filter((f): f is string => !!f))].sort()
    return codes.map(code => ({ value: code, label: FAMILY_LABELS[code] ?? code }))
  }, [allTrades])

  const assetClassOptions = useMemo(() => {
    const classes = [...new Set(allTrades.map(t => t.asset_class).filter((c): c is string => !!c))].sort()
    return classes.map(c => ({ value: c, label: c }))
  }, [allTrades])

  // Market options are symbols, not market_ids -- pattern_trades carries no market_id at
  // all (see PatternTradeRow), only a symbol string, so filters.marketIds holds symbols
  // here. Narrowed by selected asset classes, same as AnalyticsFilters.tsx's own
  // filteredMarkets.
  const marketOptions = useMemo(() => {
    const assetClassBySymbol = new Map<string, string>()
    for (const t of allTrades) {
      if (t.symbol && !assetClassBySymbol.has(t.symbol)) assetClassBySymbol.set(t.symbol, t.asset_class ?? '')
    }
    const symbols = filters.assetClasses.length === 0
      ? [...assetClassBySymbol.keys()]
      : [...assetClassBySymbol.entries()].filter(([, ac]) => filters.assetClasses.includes(ac)).map(([sym]) => sym)
    return symbols.sort().map(sym => ({ value: sym, label: sym }))
  }, [allTrades, filters.assetClasses])

  // pattern_trades has no `session` column at all (migrations/065_pattern_trades.sql --
  // patterns are algorithm-generated, not tied to a human trading session the way
  // actual_trades is). filters.sessions is intentionally never read below: there's no
  // field on PatternTradePoint to filter against, so wiring it up would either silently
  // zero out every row the moment a session is selected, or require fabricating session
  // data that doesn't exist. The control is still shown for visual/UX parity with the
  // Analyst tab's filter bar, but it has no effect on this tab's results.
  const filteredTrades = useMemo(() => {
    return allTrades.filter(t => {
      const d = t.published_at.slice(0, 10)
      if (d < dateRange.start || d > dateRange.end) return false
      if (filters.patternTypes.length > 0 && (!t.family || !filters.patternTypes.includes(t.family))) return false
      if (filters.assetClasses.length > 0 && (!t.asset_class || !filters.assetClasses.includes(t.asset_class))) return false
      if (filters.marketIds.length > 0 && (!t.symbol || !filters.marketIds.includes(t.symbol))) return false
      if (filters.directions.length > 0 && (!t.direction || !filters.directions.includes(t.direction))) return false
      return true
    })
  }, [allTrades, filters, dateRange])

  const summary = useMemo(() => computePatternSummary(filteredTrades), [filteredTrades])

  const analyticsTrades = useMemo(() => filteredTrades.map(toAnalyticsTrade) as unknown as MetricsTrade[], [filteredTrades])
  const cumulative = useMemo(() => cumulativeSeries(analyticsTrades), [analyticsTrades])
  const drawdown = useMemo(() => drawdownSeries(analyticsTrades), [analyticsTrades])
  const monthly = useMemo(() => monthlyMatrix(analyticsTrades), [analyticsTrades])
  const rolling = useMemo(() => rollingTradeWindows(analyticsTrades), [analyticsTrades])
  const maxDD = useMemo(() => maxDrawdown(analyticsTrades).value, [analyticsTrades])

  const familyRows = useMemo(() => summary.byFamily.map(toAttributionRow), [summary])
  const granularityRows = useMemo(() => summary.byGranularity.map(toAttributionRow), [summary])
  const assetClassRows = useMemo(() => summary.byAssetClass.map(toAttributionRow), [summary])
  const bestFamilies = useMemo(() => rankAttribution(familyRows, MIN_TRADES_FOR_FAMILY_RANKING, 'best', 5), [familyRows])
  const worstFamilies = useMemo(() => rankAttribution(familyRows, MIN_TRADES_FOR_FAMILY_RANKING, 'worst', 5), [familyRows])
  const familyContributionRows = useMemo(() => familyRows.map(r => ({ ...r, label: truncateLabel(r.label) })), [familyRows])

  // By-symbol breakdown, computed directly from the trade series (unlike the Family/
  // Granularity/Asset Class tables above, there's no server-computed PatternBreakdownRow
  // equivalent keyed by symbol) -- same attributionBy() + AttributionTable minTrades
  // pattern already used for AnalyticsPage.tsx's own "By Market" table.
  const byMarket = useMemo(
    () => attributionBy(analyticsTrades, t => ({ key: t.symbol, label: t.symbol })),
    [analyticsTrades]
  )

  return (
    <>
    {/* print:hidden is scoped to the dashboard chrome only, matching AnalyticsPage.tsx's
        own root return -- PatternReportBuilder (and the print layout it mounts) renders
        as a sibling below, outside this div, since a display:none ancestor can't be
        overridden by a descendant's print:static rule. */}
    <div className="space-y-6 print:hidden">
      {/* Filter bar -- styled to match AnalyticsFilters.tsx (the Analyst Signals tab's
          own filter card) for visual consistency across tabs. */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">Filters</p>
          {hasActivePatternFilters(filters) && (
            <button onClick={() => setFilters(DEFAULT_PATTERN_FILTERS)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MultiSelect label="Pattern Type" options={patternTypeOptions} selected={filters.patternTypes}
            onChange={v => setFilters(f => ({ ...f, patternTypes: v }))} placeholder="All patterns" />
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

      {/* KPI strip -- Total Patterns/Win Rate/Avg R/Cumulative R are computed client-side
          (via computePatternSummary) from the filtered trade set, same formulas
          lib/patternAnalytics.ts always used server-side; Max Drawdown is computed
          client-side from the trade series via lib/metrics.ts, since PatternSummary has
          no drawdown concept. Trigger Rate is intentionally omitted: pattern trades are
          only published once already triggered, so it's always ~100% and carries no
          signal. PerformanceKpiStrip isn't reused here -- its METRIC_DEFS hardcodes a
          fixed 6-metric set (Triggered Trades/Profit Factor instead of Total Patterns)
          that doesn't match this tab's metrics. */}
      <div className="flex items-start justify-between gap-4">
        <div className="grid grow grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Patterns</p>
            <p className="text-2xl font-semibold tabular-nums">{!loading ? summary.totalPatterns : '—'}</p>
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
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Max Drawdown</p>
            <p className="text-2xl font-semibold tabular-nums text-red-700">{filteredTrades.length > 0 ? formatR(maxDD) : '—'}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cumulative R</p>
            <p className={`text-2xl font-semibold tabular-nums ${!loading ? positivityClass(summary.totalR) : ''}`}>
              {!loading ? formatR(summary.totalR) : '—'}
            </p>
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
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">BE Win Rate</p>
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

          <SortableAttributionTable title="By Pattern Family" rows={familyRows} entityLabel="Patterns"
            sort={familySort} onSortChange={setFamilySort} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SortableAttributionTable title="By Granularity" rows={granularityRows} entityLabel="Patterns"
              sort={granularitySort} onSortChange={setGranularitySort} />
            <SortableAttributionTable title="By Asset Class" rows={assetClassRows} entityLabel="Patterns"
              sort={assetClassSort} onSortChange={setAssetClassSort} />
          </div>
          <AttributionTable title="By Market" rows={byMarket} minTrades={10} entityLabel="Markets" />

          <ContributionChart title="Contribution by Pattern Family" rows={familyContributionRows} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AttributionTable title={`Best Performing Families (min. ${MIN_TRADES_FOR_FAMILY_RANKING} trades)`}
              rows={bestFamilies} entityLabel="Families" showMaxDD={false} />
            <AttributionTable title={`Worst Performing Families (min. ${MIN_TRADES_FOR_FAMILY_RANKING} trades)`}
              rows={worstFamilies} entityLabel="Families" showMaxDD={false} />
          </div>
        </div>
      )}
    </div>

    {reportOpen && (
      <PatternReportBuilder
        trades={analyticsTrades} summary={summary}
        familyRows={familyRows} granularityRows={granularityRows} assetClassRows={assetClassRows}
        onClose={() => setReportOpen(false)}
      />
    )}
    </>
  )
}
