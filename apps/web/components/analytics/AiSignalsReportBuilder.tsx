'use client'
import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import {
  type MetricsTrade, type AttributionRow, type CumulativePoint, type DrawdownPoint,
  type RollingRow, type MonthlyMatrixRow, type DistributionBucket,
  totalR, cumulativeSeries, drawdownSeries, rankAttribution, rollingWindows, monthlyMatrix,
  triggeredTrades, profitFactor, computeTradeStatistics, resultDistribution, bestWorstTrades,
  MIN_TRADES_FOR_MARKET_RANKING,
} from '@/lib/metrics'
import type { AiSignalSummary } from '@/lib/aiSignalAnalytics'
import type { ReportSafeUniverse } from '@/lib/reportSanitiser'
import { COMPANY_NAME, FCA_REGULATORY_STATEMENT, DISCLAIMER_PARAGRAPHS, PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import { formatR, formatPercent, formatDate } from '@/lib/format'
import { ReportHeader } from './report/ReportHeader'
import { ReportFooter } from './report/ReportFooter'
import { CumulativePerformanceChart } from './CumulativePerformanceChart'
import { DrawdownChart } from './DrawdownChart'
import { RollingPerformanceTable } from './RollingPerformanceTable'
import { MonthlyPerformanceMatrix } from './MonthlyPerformanceMatrix'
import { AttributionTable } from './AttributionTable'
import { ContributionChart } from './ContributionChart'

// Same reasoning as PatternReportBuilder.tsx's own header comment: a deliberately
// separate component from ReportBuilder/PerformanceReport (the internal analyst report)
// AND from PatternReportBuilder (the pattern-recognition report) -- this is an external,
// client-facing capability showcase for Acuity's AI signal engine, with its own fixed
// structure (no section toggles, no title/subtitle editing, no presets). Sharing one
// generic report component across all three would make it too easy for a future edit to
// one to leak into the others.
//
// Unlike PatternReportBuilder (which keeps its own hand-rolled print-only tables),
// several pages below render the SAME dashboard components AiSignalsTab.tsx itself uses
// (RollingPerformanceTable/MonthlyPerformanceMatrix/AttributionTable/ContributionChart)
// -- the same approach report/PerformanceReport.tsx takes for the internal analyst
// report. Those components already carry print:-prefixed overrides (print:uppercase,
// print:bg-black/[0.03], print:text-[7.5pt], etc.), so they are proven to render
// correctly both on screen and under window.print() without a parallel print-only
// reimplementation.

interface Props {
  trades: MetricsTrade[]
  summary: AiSignalSummary
  confidenceRows: AttributionRow[]
  assetClassRows: AttributionRow[]
  directionRows: AttributionRow[]
  byMarket: AttributionRow[]
  onClose: () => void
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function monthYear(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function formatDuration(hours: number | null): string {
  return hours !== null ? `${hours.toFixed(1)}h` : '—'
}

// Same honesty rule as PatternReportBuilder.tsx's buildTimeframeInsight: the actual
// direction of this finding must come from the data, not be asserted -- telling an
// external client "higher confidence doesn't predict better outcomes" when the filtered
// slice shows the opposite would be a real compliance problem, not a copy-editing nicety.
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

// Explicit, deterministic y-axis ticks rather than Recharts' auto-generated ones --
// copied from TradeStatistics.tsx's own computeDistributionTicks (not exported there)
// so the Winner/Loser Distribution chart below matches its visual behaviour exactly.
function computeDistributionTicks(bins: DistributionBucket[]): number[] {
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0)
  const tickInterval = Math.max(1, Math.ceil(maxCount / 5 / 1000) * 1000)
  const ticks = Array.from(
    { length: Math.ceil(maxCount / tickInterval) + 1 },
    (_, i) => i * tickInterval
  )
  const isAscending = ticks.every((t, i) => i === 0 || t > ticks[i - 1]!)
  if (!isAscending) throw new Error('Chart y-axis ticks are not ascending')
  return ticks
}

interface AiReportData {
  periodLabel: string
  sinceLabel: string
  marketCount: number
  assetClassCount: number
  totalSignals: number
  totalTrades: number
  winRate: number | null
  avgR: number | null
  totalR: number
  profitFactor: number | null
  avgWinner: number | null
  avgLoser: number | null
  avgDurationHours: number | null
  triggerRate: number | null
  payoutRatio: number | null
  breakEvenWinRate: number | null
  cumulative: CumulativePoint[]
  drawdown: DrawdownPoint[]
  rolling: RollingRow[]
  monthly: MonthlyMatrixRow[]
  assetClassRows: AttributionRow[]
  directionRows: AttributionRow[]
  distribution: DistributionBucket[]
  bestTrades: MetricsTrade[]
  bestMarkets: AttributionRow[]
  worstMarkets: AttributionRow[]
  confidenceInsight: string
  summarySentence: string
  dataThroughDate: string
}

function buildReportData(
  trades: MetricsTrade[], summary: AiSignalSummary,
  confidenceRows: AttributionRow[], assetClassRows: AttributionRow[], directionRows: AttributionRow[], byMarket: AttributionRow[],
): AiReportData {
  const dates = trades.map(t => t.published_at.slice(0, 10)).filter(Boolean).sort()
  const earliest = dates[0] ?? null
  const latest = dates[dates.length - 1] ?? null
  const periodLabel = earliest && latest ? `${monthYear(earliest)} – ${monthYear(latest)}` : 'No data available'
  const sinceLabel = earliest ? monthYear(earliest) : 'inception'

  const marketCount = new Set(trades.map(t => t.symbol).filter(Boolean)).size
  const assetClassCount = new Set(trades.map(t => t.asset_class).filter(Boolean)).size

  // Zero-trade rows filtered here too (idempotent if the tab already filtered its own
  // copy) -- a report shouldn't show a permanently-empty category row to an external
  // reader any more than the live dashboard does.
  const visibleConfidenceRows = confidenceRows.filter(r => r.trades > 0)
  const visibleAssetClassRows = assetClassRows.filter(r => r.trades > 0)
  const visibleDirectionRows = directionRows.filter(r => r.trades > 0)

  const bestMarkets = rankAttribution(byMarket, MIN_TRADES_FOR_MARKET_RANKING, 'best', 10)
  const worstMarkets = rankAttribution(byMarket, MIN_TRADES_FOR_MARKET_RANKING, 'worst', 10)
  const { best: bestTrades } = bestWorstTrades(trades, 10)

  // computeTradeStatistics() normally derives generated/triggered/expired/triggerRate
  // from a MetricsPublication[] this component has no access to (AiSignalsTab.tsx's
  // toAnalyticsTrade adapter produces a bare MetricsTrade-shaped object with no
  // publication history attached) -- passed an empty array here deliberately so only its
  // trades-only fields (avgWinner/avgLoser/avgDurationHours) are used below. Trigger Rate
  // is shown from summary.triggerRate instead (lib/aiSignalAnalytics.ts's own
  // triggeredCount/count ratio over every signal, computed server-side from the real
  // ai_trades rows before the adapter drops fields), not from this call's own
  // (meaningless, always-null-with-an-empty-pubs-array) triggerRate field. avgDurationHours
  // depends on a `closed_at` timestamp the adapter also never sets, so it will reliably
  // render as "—" below via the existing null-sentinel convention (not fabricated).
  const tradeStats = computeTradeStatistics(trades, [])
  const pf = profitFactor(trades)

  // Not summary's own status-gated winRate/avgR: lib/metrics.ts's totalR() sums every
  // triggeredTrades() row (== every trade with a recorded result, per AiSignalsTab.tsx's
  // toAnalyticsTrade adapter -- it sets both triggered and result_r from rr !== null), so
  // this figure matches what the live dashboard's own KPI tile and rolling table show.
  const totalRValue = round2(totalR(trades))

  const summarySentence = `Acuity's AI signal engine has identified and tracked ${summary.totalSignals.toLocaleString()} ` +
    `trading signals across ${marketCount} markets and ${assetClassCount} asset classes since ${sinceLabel}. Across that ` +
    `period, signals have closed with a ${formatPercent(summary.winRate)} win rate and a cumulative total of ${formatR(totalRValue)}, ` +
    `reflecting live signal performance tracked in real time.`

  return {
    periodLabel,
    sinceLabel,
    marketCount,
    assetClassCount,
    totalSignals: summary.totalSignals,
    totalTrades: triggeredTrades(trades).length,
    winRate: summary.winRate,
    avgR: summary.avgR,
    totalR: totalRValue,
    profitFactor: pf !== null ? round2(pf) : null,
    avgWinner: tradeStats.avgWinner,
    avgLoser: tradeStats.avgLoser,
    avgDurationHours: tradeStats.avgDurationHours,
    triggerRate: summary.triggerRate,
    payoutRatio: summary.payoutRatio,
    breakEvenWinRate: summary.breakEvenWinRate,
    cumulative: cumulativeSeries(trades),
    drawdown: drawdownSeries(trades),
    rolling: rollingWindows(trades, new Date()),
    monthly: monthlyMatrix(trades),
    assetClassRows: visibleAssetClassRows,
    directionRows: visibleDirectionRows,
    distribution: resultDistribution(trades),
    bestTrades,
    bestMarkets,
    worstMarkets,
    confidenceInsight: buildConfidenceInsight(visibleConfidenceRows),
    summarySentence,
    dataThroughDate: latest ? formatDate(latest) : 'N/A',
  }
}

// Page 4's Trade Statistics panel -- a fixed, specific field list (Avg Winner R, Avg
// Loser R, Profit Factor, BE Win Rate, Payout Ratio, Avg Duration, Trigger Rate) that
// doesn't match the dashboard's own TradeStatistics.tsx ROWS set (which has no Payout
// Ratio/BE Win Rate rows at all, and includes generated/triggered/expired counts this
// component has no publication data for) -- built as its own small table instead of
// reusing that component, matching this file's historical BreakdownTable conventions.
interface TradeStatRow { label: string; value: string }

function TradeStatsTable({ rows }: { rows: TradeStatRow[] }) {
  return (
    <table className="w-full text-[9pt]" style={{ borderCollapse: 'collapse' }}>
      <tbody>
        {rows.map(r => (
          <tr key={r.label} className="border-b border-black/10">
            <td className="py-1.5 pr-2 text-black/70">{r.label}</td>
            <td className="py-1.5 pl-2 text-right tabular-nums font-medium">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Same chart as TradeStatistics.tsx's own Winner/Loser Distribution bar chart (bucketed
// via lib/metrics.ts's resultDistribution()), reimplemented inline here rather than
// reused as a whole component since TradeStatsTable above already covers this page's
// stats panel with a different field list.
function WinLossDistributionChart({ distribution }: { distribution: DistributionBucket[] }) {
  if (distribution.length === 0) return <p className="text-[8.5pt] text-black/50">No data for the current filters.</p>
  const ticks = computeDistributionTicks(distribution)
  return (
    <div style={{ height: 170 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={distribution} margin={{ top: 4, right: 8, left: 0, bottom: 20 }}>
          <XAxis dataKey="label" tick={{ fontSize: 8 }} axisLine={false} tickLine={false}
            interval={0} angle={-40} textAnchor="end" height={36} />
          <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} width={26}
            ticks={ticks} domain={[0, ticks[ticks.length - 1]]} />
          <Tooltip formatter={(v: any) => [v, 'Trades']} contentStyle={{ fontSize: 10 }} />
          <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {distribution.map((b, i) => <Cell key={i} fill={b.rangeStart >= 0 ? '#22c55e' : '#ef4444'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Best Performers table -- deliberately 3 columns (Date, Market, Result R), not 4.
// AiSignalsTab.tsx's toAnalyticsTrade adapter builds a bare object literal with only
// {result_r, triggered, published_at, symbol, asset_class, asset_name} -- `direction`
// (and analyst_id/market_id/session/source_system/closed_at) are never set on these
// trades despite the MetricsTrade type claiming them as required fields (the adapter
// casts via `as unknown as MetricsTrade[]`). Showing a Direction column here would
// render blank/undefined for every single row, which is worse than omitting it -- see
// final report for this call-out.
function BestTradesTable({ trades }: { trades: MetricsTrade[] }) {
  if (trades.length === 0) return <p className="text-[8.5pt] text-black/50">No data for the current filters.</p>
  return (
    <table className="w-full text-[9pt]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="border-b border-black/20 text-left">
          <th className="py-1.5 pr-2 font-semibold">Date</th>
          <th className="py-1.5 px-2 font-semibold">Market</th>
          <th className="py-1.5 pl-2 font-semibold text-right">Result R</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t, i) => (
          <tr key={i} className="border-b border-black/10">
            <td className="py-1 pr-2">{formatDate(t.published_at.slice(0, 10))}</td>
            <td className="py-1 px-2 font-medium">{t.symbol}</td>
            <td className="py-1 pl-2 text-right tabular-nums">{formatR(t.result_r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Rendered off-screen (not display:none) so Recharts' ResponsiveContainer has real
// layout dimensions before printing -- same reasoning as PatternReportBuilder.tsx /
// report/PerformanceReport.tsx.
function AiSignalPerformanceReportView({ data }: { data: AiReportData }) {
  const headerUniverse: ReportSafeUniverse = {
    title: 'AI Signal Performance Report',
    subtitle: data.periodLabel,
    periodLabel: '',
    filterSummary: data.periodLabel,
    tradeCount: data.totalSignals,
    generatedAt: new Date().toISOString(),
    dataThrough: data.dataThroughDate,
  }

  const statRows: TradeStatRow[] = [
    { label: 'Avg Winner R', value: formatR(data.avgWinner) },
    { label: 'Avg Loser R', value: formatR(data.avgLoser) },
    { label: 'Profit Factor', value: data.profitFactor !== null ? data.profitFactor.toFixed(2) : '—' },
    { label: 'BE Win Rate', value: formatPercent(data.breakEvenWinRate) },
    { label: 'Payout Ratio', value: data.payoutRatio !== null ? data.payoutRatio.toFixed(2) : '—' },
    { label: 'Avg Duration', value: formatDuration(data.avgDurationHours) },
    { label: 'Trigger Rate', value: formatPercent(data.triggerRate) },
  ]

  return (
    <div className="absolute -left-[9999px] top-0 print:static print:left-auto w-[210mm] print:w-auto bg-white text-black text-[10pt] leading-snug">
      {/* PAGE 1 -- Cover, Executive Summary (6 KPI tiles), Cumulative & Drawdown charts
          side by side. Both charts get an explicit, reduced height (rather than their
          live-dashboard defaults of h-64/h-32) so the pair fits on one A4 page next to
          the summary content above them. */}
      <section className="break-after-page p-2">
        <ReportHeader universe={headerUniverse} />
        <p className="mt-1 mb-4 text-[9pt] font-medium border border-black/20 rounded px-3 py-2 bg-black/[0.03]">
          {PAST_PERFORMANCE_WARNING}
        </p>

        <div className="mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Executive Summary</h2>
          <div className="grid grid-cols-6 gap-2 mb-3">
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Total R</p>
              <p className="text-[13pt] font-semibold tabular-nums">{formatR(data.totalR)}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Win Rate</p>
              <p className="text-[13pt] font-semibold tabular-nums">{formatPercent(data.winRate)}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Profit Factor</p>
              <p className="text-[13pt] font-semibold tabular-nums">{data.profitFactor !== null ? data.profitFactor.toFixed(2) : '—'}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Total Trades</p>
              <p className="text-[13pt] font-semibold tabular-nums">{data.totalTrades.toLocaleString()}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Avg Win</p>
              <p className="text-[13pt] font-semibold tabular-nums">{formatR(data.avgWinner)}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Avg Loss</p>
              <p className="text-[13pt] font-semibold tabular-nums">{formatR(data.avgLoser)}</p>
            </div>
          </div>
          <p className="text-[9pt] leading-relaxed mb-2">{data.summarySentence}</p>
          <div className="border border-black/15 rounded px-3 py-2 bg-black/[0.03] text-[9pt]">
            {data.confidenceInsight}
          </div>
        </div>

        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Cumulative Performance &amp; Drawdown (R)</h2>
        <div className="grid grid-cols-2 gap-3">
          <CumulativePerformanceChart data={data.cumulative} height={220} />
          <DrawdownChart data={data.drawdown} height={220} />
        </div>

        <ReportFooter pageLabel="Page 1" />
      </section>

      {/* PAGE 2 -- Consistency: Rolling Performance, Monthly Performance Matrix. Reuses
          the exact dashboard components (not a print-only reimplementation), same as
          report/PerformanceReport.tsx's own Page 2. */}
      <section className="break-after-page p-2">
        <div className="mb-4"><RollingPerformanceTable rows={data.rolling} /></div>
        <MonthlyPerformanceMatrix rows={data.monthly} />
        <ReportFooter pageLabel="Page 2" />
      </section>

      {/* PAGE 3 -- Performance by Asset Class & Direction, Contribution by Asset Class. */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Performance by Asset Class &amp; Direction</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <AttributionTable title="By Asset Class" rows={data.assetClassRows} entityLabel="Asset Classes" />
          <AttributionTable title="By Direction" rows={data.directionRows} entityLabel="Directions" showMaxDD={false} />
        </div>
        <ContributionChart title="Contribution by Asset Class" rows={data.assetClassRows} />
        <ReportFooter pageLabel="Page 3" />
      </section>

      {/* PAGE 4 -- Trade Statistics, Winner/Loser Distribution, Best Performers. */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Trade Statistics</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <TradeStatsTable rows={statRows} />
          <WinLossDistributionChart distribution={data.distribution} />
        </div>
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Best Performers</h2>
        <BestTradesTable trades={data.bestTrades} />
        <ReportFooter pageLabel="Page 4" />
      </section>

      {/* PAGE 5 -- Best & Worst Performing Markets (min MIN_TRADES_FOR_MARKET_RANKING
          triggered trades), same ranking threshold and AttributionTable usage as
          report/PerformanceReport.tsx's own Page 4. */}
      <section className="break-after-page p-2">
        <div className="space-y-4">
          <AttributionTable title={`Best Performing Markets (min ${MIN_TRADES_FOR_MARKET_RANKING} trades)`}
            rows={data.bestMarkets} entityLabel="Markets" showMaxDD={false} />
          <AttributionTable title={`Worst Performing Markets (min ${MIN_TRADES_FOR_MARKET_RANKING} trades)`}
            rows={data.worstMarkets} entityLabel="Markets" showMaxDD={false} />
        </div>
        <ReportFooter pageLabel="Page 5" />
      </section>

      {/* FINAL PAGE -- Methodology & Regulatory. FCA statement, disclaimer, sanctions
          line and past-performance warning are always rendered -- there is no toggle
          anywhere in this report that could omit them. */}
      <section className="p-2">
        <div className="text-[8.5pt] leading-relaxed text-black/80 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-black">Methodology, Risk &amp; Regulatory Information</h2>

          <div className="space-y-1">
            <h3 className="text-[9pt] font-semibold text-black">Methodology</h3>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>R (risk multiple) measures each signal&rsquo;s outcome relative to its initial planned risk (stop distance), normalising results so they are directly comparable across signals and instruments regardless of position size or stop width.</li>
              <li>Trades that closed at expiry with a recorded R are included in every statistic on this report — win rate, average R, and total R — alongside signals that closed via take-profit or stop-loss. Excluding them would understate performance, since an expiry close is not treated as a failure outcome by default.</li>
              <li>All signals are generated algorithmically by Acuity&rsquo;s AI signal engine and tracked in real time from publication.</li>
            </ul>
          </div>

          <div className="space-y-1">
            <h3 className="text-[9pt] font-semibold text-black">Regulatory Statement</h3>
            <p>{FCA_REGULATORY_STATEMENT}</p>
          </div>

          <div className="space-y-1">
            <h3 className="text-[9pt] font-semibold text-black">Disclaimer</h3>
            {DISCLAIMER_PARAGRAPHS.map((p, i) => <p key={i}>{p}</p>)}
          </div>

          <p className="font-semibold text-black">{PAST_PERFORMANCE_WARNING}</p>

          <p className="text-[7.5pt] text-black/50 pt-2 border-t border-black/10">
            © {new Date().getFullYear()} {COMPANY_NAME}. This document is confidential and intended solely for the named recipient.
          </p>
        </div>
        <ReportFooter pageLabel="Final Page" />
      </section>
    </div>
  )
}

export function AiSignalsReportBuilder({ trades, summary, confidenceRows, assetClassRows, directionRows, byMarket, onClose }: Props) {
  const [reportData, setReportData] = useState<AiReportData | null>(null)

  function handleGenerate() {
    const data = buildReportData(trades, summary, confidenceRows, assetClassRows, directionRows, byMarket)
    setReportData(data)

    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'))
      setTimeout(() => window.print(), 80)
    })
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 print:hidden" onClick={onClose} />
      <div className="fixed inset-x-4 top-8 bottom-8 sm:inset-x-auto sm:right-8 sm:w-[26rem] bg-card border border-border rounded-lg shadow-xl z-50 flex flex-col print:hidden">
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <p className="text-sm font-semibold">Generate AI Signal Performance Report</p>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto grow text-xs text-muted-foreground">
          <p>
            A fixed, client-ready summary of Acuity&rsquo;s AI signal performance: executive summary,
            cumulative and drawdown performance, rolling and monthly performance, performance by
            asset class and direction, trade statistics, and best/worst performers and markets --
            reflecting the filters currently applied on this tab.
          </p>
          <p>AI signals carry no analyst identity, so this report is safe to share externally.</p>
        </div>

        <div className="p-4 border-t border-border shrink-0">
          <button onClick={handleGenerate} disabled={trades.length === 0}
            className="w-full text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            Generate Report
          </button>
          {trades.length === 0 && (
            <p className="text-[11px] text-muted-foreground mt-1.5">No data for the current filters.</p>
          )}
        </div>
      </div>

      {reportData && <AiSignalPerformanceReportView data={reportData} />}
    </>
  )
}
