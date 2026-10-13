'use client'
import { useEffect, useMemo, useState } from 'react'
import type { AiSignalSummary, AiBreakdownRow, AiTradePoint } from '@/lib/aiSignalAnalytics'
import {
  triggeredTrades, totalR, winRate, avgR, maxDrawdown, cumulativeSeries, drawdownSeries, monthlyMatrix,
  attributionBy, rankAttribution, type MetricsTrade, type RollingRow, type AttributionRow,
} from '@/lib/metrics'
import { formatR, formatPercent, positivityClass } from '@/lib/format'
import { CumulativePerformanceChart, DrawdownChart, ContributionChart } from './LazyCharts'
import { RollingPerformanceTable } from './RollingPerformanceTable'
import { MonthlyPerformanceMatrix } from './MonthlyPerformanceMatrix'
import { AttributionTable } from './AttributionTable'

// Same structure as PatternsTab.tsx, adapted for ai_trades (migrations/066_ai_trades.sql):
// confidence replaces family/granularity (AI signals have no pattern family or chart
// timeframe concept), and there's no PDF report builder equivalent here -- not asked
// for, and this tab's own headline finding (confidence doesn't predict outcome) is
// already front-and-centre in the dashboard itself.

type AiSignalsApiResponse = AiSignalSummary & { trades: AiTradePoint[] }

type DateRangeKey = '30D' | '90D' | '12M' | 'ALL'
const DATE_RANGES: { key: DateRangeKey; label: string; days: number | null }[] = [
  { key: '30D', label: 'Last 30 days', days: 30 },
  { key: '90D', label: 'Last 90 days', days: 90 },
  { key: '12M', label: 'Last 12 months', days: 365 },
  { key: 'ALL', label: 'All time', days: null },
]

const DIRECTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'BUY', label: 'Buy' },
  { value: 'SELL', label: 'Sell' },
]
const ASSET_CLASS_OPTIONS = ['ALL', 'FX', 'Equity', 'Commodity', 'Crypto', 'Index']

// Same minimum sample used elsewhere in the app for market/entity ranking
// (lib/metrics.ts's MIN_TRADES_FOR_MARKET_RANKING).
const MIN_TRADES_FOR_SYMBOL_RANKING = 10

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// AI trades use `rr` directly as the result (not result_r) and "triggered" is a boolean
// column -- same adaptation as PatternsTab.tsx's toAnalyticsTrade, extended with
// asset_name (not part of MetricsTrade at all) purely so the By Market table below can
// label rows with a human-readable name instead of a bare ticker; none of lib/metrics.ts's
// functions read it.
function toAnalyticsTrade(t: AiTradePoint) {
  return {
    result_r: t.triggered && t.rr !== null ? t.rr : null,
    triggered: t.triggered === true,
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
  const [dateRange, setDateRange] = useState<DateRangeKey>('ALL')
  const [direction, setDirection] = useState('ALL')
  const [assetClass, setAssetClass] = useState('ALL')

  const [summary, setSummary] = useState<AiSignalSummary | null>(null)
  const [trades, setTrades] = useState<AiTradePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confidenceSort, setConfidenceSort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })
  const [assetClassSort, setAssetClassSort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })
  const [directionSort, setDirectionSort] = useState<AttributionSort>({ col: 'totalR', dir: 'desc' })

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  useEffect(() => {
    const params = new URLSearchParams()
    const preset = DATE_RANGES.find(r => r.key === dateRange)!
    if (preset.days !== null) {
      const from = new Date(Date.now() - preset.days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      params.set('from', from)
      params.set('to', today)
    }
    if (direction !== 'ALL') params.set('direction', direction)
    if (assetClass !== 'ALL') params.set('assetClass', assetClass)

    setLoading(true)
    setError(null)
    fetch(`/api/analytics/ai-signals?${params.toString()}`)
      .then(r => r.json())
      .then((data: AiSignalsApiResponse | { error: string }) => {
        if ('error' in data) { setError(data.error); return }
        const { trades: tradePoints, ...rest } = data
        setSummary(rest)
        setTrades(tradePoints)
      })
      .catch(() => setError('Failed to load AI signal data.'))
      .finally(() => setLoading(false))
  }, [dateRange, direction, assetClass, today])

  const analyticsTrades = useMemo(() => trades.map(toAnalyticsTrade) as unknown as MetricsTrade[], [trades])
  const cumulative = useMemo(() => cumulativeSeries(analyticsTrades), [analyticsTrades])
  const drawdown = useMemo(() => drawdownSeries(analyticsTrades), [analyticsTrades])
  const monthly = useMemo(() => monthlyMatrix(analyticsTrades), [analyticsTrades])
  const rolling = useMemo(() => rollingTradeWindows(analyticsTrades), [analyticsTrades])

  const confidenceRows = useMemo(() => summary ? summary.byConfidence.map(toAttributionRow) : [], [summary])
  const assetClassRows = useMemo(() => summary ? summary.byAssetClass.map(toAttributionRow) : [], [summary])
  const directionRows = useMemo(() => summary ? summary.byDirection.map(toAttributionRow) : [], [summary])
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

  return (
    <div className="space-y-6 print:hidden">
      {/* KPI strip -- exactly the 4 summary fields lib/aiSignalAnalytics.ts computes
          (total, win rate, avg R, cumulative R). No Max Drawdown tile here (unlike
          PatternsTab) since it isn't part of AiSignalSummary -- still computed below
          for the drawdown chart, just not surfaced as a headline KPI. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Signals</p>
          <p className="text-2xl font-semibold tabular-nums">{summary ? summary.totalSignals : '—'}</p>
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
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cumulative R</p>
          <p className={`text-2xl font-semibold tabular-nums ${summary ? positivityClass(summary.cumulativeR) : ''}`}>
            {summary ? formatR(summary.cumulativeR) : '—'}
          </p>
        </div>
      </div>

      {/* Filters -- no granularity filter: AI signals have no chart-timeframe concept. */}
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
          <AttributionTable title="By Market" rows={byMarket} minTrades={10} entityLabel="Markets" />

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
  )
}
