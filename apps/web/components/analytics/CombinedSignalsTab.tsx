'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  type SignalTypeData, type SignalTypeSummary, type CombinedAssetClassRow, type DayOfWeekRow, type MonthOfYearRow,
  type CombinedYearRow, type CombinedMarketRow,
  TYPE_LABELS, TYPE_ORDER, buildKeyCallouts, monthYear,
} from '@/lib/combinedSignalAnalytics'
import { formatR, formatPercent, formatDate, positivityClass } from '@/lib/format'
import { PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import { CombinedCumulativeChart, SignalsByPeriodChart } from './LazyCharts'
import { Tooltip } from '@/components/ui/Tooltip'

// Combined Signals reports use their own component (CombinedSignalsReportBuilder), not
// PatternReportBuilder/AiSignalsReportBuilder -- see that file's own header comment.
// Dynamic-imported for the same reason as the other tabs' own report builder imports:
// keeps recharts out of the initial bundle until the user clicks "Generate Report".
const CombinedSignalsReportBuilder = dynamic(
  () => import('./CombinedSignalsReportBuilder').then(m => ({ default: m.CombinedSignalsReportBuilder })),
  { ssr: false },
)

interface CombinedApiResponse {
  analyst: SignalTypeData
  patterns: SignalTypeData
  ai: SignalTypeData
  // AI-only -- analyst/patterns have no reiteration concept (see /api/analytics/combined's
  // own comment). The `ai` row's own totalSignals/winRate/avgR/totalR are already
  // deduplicated (is_reiteration = false), same figures the AI Signals tab itself shows.
  aiReiterations: number
  byAssetClass: CombinedAssetClassRow[]
  byDayOfWeek: DayOfWeekRow[]
  byMonth: MonthOfYearRow[]
  byYear: CombinedYearRow[]
  topMarkets: CombinedMarketRow[]
  combined: {
    summary: SignalTypeSummary
    cumulativeR: { date: string; analyst: number | null; patterns: number | null; ai: number | null }[]
    normalisedCumulative: { date: string; analyst: number | null; patterns: number | null; ai: number | null }[]
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Computed, not hardcoded to 2026 -- this code will still be running in 2027+, and a
// literal year check would silently mislabel every future "current year" row as a plain
// completed year instead of "YTD".
const CURRENT_YEAR = new Date().getUTCFullYear()

function dateRangeLabel(first: string | null, last: string | null): string {
  if (!first || !last) return 'No signals yet'
  return `${formatDate(first)} – ${formatDate(last)}`
}

// Headline is totalPublished (every row actually published, including AI reiterations)
// rather than totalSignals (the deduplicated, performance-relevant count used in the
// comparison table below) -- this strip is about signal OUTPUT, not performance.
//
// No triggered subtitle on any tile, including Analyst Signals: `triggered` on
// actual_trades looked like a real ~35% "did price enter the zone" rate overall, but
// broken down by source it's set to true on 100% of MANUAL_BACKFILL rows (91% of the
// table) -- an import-time default, not a real outcome -- and only genuinely selective
// (~29%) on the live ACUITY_PERFORMANCE_API feed. The table-wide figure (93.7% true) is
// therefore an import-methodology artifact, not a meaningful trigger rate, so it's
// omitted here the same way it already is for Pattern/AI Signals (which have no
// untriggered state to distinguish at all).
function SummaryTile({ label, data }: { label: string; data: SignalTypeData }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{data.summary.totalPublished.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{dateRangeLabel(data.summary.firstSignalDate, data.summary.lastSignalDate)}</p>
    </div>
  )
}

// Fixed, literal Tailwind class strings (never interpolated) so the production build's
// content scanner can actually see them -- a dynamically-built class name like
// `bg-green-500/${n}` would be invisible to Tailwind's purge step and silently render
// unstyled. Hue stays constant (green-500/red-500); only opacity steps by magnitude,
// same shading idea as MonthlyPerformanceMatrix.tsx's own rgba-based heat map.
const POSITIVE_TIERS = ['bg-green-500/10', 'bg-green-500/20', 'bg-green-500/30', 'bg-green-500/45', 'bg-green-500/60']
const NEGATIVE_TIERS = ['bg-red-500/10', 'bg-red-500/20', 'bg-red-500/30', 'bg-red-500/45', 'bg-red-500/60']

function yearCellClass(value: number | null, maxAbs: number): string {
  if (value === null || value === 0) return ''
  const tiers = value > 0 ? POSITIVE_TIERS : NEGATIVE_TIERS
  const ratio = maxAbs > 0 ? Math.min(Math.abs(value) / maxAbs, 1) : 0
  const idx = Math.min(tiers.length - 1, Math.floor(ratio * tiers.length))
  return tiers[idx]!
}

const PAYOUT_RATIO_TOOLTIP = 'Average winning trade R divided by average losing trade R. A ratio above 1.0 means winners are larger than losers on average.'
const BREAK_EVEN_WIN_RATE_TOOLTIP = 'The minimum win rate needed to break even given the current payout ratio. Calculated as 1 ÷ (1 + Payout Ratio).'

const COMPARISON_HEADERS: { label: string; tooltip?: string }[] = [
  { label: 'Signal Type' },
  { label: 'Total Signals' },
  { label: 'Win Rate' },
  { label: 'Avg R' },
  { label: 'Total R' },
  { label: 'Max DD (R)' },
  { label: 'Payout Ratio', tooltip: PAYOUT_RATIO_TOOLTIP },
  { label: 'Break-Even Win Rate', tooltip: BREAK_EVEN_WIN_RATE_TOOLTIP },
  { label: 'Since' },
]

function PeriodTable({ rows, firstColumnLabel }: {
  rows: { key: string; trades: number; winRate: number | null; avgR: number | null }[]
  firstColumnLabel: string
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {[firstColumnLabel, 'Trades', 'Win Rate', 'Avg R'].map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(row => (
            <tr key={row.key} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-2.5 font-medium whitespace-nowrap">{row.key}</td>
              <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.trades.toLocaleString()}</td>
              <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatPercent(row.winRate)}</td>
              <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${positivityClass(row.avgR)}`}>{formatR(row.avgR)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CombinedSignalsTab() {
  const [data, setData] = useState<CombinedApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/analytics/combined')
      .then(r => r.json())
      .then((json: CombinedApiResponse | { error: string }) => {
        if ('error' in json) { setError(json.error); return }
        setData(json)
      })
      .catch(() => setError('Failed to load combined signal data.'))
      .finally(() => setLoading(false))
  }, [])

  const callouts = useMemo(() => data ? buildKeyCallouts({ analyst: data.analyst, patterns: data.patterns, ai: data.ai }) : [], [data])

  // Computed live from each type's own firstSignalDate rather than hardcoded -- the
  // task's own example wording ("Analyst Signals: Jan 2017, ...") happens to match
  // today's real data, but asserting fixed dates here would silently go stale (or wrong)
  // the moment the underlying history changes.
  const indexCaption = useMemo(() => {
    if (!data) return ''
    const parts = TYPE_ORDER.map(key => {
      const first = data[key].summary.firstSignalDate
      return `${TYPE_LABELS[key]}: ${first ? monthYear(first) : 'no data yet'}`
    })
    return `All series rebased to 100 at start. A value of 150 = +50% relative growth from inception. ${parts.join(', ')}.`
  }, [data])

  const maxAbsYearR = useMemo(() => {
    if (!data) return 0
    const values = data.byYear.flatMap(row => [row.analyst, row.pattern, row.ai]).filter((v): v is number => v !== null).map(Math.abs)
    return values.length > 0 ? Math.max(...values) : 0
  }, [data])

  return (
    <>
    {/* print:hidden is scoped to the dashboard chrome only, matching PatternsTab.tsx/
        AiSignalsTab.tsx's own root return -- CombinedSignalsReportBuilder (and the print
        layout it mounts) renders as a sibling below, outside this div. */}
    <div className="space-y-6 print:hidden">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-border p-12 text-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : data && (
        <div className="space-y-6">
          {/* Signal output strip */}
          <div className="flex items-start justify-between gap-4">
            <div className="grid grow grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <SummaryTile label="Analyst Signals" data={data.analyst} />
              <SummaryTile label="Pattern Signals" data={data.patterns} />
              <SummaryTile label="AI Signals" data={data.ai} />
              <div className="rounded-lg border border-border bg-card p-4 space-y-1">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payout Ratio</p>
                  <Tooltip content="Average winning trade R divided by average losing trade R. A ratio above 1.0 means winners are larger than losers on average.">
                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground/60 text-[9px] cursor-default select-none leading-none">i</span>
                  </Tooltip>
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {data.combined.summary.payoutRatio != null ? data.combined.summary.payoutRatio.toFixed(2) : '—'}
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
                  {data.combined.summary.breakEvenWinRate != null ? formatPercent(data.combined.summary.breakEvenWinRate) : '—'}
                </p>
              </div>
            </div>
            <button onClick={() => setReportOpen(true)}
              className="shrink-0 text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              Generate Report
            </button>
          </div>

          {/* Performance comparison table. Total Signals here is totalPublished (so the
              three rows are comparable signal-output figures) -- Win Rate/Avg R/Total R/
              Max DD still reflect each type's own canonical performance population
              (deduplicated for AI), so the AI row's own "Total Signals" number won't
              match the sample size behind its other columns. That's the deliberate
              tradeoff: a comparable headline count across rows, at the cost of one row's
              internal consistency. */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Performance Comparison</p>
            <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {COMPARISON_HEADERS.map(h => (
                      <th key={h.label} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                        {h.tooltip ? (
                          <div className="flex items-center gap-1">
                            <span>{h.label}</span>
                            <Tooltip content={h.tooltip}>
                              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground/60 text-[9px] cursor-default select-none leading-none">i</span>
                            </Tooltip>
                          </div>
                        ) : h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {TYPE_ORDER.map(key => {
                    const d = data[key]
                    return (
                      <tr key={key} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap">{TYPE_LABELS[key]}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">
                          {d.summary.totalPublished.toLocaleString()}
                          {key === 'ai' && data.aiReiterations > 0 && (
                            <span className="text-[11px] text-muted-foreground/70"> (of which {data.aiReiterations.toLocaleString()} reiterations)</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatPercent(d.summary.winRate)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{formatR(d.summary.avgR)}</td>
                        <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${positivityClass(d.summary.totalR)}`}>{formatR(d.summary.totalR)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-red-700 whitespace-nowrap">{formatR(d.summary.maxDrawdownR)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">
                          {d.summary.payoutRatio != null ? d.summary.payoutRatio.toFixed(2) : '—'}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">
                          {d.summary.breakEvenWinRate != null ? `${(d.summary.breakEvenWinRate * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{d.summary.firstSignalDate ? formatDate(d.summary.firstSignalDate) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Normalised equity curves -- replaces the old raw-R 3-line chart */}
          <CombinedCumulativeChart data={data.combined.normalisedCumulative} caption={indexCaption} />

          {/* By Asset Class */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">By Asset Class</p>
            <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {['Asset Class', 'Analyst R', 'Pattern R', 'AI R', 'Combined Total R', 'Combined Win Rate'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.byAssetClass.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">No data.</td></tr>
                  ) : data.byAssetClass.map(row => (
                    <tr key={row.assetClass} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap">{row.assetClass}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{formatR(row.analystR)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{formatR(row.patternR)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{formatR(row.aiR)}</td>
                      <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${positivityClass(row.combinedTotalR)}`}>{formatR(row.combinedTotalR)}</td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatPercent(row.combinedWinRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* By Day of Week */}
          <div className="space-y-2">
            <SignalsByPeriodChart
              title="Average R by Day of Week — all signal types combined"
              data={data.byDayOfWeek.map(r => ({ key: r.day, avgR: r.avgR }))}
            />
            <PeriodTable firstColumnLabel="Day" rows={data.byDayOfWeek.map(r => ({ key: r.day, trades: r.trades, winRate: r.winRate, avgR: r.avgR }))} />
          </div>

          {/* By Month of Year */}
          <div className="space-y-2">
            <SignalsByPeriodChart
              title="Average R by Month of Year — all signal types combined"
              data={data.byMonth.map(r => ({ key: r.month, avgR: r.avgR }))}
            />
            <PeriodTable firstColumnLabel="Month" rows={data.byMonth.map(r => ({ key: r.month, trades: r.trades, winRate: r.winRate, avgR: r.avgR }))} />
          </div>

          {/* Year-by-year heat map -- plain Tailwind-shaded table, no charting library */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Year-by-Year Total R</p>
            <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {['Year', 'Analyst', 'Pattern', 'AI', 'Combined'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.byYear.map(row => {
                    const combinedValues = [row.analyst, row.pattern, row.ai].filter((v): v is number => v !== null)
                    const combinedTotal = combinedValues.length > 0 ? round2(combinedValues.reduce((a, b) => a + b, 0)) : null
                    return (
                      <tr key={row.year}>
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap">{row.year === CURRENT_YEAR ? `${row.year} YTD` : row.year}</td>
                        {([['analyst', row.analyst], ['pattern', row.pattern], ['ai', row.ai]] as const).map(([col, value]) => (
                          <td key={col} className={`px-4 py-2.5 tabular-nums whitespace-nowrap ${yearCellClass(value, maxAbsYearR)} ${value === null ? 'text-muted-foreground' : positivityClass(value)}`}>
                            {value === null ? '—' : formatR(value)}
                          </td>
                        ))}
                        <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${combinedTotal === null ? 'text-muted-foreground' : positivityClass(combinedTotal)}`}>
                          {combinedTotal !== null ? formatR(combinedTotal) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top 20 markets combined */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Top 20 Markets Combined</p>
            <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {['Symbol', 'Analyst R', 'Pattern R', 'AI R', 'Combined R', 'Win Rate', 'Trades'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.topMarkets.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-muted-foreground">No data.</td></tr>
                  ) : data.topMarkets.map(row => (
                    <tr key={row.symbol} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap">{row.symbol}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.analystR !== null ? formatR(row.analystR) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.patternR !== null ? formatR(row.patternR) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.aiR !== null ? formatR(row.aiR) : '—'}</td>
                      <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${positivityClass(row.combinedTotalR)}`}>{formatR(row.combinedTotalR)}</td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatPercent(row.combinedWinRate)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.trades.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {callouts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Key Callouts</p>
              <ul className="space-y-2">
                {callouts.map((c, i) => (
                  <li key={i} className="rounded-lg border border-border bg-muted/30 p-4 text-sm">{c}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs font-medium border border-border rounded-md px-3 py-2 bg-muted/20 text-muted-foreground">
            {PAST_PERFORMANCE_WARNING}
          </p>
        </div>
      )}
    </div>

    {reportOpen && data && (
      <CombinedSignalsReportBuilder
        analyst={data.analyst} patterns={data.patterns} ai={data.ai}
        cumulativeR={data.combined.cumulativeR}
        onClose={() => setReportOpen(false)}
      />
    )}
    </>
  )
}
