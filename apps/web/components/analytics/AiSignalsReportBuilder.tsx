'use client'
import { useState } from 'react'
import {
  type MetricsTrade, type AttributionRow, type CumulativePoint, type DrawdownPoint,
  totalR, maxDrawdown, cumulativeSeries, drawdownSeries, rankAttribution,
} from '@/lib/metrics'
import type { AiSignalSummary } from '@/lib/aiSignalAnalytics'
import type { ReportSafeUniverse } from '@/lib/reportSanitiser'
import { COMPANY_NAME, FCA_REGULATORY_STATEMENT, DISCLAIMER_PARAGRAPHS, PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import { formatR, formatPercent, formatDate } from '@/lib/format'
import { ReportHeader } from './report/ReportHeader'
import { ReportFooter } from './report/ReportFooter'
import { CumulativePerformanceChart } from './CumulativePerformanceChart'
import { DrawdownChart } from './DrawdownChart'

// Same reasoning as PatternReportBuilder.tsx's own header comment: a deliberately
// separate component from ReportBuilder/PerformanceReport (the internal analyst report)
// AND from PatternReportBuilder (the pattern-recognition report) -- this is an external,
// client-facing capability showcase for Acuity's AI signal engine, with its own fixed
// structure (no section toggles, no title/subtitle editing, no presets). Sharing one
// generic report component across all three would make it too easy for a future edit to
// one to leak into the others.

interface Props {
  trades: MetricsTrade[]
  summary: AiSignalSummary
  confidenceRows: AttributionRow[]
  assetClassRows: AttributionRow[]
  directionRows: AttributionRow[]
  byMarket: AttributionRow[]
  onClose: () => void
}

const MIN_TRADES_FOR_MARKET_TABLE = 10

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function monthYear(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
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

interface AiReportData {
  periodLabel: string
  sinceLabel: string
  marketCount: number
  assetClassCount: number
  totalSignals: number
  winRate: number | null
  avgR: number | null
  totalR: number
  maxDrawdown: number
  cumulative: CumulativePoint[]
  drawdown: DrawdownPoint[]
  confidenceRows: AttributionRow[]
  assetClassRows: AttributionRow[]
  directionRows: AttributionRow[]
  topMarkets: AttributionRow[]
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

  const topMarkets = rankAttribution(byMarket, MIN_TRADES_FOR_MARKET_TABLE, 'best', 10)

  // Not summary's own status-gated cumulativeR: lib/metrics.ts's totalR() sums every
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
    winRate: summary.winRate,
    avgR: summary.avgR,
    totalR: totalRValue,
    maxDrawdown: maxDrawdown(trades).value,
    cumulative: cumulativeSeries(trades),
    drawdown: drawdownSeries(trades),
    confidenceRows: visibleConfidenceRows,
    assetClassRows: visibleAssetClassRows,
    directionRows: visibleDirectionRows,
    topMarkets,
    confidenceInsight: buildConfidenceInsight(visibleConfidenceRows),
    summarySentence,
    dataThroughDate: latest ? formatDate(latest) : 'N/A',
  }
}

function BreakdownTable({ rows, firstColumnLabel, showTotalR }: {
  rows: AttributionRow[]
  firstColumnLabel: string
  showTotalR?: boolean
}) {
  if (rows.length === 0) return <p className="text-[8.5pt] text-black/50">No data for the current filters.</p>
  return (
    <table className="w-full text-[8.5pt]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="border-b border-black/20 text-left">
          <th className="py-1 pr-2 font-semibold">{firstColumnLabel}</th>
          <th className="py-1 px-2 font-semibold text-right">Signals</th>
          <th className="py-1 px-2 font-semibold text-right">Win Rate</th>
          <th className="py-1 px-2 font-semibold text-right">Avg R</th>
          {showTotalR && <th className="py-1 pl-2 font-semibold text-right">Total R</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.key} className="border-b border-black/10">
            <td className="py-1 pr-2">{row.label}</td>
            <td className="py-1 px-2 text-right tabular-nums">{row.trades.toLocaleString()}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatPercent(row.winRate)}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatR(row.avgR)}</td>
            {showTotalR && <td className="py-1 pl-2 text-right tabular-nums">{formatR(row.totalR)}</td>}
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

  return (
    <div className="absolute -left-[9999px] top-0 print:static print:left-auto w-[210mm] print:w-auto bg-white text-black text-[10pt] leading-snug">
      {/* PAGE 1 -- Cover & Executive Summary */}
      <section className="break-after-page p-2">
        <ReportHeader universe={headerUniverse} />
        <p className="mt-1 mb-4 text-[9pt] font-medium border border-black/20 rounded px-3 py-2 bg-black/[0.03]">
          {PAST_PERFORMANCE_WARNING}
        </p>

        <div className="mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Executive Summary</h2>
          <div className="grid grid-cols-5 gap-2 mb-3">
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Total Signals</p>
              <p className="text-[13pt] font-semibold tabular-nums">{data.totalSignals.toLocaleString()}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Win Rate</p>
              <p className="text-[13pt] font-semibold tabular-nums">{formatPercent(data.winRate)}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Avg R</p>
              <p className="text-[13pt] font-semibold tabular-nums">{formatR(data.avgR)}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Total R</p>
              <p className="text-[13pt] font-semibold tabular-nums">{formatR(data.totalR)}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Max Drawdown R</p>
              <p className="text-[13pt] font-semibold tabular-nums">{formatR(data.maxDrawdown)}</p>
            </div>
          </div>
          <p className="text-[9pt] leading-relaxed">{data.summarySentence}</p>
        </div>

        <ReportFooter pageLabel="Page 1" />
      </section>

      {/* PAGE 2 -- Cumulative & Drawdown Performance */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Cumulative Performance (R)</h2>
        <div className="mb-2"><CumulativePerformanceChart data={data.cumulative} /></div>
        <p className="text-[8.5pt] text-black/70 mb-4">
          Cumulative R measures the total return expressed as a multiple of initial risk across all closed signals.
        </p>

        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Drawdown (R)</h2>
        <div className="mb-2"><DrawdownChart data={data.drawdown} /></div>
        <p className="text-[8.5pt] text-black/70">
          Drawdown measures the decline from a cumulative-R peak to the lowest point reached before a new peak is set.
        </p>

        <ReportFooter pageLabel="Page 2" />
      </section>

      {/* PAGE 3 -- Signal Quality by Confidence */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Signal Quality by Confidence Score</h2>
        <div className="mb-3">
          <BreakdownTable rows={data.confidenceRows} firstColumnLabel="Confidence" showTotalR />
        </div>
        <div className="border border-black/15 rounded px-3 py-2 bg-black/[0.03] text-[9pt]">
          {data.confidenceInsight}
        </div>
        <ReportFooter pageLabel="Page 3" />
      </section>

      {/* PAGE 4 -- By Asset Class & Direction, Top Markets */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Performance by Asset Class &amp; Direction</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <h3 className="text-[9pt] font-semibold mb-1">By Asset Class</h3>
            <BreakdownTable rows={data.assetClassRows} firstColumnLabel="Asset Class" />
          </div>
          <div>
            <h3 className="text-[9pt] font-semibold mb-1">By Direction</h3>
            <BreakdownTable rows={data.directionRows} firstColumnLabel="Direction" />
          </div>
        </div>

        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">
          Top Performing Markets (min. {MIN_TRADES_FOR_MARKET_TABLE} signals)
        </h2>
        <BreakdownTable rows={data.topMarkets} firstColumnLabel="Market" showTotalR />

        <ReportFooter pageLabel="Page 4" />
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
            cumulative and drawdown performance, signal quality by confidence score, performance by
            asset class and direction, and top performing markets -- reflecting the filters currently
            applied on this tab.
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
