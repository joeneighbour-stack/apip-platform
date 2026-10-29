'use client'
import { useState } from 'react'
import {
  type SignalTypeData, type SignalTypeKey, type CombinedCumulativePoint,
  type CombinedAssetClassRow, type CombinedMarketRow, type CombinedYearRow, type DayOfWeekRow, type MonthOfYearRow,
  TYPE_LABELS, TYPE_ORDER, buildKeyCallouts,
} from '@/lib/combinedSignalAnalytics'
import type { ReportSafeUniverse } from '@/lib/reportSanitiser'
import type { DrawdownPoint } from '@/lib/metrics'
import { COMPANY_NAME, FCA_REGULATORY_STATEMENT, DISCLAIMER_PARAGRAPHS, PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import { formatR, formatPercent, formatDate } from '@/lib/format'
import { type CombinedFilterState, hasActiveCombinedFilters } from '@/lib/analyticsFilters'
import { DATE_PRESET_OPTIONS } from '@/lib/dateRanges'
import { downloadCombinedWorkbook } from '@/lib/combinedSignalsExcelExport'
import { ReportHeader } from './report/ReportHeader'
import { ReportFooter } from './report/ReportFooter'
import { CombinedCumulativeChart } from './CombinedCumulativeChart'
import { DrawdownChart } from './DrawdownChart'

// Same reasoning as PatternReportBuilder.tsx/AiSignalsReportBuilder.tsx's own header
// comments: a deliberately separate component, not shared with the other two signal-type
// reports or the internal analyst ReportBuilder -- this is an external, client-facing
// capability showcase spanning all three signal types at once, with its own fixed
// structure (no section toggles, no title/subtitle editing, no presets).
// TYPE_LABELS/TYPE_ORDER/buildKeyCallouts live in lib/combinedSignalAnalytics.ts (shared
// with CombinedSignalsTab.tsx) rather than being imported from that tab file directly --
// the tab dynamic-imports this report builder, so a static import back the other way
// would be a real circular module dependency.

interface Props {
  analyst: SignalTypeData
  patterns: SignalTypeData
  ai: SignalTypeData
  normalisedCumulative: CombinedCumulativePoint[]   // rebased-to-100 series
  cumulativeR: CombinedCumulativePoint[]             // raw R series (callouts + combined drawdown)
  byAssetClass: CombinedAssetClassRow[]
  byDayOfWeek: DayOfWeekRow[]
  byMonth: MonthOfYearRow[]
  byYear: CombinedYearRow[]
  topMarkets: CombinedMarketRow[]
  filters: CombinedFilterState
  onClose: () => void
}

// Mirrors PatternReportBuilder.tsx's describePatternFilters() / AiSignalsReportBuilder.tsx's
// describeAiFilters() -- kept local for the same "self-contained report" reason those have.
function describeCombinedFilters(filters: CombinedFilterState): string {
  if (!hasActiveCombinedFilters(filters)) return 'None (full history, all signal types, all assets, all markets)'
  const segments: string[] = []
  const datePresetLabel = DATE_PRESET_OPTIONS.find(o => o.key === filters.datePreset)?.label
  if (filters.datePreset !== 'SINCE_INCEPTION' && datePresetLabel) segments.push(`Date: ${datePresetLabel}`)
  if (filters.signalTypes.length > 0) segments.push(`Signal Type: ${filters.signalTypes.join(', ')}`)
  if (filters.analystIds.length > 0) segments.push(`Analysts: ${filters.analystIds.length} selected`)
  if (filters.assetClasses.length > 0) segments.push(`Asset Class: ${filters.assetClasses.join(', ')}`)
  if (filters.marketIds.length > 0) segments.push(`Markets: ${filters.marketIds.length} selected`)
  if (filters.directions.length > 0) segments.push(`Direction: ${filters.directions.join(', ')}`)
  if (filters.sessions.length > 0) segments.push(`Session: ${filters.sessions.join(', ')}`)
  if (filters.triggerStatus !== 'ALL') segments.push(`Trigger Status: ${filters.triggerStatus}`)
  return segments.join(' • ') || 'None (full history, all signal types, all assets, all markets)'
}

// Computed, not hardcoded to 2026 -- matches CombinedSignalsTab.tsx's own CURRENT_YEAR,
// so the Year-by-Year table's "YTD" label stays correct in 2027+ instead of silently
// going stale.
const CURRENT_YEAR = new Date().getUTCFullYear()

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function monthYear(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

// Combines whichever of analyst/patterns/ai are present (non-null) at a given date into a
// single equity figure -- the same "sum whichever series are present" rule YearGridTable
// already applies per-year -- then walks the combined series forward tracking a running
// peak, exactly like lib/metrics.ts's own drawdownSeries(): drawdown = equity - peak, so
// values are always <= 0 and DrawdownChart.tsx's existing "fill red below the zero
// reference line" rendering plots it correctly with no changes to that component.
function buildCombinedDrawdown(points: CombinedCumulativePoint[]): DrawdownPoint[] {
  let peak = 0
  return points.map(p => {
    const values = [p.analyst, p.patterns, p.ai].filter((v): v is number => v !== null && v !== undefined)
    const equity = values.length > 0 ? values.reduce((a, b) => a + b, 0) : 0
    if (equity > peak) peak = equity
    return { date: p.date, drawdown: round2(equity - peak) }
  })
}

interface CombinedReportData {
  periodLabel: string
  dataThroughDate: string
  types: Record<SignalTypeKey, SignalTypeData>
  normalisedCumulative: CombinedCumulativePoint[]
  cumulativeR: CombinedCumulativePoint[]
  combinedDrawdown: DrawdownPoint[]
  byAssetClass: CombinedAssetClassRow[]
  byDayOfWeek: DayOfWeekRow[]
  byMonth: MonthOfYearRow[]
  byYear: CombinedYearRow[]
  topMarkets: CombinedMarketRow[]
  indexCaption: string
  callouts: string[]
}

function buildReportData(
  analyst: SignalTypeData, patterns: SignalTypeData, ai: SignalTypeData,
  normalisedCumulative: CombinedCumulativePoint[], cumulativeR: CombinedCumulativePoint[],
  byAssetClass: CombinedAssetClassRow[], byDayOfWeek: DayOfWeekRow[], byMonth: MonthOfYearRow[],
  byYear: CombinedYearRow[], topMarkets: CombinedMarketRow[],
): CombinedReportData {
  const types: Record<SignalTypeKey, SignalTypeData> = { analyst, patterns, ai }
  const firstDates = TYPE_ORDER.map(k => types[k].summary.firstSignalDate).filter((d): d is string => d !== null)
  const lastDates = TYPE_ORDER.map(k => types[k].summary.lastSignalDate).filter((d): d is string => d !== null)
  const earliest = firstDates.length > 0 ? firstDates.reduce((a, b) => b < a ? b : a) : null
  const latest = lastDates.length > 0 ? lastDates.reduce((a, b) => b > a ? b : a) : null

  // Same logic as CombinedSignalsTab.tsx's own indexCaption useMemo -- computed live from
  // each type's own firstSignalDate rather than hardcoded, since the tab's own comment on
  // this exact string explains why: asserting fixed dates here would silently go stale
  // (or wrong) the moment the underlying history changes.
  const indexCaption = (() => {
    const parts = TYPE_ORDER.map(key => {
      const first = types[key].summary.firstSignalDate
      return `${TYPE_LABELS[key]}: ${first ? monthYear(first) : 'no data yet'}`
    })
    return `All series rebased to 100 at start. A value of 150 = +50% relative growth from inception. ${parts.join(', ')}.`
  })()

  return {
    periodLabel: earliest && latest ? `${monthYear(earliest)} – ${monthYear(latest)}` : 'No data available',
    dataThroughDate: latest ? formatDate(latest) : 'N/A',
    types,
    normalisedCumulative,
    cumulativeR,
    combinedDrawdown: buildCombinedDrawdown(cumulativeR),
    byAssetClass,
    byDayOfWeek,
    byMonth,
    byYear,
    topMarkets,
    indexCaption,
    callouts: buildKeyCallouts(types),
  }
}

function ComparisonTable({ types }: { types: Record<SignalTypeKey, SignalTypeData> }) {
  return (
    <table className="w-full text-[9pt]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="border-b border-black/20 text-left">
          <th className="py-1.5 pr-2 font-semibold">Signal Type</th>
          <th className="py-1.5 px-2 font-semibold text-right">Total Signals</th>
          <th className="py-1.5 px-2 font-semibold text-right">Win Rate</th>
          <th className="py-1.5 px-2 font-semibold text-right">Avg R</th>
          <th className="py-1.5 px-2 font-semibold text-right">Total R</th>
          <th className="py-1.5 px-2 font-semibold text-right">Max DD (R)</th>
          <th className="py-1.5 px-2 font-semibold text-right">Payout Ratio</th>
          <th className="py-1.5 px-2 font-semibold text-right">BE Win Rate</th>
          <th className="py-1.5 pl-2 font-semibold text-right">Since</th>
        </tr>
      </thead>
      <tbody>
        {TYPE_ORDER.map(key => {
          const d = types[key]
          return (
            <tr key={key} className="border-b border-black/10">
              <td className="py-1.5 pr-2">{TYPE_LABELS[key]}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{d.summary.totalSignals.toLocaleString()}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{formatPercent(d.summary.winRate)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{formatR(d.summary.avgR)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{formatR(d.summary.totalR)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{formatR(d.summary.maxDrawdownR)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{d.summary.payoutRatio != null ? d.summary.payoutRatio.toFixed(2) : '—'}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{d.summary.breakEvenWinRate != null ? formatPercent(d.summary.breakEvenWinRate) : '—'}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{d.summary.firstSignalDate ? formatDate(d.summary.firstSignalDate) : '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// Compact per-signal-type stats row requested below the Performance Comparison table.
// SignalTypeSummary (lib/combinedSignalAnalytics.ts) does not carry avgWinner/avgLoser/
// profitFactor as separate fields -- only payoutRatio and breakEvenWinRate are derived and
// stored -- and this component only ever receives the pre-aggregated SignalTypeData, never
// the raw per-signal rr values a profit-factor/avg-winner/avg-loser computation would need.
// So this renders the two fields that genuinely exist, as a tile row (visually distinct
// from, not a re-statement of, the table columns above) rather than inventing numbers or a
// new prop.
function TradeStatisticsRow({ types }: { types: Record<SignalTypeKey, SignalTypeData> }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {TYPE_ORDER.map(key => {
        const d = types[key].summary
        return (
          <div key={key} className="border border-black/15 rounded px-2.5 py-2">
            <p className="text-[7.5pt] text-black/60 mb-1">{TYPE_LABELS[key]}</p>
            <div className="flex items-center justify-between text-[9pt]">
              <span className="text-black/60">Payout Ratio</span>
              <span className="tabular-nums font-medium">{d.payoutRatio != null ? d.payoutRatio.toFixed(2) : '—'}</span>
            </div>
            <div className="flex items-center justify-between text-[9pt]">
              <span className="text-black/60">BE Win Rate</span>
              <span className="tabular-nums font-medium">{d.breakEvenWinRate != null ? formatPercent(d.breakEvenWinRate) : '—'}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AssetClassTable({ rows }: { rows: CombinedAssetClassRow[] }) {
  if (rows.length === 0) return <p className="text-[8.5pt] text-black/50">No data for the current filters.</p>
  return (
    <table className="w-full text-[9pt]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="border-b border-black/20 text-left">
          <th className="py-1 pr-2 font-semibold">Asset Class</th>
          <th className="py-1 px-2 font-semibold text-right">Analyst R</th>
          <th className="py-1 px-2 font-semibold text-right">Pattern R</th>
          <th className="py-1 px-2 font-semibold text-right">AI R</th>
          <th className="py-1 px-2 font-semibold text-right">Combined Total R</th>
          <th className="py-1 pl-2 font-semibold text-right">Combined Win Rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.assetClass} className="border-b border-black/10">
            <td className="py-1 pr-2">{row.assetClass}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatR(row.analystR)}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatR(row.patternR)}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatR(row.aiR)}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatR(row.combinedTotalR)}</td>
            <td className="py-1 pl-2 text-right tabular-nums">{formatPercent(row.combinedWinRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function YearGridTable({ rows }: { rows: CombinedYearRow[] }) {
  if (rows.length === 0) return <p className="text-[8.5pt] text-black/50">No data for the current filters.</p>
  return (
    <table className="w-full text-[9pt]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="border-b border-black/20 text-left">
          <th className="py-1 pr-2 font-semibold">Year</th>
          <th className="py-1 px-2 font-semibold text-right">Analyst</th>
          <th className="py-1 px-2 font-semibold text-right">Pattern</th>
          <th className="py-1 px-2 font-semibold text-right">AI</th>
          <th className="py-1 pl-2 font-semibold text-right">Combined</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          const combinedValues = [row.analyst, row.pattern, row.ai].filter((v): v is number => v !== null)
          const combinedTotal = combinedValues.length > 0 ? round2(combinedValues.reduce((a, b) => a + b, 0)) : null
          return (
            <tr key={row.year} className="border-b border-black/10">
              <td className="py-1 pr-2">{row.year === CURRENT_YEAR ? `${row.year} YTD` : row.year}</td>
              <td className="py-1 px-2 text-right tabular-nums">{row.analyst === null ? '—' : formatR(row.analyst)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{row.pattern === null ? '—' : formatR(row.pattern)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{row.ai === null ? '—' : formatR(row.ai)}</td>
              <td className="py-1 pl-2 text-right tabular-nums">{combinedTotal === null ? '—' : formatR(combinedTotal)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// Fixed, literal Tailwind class strings (never interpolated) so the production build's
// content scanner can actually see them -- mirrors CombinedSignalsTab.tsx's own
// yearCellClass()/POSITIVE_TIERS/NEGATIVE_TIERS pattern exactly (a dynamically-built class
// name like `bg-green-500/${n}` would be invisible to Tailwind's scanner and silently
// render unstyled).
const POSITIVE_TIERS = ['bg-green-500/10', 'bg-green-500/20', 'bg-green-500/30', 'bg-green-500/45', 'bg-green-500/60']
const NEGATIVE_TIERS = ['bg-red-500/10', 'bg-red-500/20', 'bg-red-500/30', 'bg-red-500/45', 'bg-red-500/60']

function monthCellClass(value: number | null, maxAbs: number): string {
  if (value === null || value === 0) return ''
  const tiers = value > 0 ? POSITIVE_TIERS : NEGATIVE_TIERS
  const ratio = maxAbs > 0 ? Math.min(Math.abs(value) / maxAbs, 1) : 0
  const idx = Math.min(tiers.length - 1, Math.floor(ratio * tiers.length))
  return tiers[idx]!
}

// byMonth (lib/combinedSignalAnalytics.ts's buildMonthBreakdown()) is a fixed 12-row
// month-of-year breakdown aggregated across ALL years combined -- it carries no year
// dimension at all, so a true year x month matrix (rows by year, columns Jan-Dec) cannot be
// built from it without new data this component doesn't receive. This renders the closest
// faithful alternative: months across, one row per metric, all years combined, colour-coded
// by Avg R the same way the Year-by-Year table's own cells are.
function MonthlyMatrixTable({ rows }: { rows: MonthOfYearRow[] }) {
  if (rows.length === 0) return <p className="text-[8.5pt] text-black/50">No data for the current filters.</p>
  const maxAbs = Math.max(0.01, ...rows.map(r => r.avgR !== null ? Math.abs(r.avgR) : 0))
  return (
    <table className="w-full text-[9pt]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="border-b border-black/20 text-left">
          <th className="py-1 pr-2 font-semibold">Metric</th>
          {rows.map(row => (
            <th key={row.month} className="py-1 px-1 font-semibold text-right">{row.month.slice(0, 3)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-black/10">
          <td className="py-1 pr-2">Avg R</td>
          {rows.map(row => (
            <td key={row.month} className={`py-1 px-1 text-right tabular-nums ${monthCellClass(row.avgR, maxAbs)}`}>
              {row.avgR !== null ? row.avgR.toFixed(2) : '—'}
            </td>
          ))}
        </tr>
        <tr className="border-b border-black/10">
          <td className="py-1 pr-2">Win Rate</td>
          {rows.map(row => (
            <td key={row.month} className="py-1 px-1 text-right tabular-nums">
              {row.winRate !== null ? formatPercent(row.winRate) : '—'}
            </td>
          ))}
        </tr>
        <tr className="border-b border-black/10">
          <td className="py-1 pr-2">Trades</td>
          {rows.map(row => (
            <td key={row.month} className="py-1 px-1 text-right tabular-nums">{row.trades.toLocaleString()}</td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

function TopMarketsTable({ rows }: { rows: CombinedMarketRow[] }) {
  if (rows.length === 0) return <p className="text-[8.5pt] text-black/50">No data for the current filters.</p>
  return (
    <table className="w-full text-[9pt]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="border-b border-black/20 text-left">
          <th className="py-1 pr-2 font-semibold">Symbol</th>
          <th className="py-1 px-2 font-semibold text-right">Analyst R</th>
          <th className="py-1 px-2 font-semibold text-right">Pattern R</th>
          <th className="py-1 px-2 font-semibold text-right">AI R</th>
          <th className="py-1 px-2 font-semibold text-right">Combined R</th>
          <th className="py-1 px-2 font-semibold text-right">Win Rate</th>
          <th className="py-1 pl-2 font-semibold text-right">Trades</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.symbol} className="border-b border-black/10">
            <td className="py-1 pr-2">{row.symbol}</td>
            <td className="py-1 px-2 text-right tabular-nums">{row.analystR !== null ? formatR(row.analystR) : '—'}</td>
            <td className="py-1 px-2 text-right tabular-nums">{row.patternR !== null ? formatR(row.patternR) : '—'}</td>
            <td className="py-1 px-2 text-right tabular-nums">{row.aiR !== null ? formatR(row.aiR) : '—'}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatR(row.combinedTotalR)}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatPercent(row.combinedWinRate)}</td>
            <td className="py-1 pl-2 text-right tabular-nums">{row.trades.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Rendered off-screen (not display:none) so Recharts' ResponsiveContainer has real
// layout dimensions before printing -- same reasoning as the other report builders.
function CombinedSignalsReportView({ data }: { data: CombinedReportData }) {
  const headerUniverse: ReportSafeUniverse = {
    title: 'Acuity Signal Intelligence — Combined Performance Report',
    subtitle: data.periodLabel,
    periodLabel: '',
    filterSummary: data.periodLabel,
    tradeCount: TYPE_ORDER.reduce((s, k) => s + data.types[k].summary.totalSignals, 0),
    generatedAt: new Date().toISOString(),
    dataThrough: data.dataThroughDate,
  }

  return (
    <div className="absolute -left-[9999px] top-0 print:static print:left-auto w-[210mm] print:w-auto bg-white text-black text-[10pt] leading-snug">
      {/* PAGE 1 -- Cover & Signal Output */}
      <section className="break-after-page p-2">
        <ReportHeader universe={headerUniverse} />
        <p className="mt-1 mb-4 text-[9pt] font-medium border border-black/20 rounded px-3 py-2 bg-black/[0.03]">
          {PAST_PERFORMANCE_WARNING}
        </p>

        <div className="mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Signal Output</h2>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {TYPE_ORDER.map(key => {
              const d = data.types[key]
              return (
                <div key={key} className="border border-black/15 rounded px-2.5 py-2">
                  <p className="text-[7.5pt] text-black/60">{TYPE_LABELS[key]}</p>
                  <p className="text-[13pt] font-semibold tabular-nums">{d.summary.totalSignals.toLocaleString()}</p>
                  <p className="text-[7.5pt] text-black/60">
                    {d.summary.firstSignalDate && d.summary.lastSignalDate
                      ? `${formatDate(d.summary.firstSignalDate)} – ${formatDate(d.summary.lastSignalDate)}`
                      : 'No signals yet'}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        <ReportFooter pageLabel="Page 1" />
      </section>

      {/* PAGE 2 -- Performance Comparison, compact Trade Statistics, and Normalised Equity
          Curve + Combined Drawdown side by side. The drawdown chart sits next to whichever
          chart shows the equity curve -- that's the Normalised Equity Curve here, on this
          page, not Page 1 (Page 1 is cover/signal-output tiles only and has no equity
          curve to sit next to). Both charts render at a reduced explicit height so they
          fit on one row without overflowing the page. */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Performance Comparison</h2>
        <div className="mb-3"><ComparisonTable types={data.types} /></div>

        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Trade Statistics</h2>
        <div className="mb-4">
          <TradeStatisticsRow types={data.types} />
          <p className="text-[7.5pt] text-black/50 mt-1">
            Avg Winner, Avg Loser and Profit Factor are not shown here: SignalTypeSummary only derives and
            stores Payout Ratio and Break-Even Win Rate at this aggregation level, not those three fields.
          </p>
        </div>

        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Normalised Equity Curve &amp; Combined Drawdown</h2>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <CombinedCumulativeChart data={data.normalisedCumulative} caption={data.indexCaption} height={220} />
          <DrawdownChart data={data.combinedDrawdown} height={220} />
        </div>

        <ReportFooter pageLabel="Page 2" />
      </section>

      {/* PAGE 3 -- By Asset Class, Year-by-Year Total R, and Monthly Performance (all years
          combined -- byMonth has no year dimension, see MonthlyMatrixTable's own comment).
          Day-of-Week is still left out entirely: it's a bar chart on the live dashboard and
          Recharts bar charts don't render reliably in print. */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">By Asset Class</h2>
        <div className="mb-4"><AssetClassTable rows={data.byAssetClass} /></div>

        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Year-by-Year Total R</h2>
        <div className="mb-4"><YearGridTable rows={data.byYear} /></div>

        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Monthly Performance (All Years Combined)</h2>
        <MonthlyMatrixTable rows={data.byMonth} />
        <p className="text-[7.5pt] text-black/50 mt-1">
          Aggregated across all available years — a calendar-year × month breakdown is not produced by the
          underlying analytics pipeline.
        </p>

        <ReportFooter pageLabel="Page 3" />
      </section>

      {/* PAGE 4 -- Top 20 Markets + Key Callouts */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Top 20 Markets</h2>
        <div className="mb-4"><TopMarketsTable rows={data.topMarkets} /></div>

        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Key Callouts</h2>
        {data.callouts.length === 0 ? (
          <p className="text-[9pt] text-black/60">Insufficient data to generate callouts yet.</p>
        ) : (
          <ul className="list-disc pl-4 space-y-1.5 text-[9pt]">
            {data.callouts.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        )}
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
              <li>This report combines three independently tracked signal types: Analyst Signals (recommendations published by Acuity&rsquo;s human analyst team), Pattern Signals (Acuity&rsquo;s chart pattern recognition engine), and AI Signals (Acuity&rsquo;s AI signal engine).</li>
              <li>R (risk multiple) measures each signal&rsquo;s outcome relative to its initial planned risk (stop distance), normalising results so they are directly comparable across signal types, instruments, and position sizes.</li>
              <li>AI Signal statistics include trades that closed at expiry with a recorded R, alongside signals that closed via take-profit or stop-loss. Pattern Signal statistics currently count only take-profit/stop-loss closes.</li>
              <li>Pattern and AI Signals are generated entirely algorithmically and tracked in real time from publication; Analyst Signals are published by human analysts.</li>
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

export function CombinedSignalsReportBuilder({
  analyst, patterns, ai, normalisedCumulative, cumulativeR,
  byAssetClass, byDayOfWeek, byMonth, byYear, topMarkets, filters, onClose,
}: Props) {
  const [reportData, setReportData] = useState<CombinedReportData | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  function handleGenerate() {
    const data = buildReportData(
      analyst, patterns, ai, normalisedCumulative, cumulativeR,
      byAssetClass, byDayOfWeek, byMonth, byYear, topMarkets,
    )
    setReportData(data)

    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'))
      setTimeout(() => window.print(), 80)
    })
  }

  async function handleExportExcel() {
    setExportError(null)
    setExporting(true)
    try {
      const types: Record<SignalTypeKey, SignalTypeData> = { analyst, patterns, ai }
      const firstDates = TYPE_ORDER.map(k => types[k].summary.firstSignalDate).filter((d): d is string => d !== null)
      const lastDates = TYPE_ORDER.map(k => types[k].summary.lastSignalDate).filter((d): d is string => d !== null)
      const earliest = firstDates.length > 0 ? firstDates.reduce((a, b) => b < a ? b : a) : null
      const latest = lastDates.length > 0 ? lastDates.reduce((a, b) => b > a ? b : a) : null
      const periodLabel = earliest && latest ? `${monthYear(earliest)} – ${monthYear(latest)}` : 'No data available'

      await downloadCombinedWorkbook({
        reportName: 'Combined Signal Performance Report',
        dateRangeLabel: periodLabel,
        filterSummary: describeCombinedFilters(filters),
        types,
        byAssetClass,
        byYear,
        topMarkets,
      })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to generate the Excel file.')
    } finally {
      setExporting(false)
    }
  }

  const hasData = TYPE_ORDER.some(key => ({ analyst, patterns, ai }[key].summary.totalSignals > 0))

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 print:hidden" onClick={onClose} />
      <div className="fixed inset-x-4 top-8 bottom-8 sm:inset-x-auto sm:right-8 sm:w-[26rem] bg-card border border-border rounded-lg shadow-xl z-50 flex flex-col print:hidden">
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <p className="text-sm font-semibold">Generate Combined Performance Report</p>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto grow text-xs text-muted-foreground">
          <p>
            A fixed, client-ready summary spanning all three signal types: signal output,
            performance comparison, normalised equity curves, breakdowns by asset class,
            year, and market, and key callouts drawn from live data.
          </p>
          <p>No signal type here carries analyst identity, so this report is safe to share externally.</p>
        </div>

        <div className="p-4 border-t border-border shrink-0 space-y-2">
          <div className="flex gap-2">
            <button onClick={handleGenerate} disabled={!hasData}
              className="flex-1 text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              Generate Report
            </button>
            <button onClick={handleExportExcel} disabled={!hasData || exporting}
              className="flex-1 text-sm px-3 py-2 rounded-md border border-border hover:bg-black/5 disabled:opacity-50 transition-colors">
              {exporting ? 'Exporting…' : 'Export Excel'}
            </button>
          </div>
          {!hasData && (
            <p className="text-[11px] text-muted-foreground">No data available yet.</p>
          )}
          {exportError && <p className="text-[11px] text-red-600">{exportError}</p>}
        </div>
      </div>

      {reportData && <CombinedSignalsReportView data={reportData} />}
    </>
  )
}
