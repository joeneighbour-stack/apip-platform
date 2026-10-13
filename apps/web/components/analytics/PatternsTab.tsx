'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import type { PatternSummary, PatternBreakdownRow, PatternTradePoint } from '@/lib/patternAnalytics'
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

type DateRangeKey = '30D' | '90D' | '12M' | 'ALL'
const DATE_RANGES: { key: DateRangeKey; label: string; days: number | null }[] = [
  { key: '30D', label: 'Last 30 days', days: 30 },
  { key: '90D', label: 'Last 90 days', days: 90 },
  { key: '12M', label: 'Last 12 months', days: 365 },
  { key: 'ALL', label: 'All time', days: null },
]

const GRANULARITY_OPTIONS = ['ALL', '1h', '4h', '1d']
const DIRECTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'BUY', label: 'Buy' },
  { value: 'SELL', label: 'Sell' },
]
const ASSET_CLASS_OPTIONS = ['ALL', 'FX', 'Equity', 'Commodity', 'Crypto', 'Index']

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
  const [dateRange, setDateRange] = useState<DateRangeKey>('ALL')
  const [granularity, setGranularity] = useState('ALL')
  const [direction, setDirection] = useState('ALL')
  const [assetClass, setAssetClass] = useState('ALL')

  const [summary, setSummary] = useState<PatternSummary | null>(null)
  const [trades, setTrades] = useState<PatternTradePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [familySort, setFamilySort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })
  const [granularitySort, setGranularitySort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })
  const [assetClassSort, setAssetClassSort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  useEffect(() => {
    const params = new URLSearchParams()
    const preset = DATE_RANGES.find(r => r.key === dateRange)!
    if (preset.days !== null) {
      const from = new Date(Date.now() - preset.days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      params.set('from', from)
      params.set('to', today)
    }
    if (granularity !== 'ALL') params.set('granularity', granularity)
    if (direction !== 'ALL') params.set('direction', direction)
    if (assetClass !== 'ALL') params.set('assetClass', assetClass)

    setLoading(true)
    setError(null)
    fetch(`/api/analytics/patterns?${params.toString()}`)
      .then(r => r.json())
      .then((data: PatternsApiResponse | { error: string }) => {
        if ('error' in data) { setError(data.error); return }
        const { trades: tradePoints, ...rest } = data
        setSummary(rest)
        setTrades(tradePoints)
      })
      .catch(() => setError('Failed to load pattern trade data.'))
      .finally(() => setLoading(false))
  }, [dateRange, granularity, direction, assetClass, today])

  const analyticsTrades = useMemo(() => trades.map(toAnalyticsTrade) as unknown as MetricsTrade[], [trades])
  const cumulative = useMemo(() => cumulativeSeries(analyticsTrades), [analyticsTrades])
  const drawdown = useMemo(() => drawdownSeries(analyticsTrades), [analyticsTrades])
  const monthly = useMemo(() => monthlyMatrix(analyticsTrades), [analyticsTrades])
  const rolling = useMemo(() => rollingTradeWindows(analyticsTrades), [analyticsTrades])
  const maxDD = useMemo(() => maxDrawdown(analyticsTrades).value, [analyticsTrades])

  const familyRows = useMemo(() => summary ? summary.byFamily.map(toAttributionRow) : [], [summary])
  const granularityRows = useMemo(() => summary ? summary.byGranularity.map(toAttributionRow) : [], [summary])
  const assetClassRows = useMemo(() => summary ? summary.byAssetClass.map(toAttributionRow) : [], [summary])
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
      {/* KPI strip -- Total Patterns/Win Rate/Avg R are the server-computed, status-based
          PatternSummary figures (see lib/patternAnalytics.ts); Max Drawdown is computed
          client-side from the trade series via lib/metrics.ts, since PatternSummary has
          no drawdown concept. Trigger Rate is intentionally omitted: pattern trades are
          only published once already triggered, so it's always ~100% and carries no
          signal. PerformanceKpiStrip isn't reused here -- its METRIC_DEFS hardcodes a
          fixed 6-metric set (Triggered Trades/Profit Factor instead of Total Patterns)
          that doesn't match this tab's metrics. */}
      <div className="flex items-start justify-between gap-4">
        <div className="grid grow grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Patterns</p>
            <p className="text-2xl font-semibold tabular-nums">{summary ? summary.totalPatterns : '—'}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Win Rate</p>
            <p className="text-2xl font-semibold tabular-nums">{summary ? formatPercent(summary.winRate) : '—'}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avg R</p>
            <p className={`text-2xl font-semibold tabular-nums ${summary ? positivityClass(summary.avgR) : ''}`}>
              {summary ? formatR(summary.avgR) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Max Drawdown</p>
            <p className="text-2xl font-semibold tabular-nums text-red-700">{trades.length > 0 ? formatR(maxDD) : '—'}</p>
          </div>
        </div>
        <button onClick={() => setReportOpen(true)} disabled={!summary || trades.length === 0}
          className="shrink-0 text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          Generate Report
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {DATE_RANGES.map(r => (
            <button key={r.key}
              onClick={() => setDateRange(r.key)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                dateRange === r.key
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}>
              {r.label}
            </button>
          ))}
        </div>
        <select value={granularity} onChange={e => setGranularity(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
          {GRANULARITY_OPTIONS.map(g => (
            <option key={g} value={g}>{g === 'ALL' ? 'All granularities' : g}</option>
          ))}
        </select>
        <select value={direction} onChange={e => setDirection(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
          {DIRECTION_OPTIONS.map(d => (
            <option key={d.value} value={d.value}>{d.value === 'ALL' ? 'All directions' : d.label}</option>
          ))}
        </select>
        <select value={assetClass} onChange={e => setAssetClass(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
          {ASSET_CLASS_OPTIONS.map(a => (
            <option key={a} value={a}>{a === 'ALL' ? 'All asset classes' : a}</option>
          ))}
        </select>
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
      ) : summary && (
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

    {reportOpen && summary && (
      <PatternReportBuilder
        trades={analyticsTrades} summary={summary}
        familyRows={familyRows} granularityRows={granularityRows} assetClassRows={assetClassRows}
        onClose={() => setReportOpen(false)}
      />
    )}
    </>
  )
}
