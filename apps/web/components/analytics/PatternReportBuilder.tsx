'use client'
import { useState } from 'react'
import {
  type MetricsTrade, type AttributionRow, type CumulativePoint,
  totalR, maxDrawdown, cumulativeSeries,
} from '@/lib/metrics'
import type { PatternSummary } from '@/lib/patternAnalytics'
import type { ReportSafeUniverse } from '@/lib/reportSanitiser'
import { COMPANY_NAME, FCA_REGULATORY_STATEMENT, DISCLAIMER_PARAGRAPHS, PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import { formatR, formatPercent, formatDate } from '@/lib/format'
import { ReportHeader } from './report/ReportHeader'
import { ReportFooter } from './report/ReportFooter'
import { CumulativePerformanceChart } from './CumulativePerformanceChart'

// A deliberately separate component from ReportBuilder/PerformanceReport (the internal
// analyst report): this report is an external, client-facing capability showcase for
// Acuity's pattern recognition system, not an operational performance record -- its
// structure is fixed (no section toggles, no title/subtitle editing, no presets) and its
// content choices favour a marketing-safe narrative over operational completeness (e.g.
// no Trade Statistics section, drawdown demoted to a methodology footnote). Sharing one
// generic, checkbox-driven report component across both would make it too easy for a
// future edit to one to leak into the other.

interface Props {
  trades: MetricsTrade[]
  summary: PatternSummary
  familyRows: AttributionRow[]
  granularityRows: AttributionRow[]
  assetClassRows: AttributionRow[]
  onClose: () => void
}

const MIN_SIGNALS_PER_PATTERN = 20

const TIMEFRAME_LABELS: Record<string, string> = { '1h': '1 Hour', '4h': '4 Hour', '1d': 'Daily' }

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function monthYear(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

// A "[daily] delivers [X]x higher average R" claim is only honest when both sides are
// positive -- dividing by a zero/negative average R would produce a meaningless or
// actively misleading multiple on a document going to an external client. Falls back to
// a difference-based or "best timeframe" framing whenever the data doesn't support the
// multiplier claim, rather than ever asserting a number the underlying data can't back up.
function buildTimeframeInsight(rows: AttributionRow[]): string {
  const daily = rows.find(r => r.key === '1d')
  const hourly = rows.find(r => r.key === '1h')

  if (daily?.avgR != null && hourly?.avgR != null && daily.avgR > hourly.avgR) {
    if (daily.avgR > 0 && hourly.avgR > 0) {
      const multiple = daily.avgR / hourly.avgR
      return `Daily timeframe signals deliver ${multiple.toFixed(1)}× higher average R than hourly signals, suggesting stronger edge at higher timeframes.`
    }
    return `Daily timeframe signals have outperformed hourly signals, averaging ${formatR(daily.avgR)} per signal versus ${formatR(hourly.avgR)} for hourly.`
  }

  const best = rows.filter(r => r.avgR !== null).sort((a, b) => (b.avgR ?? 0) - (a.avgR ?? 0))[0]
  if (!best) return 'Insufficient data to compare timeframes yet.'
  return `${TIMEFRAME_LABELS[best.key] ?? best.label} signals have shown the strongest average R per signal, at ${formatR(best.avgR)}.`
}

function buildPatternInsight(topWinRateFamily: AttributionRow | null): string {
  if (!topWinRateFamily || topWinRateFamily.winRate === null) {
    return `Insufficient sample size (minimum ${MIN_SIGNALS_PER_PATTERN} signals per pattern) to highlight a standout pattern type yet.`
  }
  return `${topWinRateFamily.label} signals have delivered a ${Math.round(topWinRateFamily.winRate * 100)}% win rate across ${topWinRateFamily.trades.toLocaleString()} signals — the highest win rate of any pattern type (minimum ${MIN_SIGNALS_PER_PATTERN} signals).`
}

interface PatternReportData {
  periodLabel: string
  sinceLabel: string
  marketCount: number
  assetClassCount: number
  totalSignals: number
  winRate: number | null
  avgR: number | null
  cumulativeR: number
  cumulative: CumulativePoint[]
  maxDrawdown: number
  qualifyingFamilies: AttributionRow[]
  topWinRateFamily: AttributionRow | null
  granularityRows: AttributionRow[]
  assetClassRows: AttributionRow[]
  timeframeInsight: string
  dataThroughDate: string
}

function buildReportData(
  trades: MetricsTrade[], summary: PatternSummary,
  familyRows: AttributionRow[], granularityRows: AttributionRow[], assetClassRows: AttributionRow[],
): PatternReportData {
  const dates = trades.map(t => t.published_at.slice(0, 10)).filter(Boolean).sort()
  const earliest = dates[0] ?? null
  const latest = dates[dates.length - 1] ?? null
  const periodLabel = earliest && latest ? `${monthYear(earliest)} – ${monthYear(latest)}` : 'No data available'
  const sinceLabel = earliest ? monthYear(earliest) : 'inception'

  const marketCount = new Set(trades.map(t => t.symbol).filter(Boolean)).size
  const assetClassCount = new Set(trades.map(t => t.asset_class).filter(Boolean)).size

  const qualifyingFamilies = familyRows
    .filter(r => r.trades >= MIN_SIGNALS_PER_PATTERN)
    .slice()
    .sort((a, b) => (b.avgR ?? -Infinity) - (a.avgR ?? -Infinity))

  const topWinRateFamily = qualifyingFamilies.length > 0
    ? qualifyingFamilies.reduce((best, r) => (r.winRate ?? -1) > (best.winRate ?? -1) ? r : best)
    : null

  const visibleGranularityRows = granularityRows.filter(r => r.trades > 0)
  const visibleAssetClassRows = assetClassRows.filter(r => r.trades > 0)

  return {
    periodLabel,
    sinceLabel,
    marketCount,
    assetClassCount,
    totalSignals: summary.totalPatterns,
    winRate: summary.winRate,
    avgR: summary.avgR,
    cumulativeR: round2(totalR(trades)),
    cumulative: cumulativeSeries(trades),
    maxDrawdown: maxDrawdown(trades).value,
    qualifyingFamilies,
    topWinRateFamily,
    granularityRows: visibleGranularityRows,
    assetClassRows: visibleAssetClassRows,
    timeframeInsight: buildTimeframeInsight(visibleGranularityRows),
    dataThroughDate: latest ? formatDate(latest) : 'N/A',
  }
}

function SimpleBreakdownTable({ rows, labelFor }: { rows: AttributionRow[]; labelFor: (r: AttributionRow) => string }) {
  if (rows.length === 0) return <p className="text-[8.5pt] text-black/50">No data for the current filters.</p>
  return (
    <table className="w-full text-[8.5pt]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="border-b border-black/20 text-left">
          <th className="py-1 pr-2 font-semibold" />
          <th className="py-1 px-2 font-semibold text-right">Signals</th>
          <th className="py-1 px-2 font-semibold text-right">Win Rate</th>
          <th className="py-1 pl-2 font-semibold text-right">Avg R</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.key} className="border-b border-black/10">
            <td className="py-1 pr-2">{labelFor(row)}</td>
            <td className="py-1 px-2 text-right tabular-nums">{row.trades.toLocaleString()}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatPercent(row.winRate)}</td>
            <td className="py-1 pl-2 text-right tabular-nums">{formatR(row.avgR)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Rendered off-screen (not display:none) so Recharts' ResponsiveContainer has real
// layout dimensions before printing -- same reasoning as report/PerformanceReport.tsx.
function PatternPerformanceReportView({ data }: { data: PatternReportData }) {
  const headerUniverse: ReportSafeUniverse = {
    title: 'Acuity Pattern Recognition — Performance Track Record',
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
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Total Signals</p>
              <p className="text-[13pt] font-semibold tabular-nums">{data.totalSignals.toLocaleString()}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Win Rate</p>
              <p className="text-[13pt] font-semibold tabular-nums">{formatPercent(data.winRate)}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Avg R / Signal</p>
              <p className="text-[13pt] font-semibold tabular-nums">{formatR(data.avgR)}</p>
            </div>
            <div className="border border-black/15 rounded px-2.5 py-2">
              <p className="text-[7.5pt] text-black/60">Cumulative R</p>
              <p className="text-[13pt] font-semibold tabular-nums">{formatR(data.cumulativeR)}</p>
            </div>
          </div>
          <p className="text-[9pt] leading-relaxed">
            Acuity&rsquo;s pattern recognition engine has identified and tracked {data.totalSignals.toLocaleString()} chart
            patterns across {data.marketCount} markets and {data.assetClassCount} asset classes since {data.sinceLabel}.
            The following analysis reflects live signal performance tracked in real time.
          </p>
        </div>

        <ReportFooter pageLabel="Page 1" />
      </section>

      {/* PAGE 2 -- Cumulative Performance & Signal Quality by Pattern Type. Merged from
          two previously separate pages -- the chart page held only one chart and was
          thin on its own, so it's combined with the pattern-type table below it. */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Cumulative Performance (R)</h2>
        <div className="mb-2"><CumulativePerformanceChart data={data.cumulative} /></div>
        <p className="text-[8.5pt] text-black/70 mb-4">
          Cumulative R measures the total return expressed as a multiple of initial risk across all closed signals.
        </p>

        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Signal Quality by Pattern Type</h2>
        {data.qualifyingFamilies.length === 0 ? (
          <p className="text-[9pt] text-black/60 mb-3">
            No pattern family has reached the minimum {MIN_SIGNALS_PER_PATTERN}-signal sample size yet.
          </p>
        ) : (
          <table className="w-full text-[9pt] mb-3" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="border-b border-black/20 text-left">
                <th className="py-1.5 pr-2 font-semibold">Pattern</th>
                <th className="py-1.5 px-2 font-semibold text-right">Signals</th>
                <th className="py-1.5 px-2 font-semibold text-right">Win Rate</th>
                <th className="py-1.5 px-2 font-semibold text-right">Avg R</th>
                <th className="py-1.5 pl-2 font-semibold text-right">Total R</th>
              </tr>
            </thead>
            <tbody>
              {data.qualifyingFamilies.map((row, i) => (
                <tr key={row.key} className="border-b border-black/10"
                  style={i < 3 ? { backgroundColor: 'rgba(34, 197, 94, 0.12)' } : undefined}>
                  <td className="py-1.5 pr-2">{row.label}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{row.trades.toLocaleString()}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{formatPercent(row.winRate)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{formatR(row.avgR)}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">{formatR(row.totalR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="border border-black/15 rounded px-3 py-2 bg-black/[0.03] text-[9pt]">
          {buildPatternInsight(data.topWinRateFamily)}
        </div>
        <ReportFooter pageLabel="Page 2" />
      </section>

      {/* PAGE 3 -- Performance by Timeframe & Asset Class */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Performance by Timeframe &amp; Asset Class</h2>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div>
            <h3 className="text-[9pt] font-semibold mb-1">By Timeframe</h3>
            <SimpleBreakdownTable rows={data.granularityRows} labelFor={r => TIMEFRAME_LABELS[r.key] ?? r.label} />
          </div>
          <div>
            <h3 className="text-[9pt] font-semibold mb-1">By Asset Class</h3>
            <SimpleBreakdownTable rows={data.assetClassRows} labelFor={r => r.label} />
          </div>
        </div>
        <div className="border border-black/15 rounded px-3 py-2 bg-black/[0.03] text-[9pt]">
          {data.timeframeInsight}
        </div>
        <ReportFooter pageLabel="Page 3" />
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
              <li>R (risk multiple) measures each signal&rsquo;s outcome relative to its initial risk. A result of +1R means the signal returned exactly its planned risk amount as profit. A result of -1R means the signal closed at its stop loss.</li>
              <li>Win rate reflects the percentage of closed signals (profit or loss) that were profitable. Expired signals — those that reached their expiry without triggering a close — are excluded from win rate calculations.</li>
              <li>All signals are generated algorithmically by Acuity&rsquo;s pattern recognition engine and tracked in real time from publication.</li>
              <li>Maximum drawdown over the period: {formatR(data.maxDrawdown)}.</li>
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

export function PatternReportBuilder({ trades, summary, familyRows, granularityRows, assetClassRows, onClose }: Props) {
  const [reportData, setReportData] = useState<PatternReportData | null>(null)

  function handleGenerate() {
    const data = buildReportData(trades, summary, familyRows, granularityRows, assetClassRows)
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
          <p className="text-sm font-semibold">Generate Pattern Performance Report</p>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto grow text-xs text-muted-foreground">
          <p>
            A fixed, client-ready summary of Acuity&rsquo;s pattern recognition performance: executive
            summary, cumulative performance, signal quality by pattern type, and performance by
            timeframe and asset class -- reflecting the filters currently applied on this tab.
          </p>
          <p>Pattern signals carry no analyst identity, so this report is safe to share externally.</p>
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

      {reportData && <PatternPerformanceReportView data={reportData} />}
    </>
  )
}
