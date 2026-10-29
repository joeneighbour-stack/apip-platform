'use client'
import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import {
  type MetricsTrade, type AttributionRow, type CumulativePoint, type DrawdownPoint,
  type RollingRow, type MonthlyMatrixRow, type FullBreakdownRow, type FullBreakdownGroup,
  totalR, winRate, triggeredTrades, profitFactor, maxDrawdown, cumulativeSeries, drawdownSeries,
  rollingWindows, monthlyMatrix, attributionBy, rankAttribution, computeTradeStatistics, bestWorstTrades,
  MIN_TRADES_FOR_MARKET_RANKING, fullBreakdownBy, fullBreakdownGrouped, fullBreakdownRow,
} from '@/lib/metrics'
import { FAMILY_LABELS, LOW_SAMPLE_THRESHOLD, type PatternSummary, type PatternTradePoint } from '@/lib/patternAnalytics'
import { normaliseSymbol } from '@/lib/symbolNormalization'
import type { ReportSafeUniverse, ReportSafeTrade } from '@/lib/reportSanitiser'
import { COMPANY_NAME, FCA_REGULATORY_STATEMENT, DISCLAIMER_PARAGRAPHS, PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import { formatR, formatPercent, formatDate } from '@/lib/format'
import { type PatternFilterState, hasActivePatternFilters } from '@/lib/analyticsFilters'
import { DATE_PRESET_OPTIONS } from '@/lib/dateRanges'
import { downloadPatternWorkbook, type AssetSummaryRow } from '@/lib/patternExcelExport'
import { ReportHeader } from './report/ReportHeader'
import { ReportFooter } from './report/ReportFooter'
import { ReportBestPerformers } from './report/ReportBestPerformers'
import { CumulativePerformanceChart } from './CumulativePerformanceChart'
import { DrawdownChart } from './DrawdownChart'
import { RollingPerformanceTable } from './RollingPerformanceTable'
import { MonthlyPerformanceMatrix } from './MonthlyPerformanceMatrix'
import { AttributionTable } from './AttributionTable'
import { ContributionChart } from './ContributionChart'
import { FullBreakdownTable, buildFlatBreakdownRows } from './report/FullBreakdownTable'

// A deliberately separate component from ReportBuilder/PerformanceReport (the internal
// analyst report) and from AiSignalsReportBuilder (the AI signal report): this report is
// an external, client-facing capability showcase for Acuity's pattern recognition
// system, not an operational performance record -- its structure is fixed (no section
// toggles, no title/subtitle editing, no presets). It now matches the internal Analyst
// report's depth (Rolling Performance, Monthly Matrix, Trade Statistics, a Drawdown
// chart, Best Performers, Best/Worst Markets) rather than the deliberately thinner,
// marketing-only version of an earlier revision of this file -- but it remains
// non-configurable and pattern-specific, so sharing one generic, checkbox-driven report
// component across all three reports would make it too easy for a future edit to one to
// leak into the others.

interface Props {
  trades: MetricsTrade[]
  // Pre-toAnalyticsTrade rows (still carrying `family`) -- needed for the Pattern
  // Summary / Asset x Pattern tables below, since PatternsTab.tsx's toAnalyticsTrade()
  // drops `family` entirely (it exists only to feed lib/metrics.ts's series/window
  // functions, which never read it). Same underlying filteredTrades as `trades`, so
  // totals from either reconcile exactly.
  rawTrades: PatternTradePoint[]
  summary: PatternSummary
  assetClassRows: AttributionRow[]
  // Currently-applied Patterns tab filters -- used only for the Excel export's header
  // block/filename (PDF-derived data.periodLabel already covers the date range, but
  // nothing in PatternReportData describes which asset class/direction/granularity
  // filters are active, since the PDF itself never displays that).
  filters: PatternFilterState
  onClose: () => void
}

// "All patterns, all assets, all markets" when no Patterns-tab filter is active (the
// most common case), otherwise a comma-joined list of the active segments -- same
// "describe what's actually scoped" approach as lib/analyticsFilters.ts's own
// describeUniverse(), kept local since this report is deliberately self-contained (see
// this file's own header comment on why it doesn't share logic with the other reports).
function describePatternFilters(filters: PatternFilterState): string {
  if (!hasActivePatternFilters(filters)) return 'None (full history, all patterns, all assets, all markets)'
  const segments: string[] = []
  const datePresetLabel = DATE_PRESET_OPTIONS.find(o => o.key === filters.datePreset)?.label
  if (filters.datePreset !== 'SINCE_INCEPTION' && datePresetLabel) segments.push(`Date: ${datePresetLabel}`)
  if (filters.patternTypes.length > 0) segments.push(`Pattern: ${filters.patternTypes.join(', ')}`)
  if (filters.assetClasses.length > 0) segments.push(`Asset Class: ${filters.assetClasses.join(', ')}`)
  if (filters.marketIds.length > 0) segments.push(`Markets: ${filters.marketIds.length} selected`)
  if (filters.directions.length > 0) segments.push(`Direction: ${filters.directions.join(', ')}`)
  if (filters.sessions.length > 0) segments.push(`Session: ${filters.sessions.join(', ')}`)
  if (filters.granularities.length > 0) segments.push(`Granularity: ${filters.granularities.join(', ')}`)
  return segments.join(' • ') || 'None (full history, all patterns, all assets, all markets)'
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function monthYear(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function toReportSafeTrade(t: MetricsTrade): ReportSafeTrade {
  return { date: t.published_at.slice(0, 10), symbol: t.symbol, direction: t.direction, resultR: t.result_r ?? 0 }
}

interface PatternAnalyticsTrade extends MetricsTrade {
  family: string | null
}

// Same triggered/result_r rule as PatternsTab.tsx's own toAnalyticsTrade() (so the new
// Pattern Summary / Asset x Pattern tables below reconcile exactly to the headline KPI
// tiles, which are computed from `trades` via that same rule) -- this version
// additionally keeps `family` and normalises `symbol` through SYMBOL_OVERRIDES so
// pattern-trade asset names (raw vendor symbols, e.g. "BTCUSD") match the Analyst
// report's canonical names (e.g. "Bitcoin"). Keyed and labelled by the normalised
// symbol so two raw symbols that happen to normalise to the same name merge into one
// row rather than appearing as separate assets.
function toNormalisedTrade(t: PatternTradePoint): PatternAnalyticsTrade {
  const symbol = normaliseSymbol(t.symbol)
  return {
    analyst_id: '', market_id: symbol, symbol, asset_class: t.asset_class ?? '',
    direction: (t.direction ?? '') as 'BUY' | 'SELL', session: null, source_system: '',
    triggered: t.triggered === true,
    result_r: t.triggered && t.rr !== null ? t.rr : null,
    published_at: t.published_at,
    closed_at: t.triggered ? t.exit_date : null,
    family: t.family,
  }
}

function familyLabel(family: string | null): string {
  if (!family) return 'Unknown'
  return FAMILY_LABELS[family] ?? family
}

// Fixed R-multiple buckets for the Winner/Loser Distribution chart -- unlike
// lib/metrics.ts's own resultDistribution() (which derives bucket edges from the
// data's own min/max in fixed 1R steps, used by the internal Analyst report), this
// report uses a fixed, always-the-same six-bucket scale so the chart reads identically
// report to report regardless of how wide this particular filtered slice's R range is.
interface RDistributionBucket {
  label: string
  count: number
  isNegative: boolean
}

const R_DISTRIBUTION_RANGES: { label: string; min: number; max: number }[] = [
  { label: '< -2R', min: -Infinity, max: -2 },
  { label: '-2R to -1R', min: -2, max: -1 },
  { label: '-1R to 0R', min: -1, max: 0 },
  { label: '0R to 1R', min: 0, max: 1 },
  { label: '1R to 2R', min: 1, max: 2 },
  { label: '> 2R', min: 2, max: Infinity },
]

function buildRDistribution(trades: MetricsTrade[]): RDistributionBucket[] {
  const values = triggeredTrades(trades).map(t => t.result_r ?? 0)
  return R_DISTRIBUTION_RANGES.map(range => ({
    label: range.label,
    count: values.filter(v => v >= range.min && v < range.max).length,
    isNegative: range.max <= 0,
  }))
}

// Combines lib/metrics.ts's computeTradeStatistics() (Avg Winner/Loser R, Profit Factor,
// Avg Duration -- all derived purely from `trades`) with fields PatternSummary already
// carries from lib/patternAnalytics.ts's own aggregate() formulas (Payout Ratio, BE Win
// Rate, Trigger Rate) -- computeTradeStatistics() has no payoutRatio/breakEvenWinRate
// fields at all (it's built for actual_trades + analyst_publications, which has a
// different reconciliation model), so those two come from `summary` instead. Trigger
// Rate is included here even though PatternsTab.tsx's own live KPI strip omits it
// (pattern trades are only ever published once already triggered, so this reads ~100%
// and carries no real signal) -- shown anyway since the report spec calls for it
// explicitly.
interface PatternTradeStats {
  avgWinner: number | null
  avgLoser: number | null
  profitFactor: number | null
  breakEvenWinRate: number | null
  payoutRatio: number | null
  avgDurationHours: number | null
  triggerRate: number | null
}

interface PatternReportData {
  periodLabel: string
  sinceLabel: string
  marketCount: number
  assetClassCount: number
  totalSignals: number
  totalR: number
  winRate: number | null
  profitFactor: number | null
  totalTrades: number
  avgWin: number | null
  avgLoss: number | null
  maxDrawdownR: number
  cumulative: CumulativePoint[]
  drawdown: DrawdownPoint[]
  rolling: RollingRow[]
  monthly: MonthlyMatrixRow[]
  assetClassRows: AttributionRow[]
  tradeStats: PatternTradeStats
  distribution: RDistributionBucket[]
  bestPerformers: ReportSafeTrade[]
  bestMarkets: AttributionRow[]
  worstMarkets: AttributionRow[]
  // Pattern Summary (flat, sorted by Total R desc), Asset Summary (flat, one row per
  // asset with its Asset Class), and Asset x Pattern (grouped by asset, sub-row per
  // pattern, asset subtotal) -- all three computed from the same normalised-symbol
  // trade set, all reconciling to breakdownGrandTotal, which in turn reconciles to
  // totalR/totalTrades above (same underlying rawTrades, same triggered/result_r rule
  // -- see toNormalisedTrade()). Rendered in the PDF (Pattern Summary only) and in the
  // Excel export (all three, see lib/patternExcelExport.ts).
  patternSummaryRows: FullBreakdownRow[]
  assetSummaryRows: AssetSummaryRow[]
  assetPatternGroups: FullBreakdownGroup[]
  breakdownGrandTotal: FullBreakdownRow
  dataThroughDate: string
}

function buildReportData(
  trades: MetricsTrade[], rawTrades: PatternTradePoint[], summary: PatternSummary, assetClassRows: AttributionRow[],
): PatternReportData {
  const dates = trades.map(t => t.published_at.slice(0, 10)).filter(Boolean).sort()
  const earliest = dates[0] ?? null
  const latest = dates[dates.length - 1] ?? null
  const periodLabel = earliest && latest ? `${monthYear(earliest)} – ${monthYear(latest)}` : 'No data available'
  const sinceLabel = earliest ? monthYear(earliest) : 'inception'

  const marketCount = new Set(trades.map(t => t.symbol).filter(Boolean)).size
  const assetClassCount = new Set(trades.map(t => t.asset_class).filter(Boolean)).size

  const visibleAssetClassRows = assetClassRows.filter(r => r.trades > 0)

  // pubs is passed as [] -- computeTradeStatistics() only reads publication rows for its
  // own triggerRate/generated/triggered/expired fields (none of which are used below;
  // Trigger Rate here comes from `summary` instead, see PatternTradeStats' own comment),
  // every other field it returns (avgWinner/avgLoser/profitFactor/avgDurationHours) is
  // derived purely from `trades`.
  const rawStats = computeTradeStatistics(trades, [])
  const tradeStats: PatternTradeStats = {
    avgWinner: rawStats.avgWinner,
    avgLoser: rawStats.avgLoser,
    profitFactor: rawStats.profitFactor,
    breakEvenWinRate: summary.breakEvenWinRate,
    payoutRatio: summary.payoutRatio,
    avgDurationHours: rawStats.avgDurationHours,
    triggerRate: summary.triggerRate,
  }

  const byMarket = attributionBy(trades, t => ({ key: t.symbol, label: t.symbol }))
  const bestMarkets = rankAttribution(byMarket, MIN_TRADES_FOR_MARKET_RANKING, 'best', 10)
  const worstMarkets = rankAttribution(byMarket, MIN_TRADES_FOR_MARKET_RANKING, 'worst', 10)

  const { best: bestPerformerTrades } = bestWorstTrades(trades, 10)

  const pf = profitFactor(trades)

  const normalisedTrades = rawTrades.map(toNormalisedTrade)
  const patternSummaryRows = fullBreakdownBy(normalisedTrades, t => ({ key: t.family ?? 'UNKNOWN', label: familyLabel(t.family) }))
  const assetPatternGroups = fullBreakdownGrouped(
    normalisedTrades,
    t => ({ key: t.symbol, label: t.symbol }),
    t => ({ key: t.family ?? 'UNKNOWN', label: familyLabel(t.family) }),
  )
  const breakdownGrandTotal = fullBreakdownRow(normalisedTrades, 'GRAND_TOTAL', 'Grand Total')

  // Asset Summary (Excel-only): one row per normalised symbol, with that symbol's
  // asset class attached -- fullBreakdownBy() only groups/labels by the key given
  // (symbol here), so asset_class is looked up separately via the first trade seen for
  // each symbol (a given normalised symbol maps to exactly one asset class in
  // practice, confirmed against live data during the original breakdown-feature work).
  const assetClassBySymbol = new Map<string, string>()
  for (const t of normalisedTrades) {
    if (!assetClassBySymbol.has(t.symbol)) assetClassBySymbol.set(t.symbol, t.asset_class || 'Unknown')
  }
  const assetSummaryRows: AssetSummaryRow[] = fullBreakdownBy(normalisedTrades, t => ({ key: t.symbol, label: t.symbol }))
    .map(row => ({ ...row, assetClass: assetClassBySymbol.get(row.key) ?? 'Unknown' }))

  return {
    periodLabel,
    sinceLabel,
    marketCount,
    assetClassCount,
    totalSignals: summary.totalPatterns,
    totalR: round2(totalR(trades)),
    winRate: winRate(trades),
    profitFactor: pf !== null ? round2(pf) : null,
    totalTrades: triggeredTrades(trades).length,
    avgWin: rawStats.avgWinner,
    avgLoss: rawStats.avgLoser,
    maxDrawdownR: maxDrawdown(trades).value,
    cumulative: cumulativeSeries(trades),
    drawdown: drawdownSeries(trades),
    rolling: rollingWindows(trades, new Date()),
    monthly: monthlyMatrix(trades),
    assetClassRows: visibleAssetClassRows,
    tradeStats,
    distribution: buildRDistribution(trades),
    bestPerformers: bestPerformerTrades.map(toReportSafeTrade),
    bestMarkets,
    worstMarkets,
    patternSummaryRows,
    assetSummaryRows,
    assetPatternGroups,
    breakdownGrandTotal,
    dataThroughDate: latest ? formatDate(latest) : 'N/A',
  }
}

const KPI_TILES: { key: keyof PatternReportData; label: string; fmt: (v: any) => string }[] = [
  { key: 'totalR', label: 'Total R', fmt: formatR },
  { key: 'winRate', label: 'Win Rate', fmt: formatPercent },
  { key: 'profitFactor', label: 'Profit Factor', fmt: (v: number | null) => v !== null ? v.toFixed(2) : '—' },
  { key: 'totalTrades', label: 'Total Trades', fmt: (v: number) => v.toLocaleString() },
  { key: 'avgWin', label: 'Avg Win', fmt: formatR },
  { key: 'avgLoss', label: 'Avg Loss', fmt: formatR },
]

const TRADE_STAT_ROWS: { key: keyof PatternTradeStats; label: string; fmt: (v: number | null) => string }[] = [
  { key: 'avgWinner', label: 'Avg Winner R', fmt: formatR },
  { key: 'avgLoser', label: 'Avg Loser R', fmt: formatR },
  { key: 'profitFactor', label: 'Profit Factor', fmt: v => v !== null ? v.toFixed(2) : '—' },
  { key: 'breakEvenWinRate', label: 'BE Win Rate', fmt: formatPercent },
  { key: 'payoutRatio', label: 'Payout Ratio', fmt: v => v !== null ? v.toFixed(2) : '—' },
  { key: 'avgDurationHours', label: 'Avg Duration', fmt: v => v !== null ? `${v.toFixed(1)}h` : '—' },
  { key: 'triggerRate', label: 'Trigger Rate', fmt: formatPercent },
]

function TradeStatsPanel({ stats }: { stats: PatternTradeStats }) {
  return (
    <table className="w-full text-[9pt]" style={{ borderCollapse: 'collapse' }}>
      <tbody>
        {TRADE_STAT_ROWS.map(row => (
          <tr key={row.key} className="border-b border-black/10">
            <td className="py-1.5 pr-2 text-black/70">{row.label}</td>
            <td className="py-1.5 pl-2 text-right font-medium tabular-nums">{row.fmt(stats[row.key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function WinnerLoserDistributionChart({ buckets }: { buckets: RDistributionBucket[] }) {
  if (buckets.every(b => b.count === 0)) {
    return <p className="text-[8.5pt] text-black/50">No closed signals for the current filters.</p>
  }
  return (
    <div style={{ height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <XAxis dataKey="label" tick={{ fontSize: 8 }} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} width={26} />
          <Tooltip formatter={(v: any) => [v, 'Signals']} contentStyle={{ fontSize: 10 }} />
          <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {buckets.map((b, i) => <Cell key={i} fill={b.isNegative ? '#ef4444' : '#22c55e'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
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
      {/* PAGE 1 -- Cover, Executive Summary, Cumulative Performance & Drawdown. Both
          charts are placed side by side (not stacked) at an explicit reduced height so
          they fit alongside the KPI strip on one page -- same override mechanism
          AiSignalsReportBuilder.tsx uses for its own two-chart page. */}
      <section className="break-after-page p-2">
        <ReportHeader universe={headerUniverse} />
        <p className="mt-1 mb-4 text-[9pt] font-medium border border-black/20 rounded px-3 py-2 bg-black/[0.03]">
          {PAST_PERFORMANCE_WARNING}
        </p>

        <div className="mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Executive Summary</h2>
          <div className="grid grid-cols-6 gap-2 mb-3">
            {KPI_TILES.map(tile => (
              <div key={tile.key} className="border border-black/15 rounded px-2 py-2">
                <p className="text-[7pt] text-black/60">{tile.label}</p>
                <p className="text-[12pt] font-semibold tabular-nums">{tile.fmt(data[tile.key])}</p>
              </div>
            ))}
          </div>
          <p className="text-[9pt] leading-relaxed">
            Acuity&rsquo;s pattern recognition engine has identified and tracked {data.totalSignals.toLocaleString()} chart
            patterns across {data.marketCount} markets and {data.assetClassCount} asset classes since {data.sinceLabel}.
            The following analysis reflects live signal performance tracked in real time.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <CumulativePerformanceChart data={data.cumulative} height={220} />
          <DrawdownChart data={data.drawdown} height={220} />
        </div>

        <ReportFooter pageLabel="Page 1" />
      </section>

      {/* PAGE 2 -- Rolling Performance & Monthly Performance Matrix. Rolling Performance
          uses lib/metrics.ts's date-window rollingWindows() (30D/90D/6M/1Y/Since
          Inception) -- the same function and component report/PerformanceReport.tsx
          itself uses -- rather than PatternsTab.tsx's own trade-COUNT rollingTradeWindows()
          helper, which exists only for that tab's live dashboard. */}
      <section className="break-after-page p-2">
        <div className="mb-4"><RollingPerformanceTable rows={data.rolling} /></div>
        <MonthlyPerformanceMatrix rows={data.monthly} />
        <ReportFooter pageLabel="Page 2" />
      </section>

      {/* PAGE 3 -- Performance & Contribution by Asset Class */}
      <section className="break-after-page p-2">
        <div className="mb-4">
          <AttributionTable title="By Asset Class" rows={data.assetClassRows} entityLabel="Asset classes" showMaxDD={false} />
        </div>
        <ContributionChart title="Contribution by Asset Class" rows={data.assetClassRows} />
        <ReportFooter pageLabel="Page 3" />
      </section>

      {/* PAGE 4 -- Trade Statistics, Winner/Loser Distribution, Best Performers */}
      <section className="break-after-page p-2">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Trade Statistics</h2>
            <TradeStatsPanel stats={data.tradeStats} />
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Winner / Loser Distribution</h2>
            <WinnerLoserDistributionChart buckets={data.distribution} />
          </div>
        </div>
        <ReportBestPerformers best={data.bestPerformers} />
        <ReportFooter pageLabel="Page 4" />
      </section>

      {/* PAGE 5 -- Best/Worst Performing Markets, same ranking rule (min.
          MIN_TRADES_FOR_MARKET_RANKING triggered trades) used everywhere else in the
          app for market-level best/worst lists. */}
      <section className="break-after-page p-2">
        <div className="space-y-4">
          <AttributionTable title={`Best Performing Markets (min ${MIN_TRADES_FOR_MARKET_RANKING} trades)`}
            rows={data.bestMarkets} showMaxDD={false} />
          <AttributionTable title={`Worst Performing Markets (min ${MIN_TRADES_FOR_MARKET_RANKING} trades)`}
            rows={data.worstMarkets} showMaxDD={false} />
        </div>
        <ReportFooter pageLabel="Page 5" />
      </section>

      {/* PAGE 5B -- Pattern Summary: one row per pattern type (family), flat, sorted by
          Total R descending, every pattern with >=1 triggered trade -- not a top/bottom
          N. Reconciles to the Executive Summary's Total R / Total Trades (same
          normalised-trade set, see toNormalisedTrade()). The Asset x Pattern breakdown
          (1,605 distinct normalised-symbol x family combinations at full history --
          checked against live data) used to run as a long appendix after this; moved to
          the Excel export instead so the PDF stays a short, client-ready document -- the
          note below points readers there. */}
      <section className="p-2">
        <FullBreakdownTable
          title="Pattern Summary"
          rows={[...buildFlatBreakdownRows(data.patternSummaryRows), { type: 'grand-total', row: data.breakdownGrandTotal }]}
        />
        <p className="mt-2 text-[8pt] text-black/60">
          Full breakdown by asset and pattern is provided in the accompanying Excel file.
        </p>
        <ReportFooter pageLabel="Page 6" />
      </section>

      {/* FINAL PAGE -- Methodology & Regulatory. FCA statement, disclaimer, sanctions
          line and past-performance warning are always rendered -- there is no toggle
          anywhere in this report that could omit them. This is the literal last
          section again now that the Asset x Pattern appendix has moved to the Excel
          export, so no trailing break-after-page is needed. */}
      <section className="p-2">
        <div className="text-[8.5pt] leading-relaxed text-black/80 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-black">Methodology, Risk &amp; Regulatory Information</h2>

          <div className="space-y-1">
            <h3 className="text-[9pt] font-semibold text-black">Methodology</h3>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>R (risk multiple) measures each signal&rsquo;s outcome relative to its initial risk. A result of +1R means the signal returned exactly its planned risk amount as profit. A result of -1R means the signal closed at its stop loss.</li>
              <li>Win rate reflects the percentage of closed signals (profit or loss) that were profitable. Expired signals — those that reached their expiry without triggering a close — are excluded from win rate calculations.</li>
              <li>All signals are generated algorithmically by Acuity&rsquo;s pattern recognition engine and tracked in real time from publication.</li>
              <li>Maximum drawdown over the period: {formatR(data.maxDrawdownR)}.</li>
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

export function PatternReportBuilder({ trades, rawTrades, summary, assetClassRows, filters, onClose }: Props) {
  const [reportData, setReportData] = useState<PatternReportData | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  function handleGenerate() {
    const data = buildReportData(trades, rawTrades, summary, assetClassRows)
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
      const data = buildReportData(trades, rawTrades, summary, assetClassRows)
      await downloadPatternWorkbook({
        reportName: 'Pattern Performance Report',
        dateRangeLabel: data.periodLabel,
        filterSummary: describePatternFilters(filters),
        patternSummaryRows: data.patternSummaryRows,
        assetSummaryRows: data.assetSummaryRows,
        assetPatternGroups: data.assetPatternGroups,
        grandTotal: data.breakdownGrandTotal,
        lowSampleThreshold: LOW_SAMPLE_THRESHOLD,
      })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to generate the Excel file.')
    } finally {
      setExporting(false)
    }
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
            summary, cumulative performance and drawdown, rolling and monthly performance, performance
            by asset class, trade statistics, and best/worst performing markets -- reflecting the
            filters currently applied on this tab.
          </p>
          <p>Pattern signals carry no analyst identity, so this report is safe to share externally.</p>
          <p>
            The PDF&rsquo;s Pattern Summary page points to a separate Excel export for the full
            breakdown by asset and pattern (Pattern Summary, Asset Summary, and Asset &times; Pattern
            sheets) -- use the Export Excel button below for that file.
          </p>
        </div>

        <div className="p-4 border-t border-border shrink-0 space-y-2">
          <div className="flex gap-2">
            <button onClick={handleGenerate} disabled={trades.length === 0}
              className="flex-1 text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              Generate Report
            </button>
            <button onClick={handleExportExcel} disabled={trades.length === 0 || exporting}
              className="flex-1 text-sm px-3 py-2 rounded-md border border-border hover:bg-black/5 disabled:opacity-50 transition-colors">
              {exporting ? 'Exporting…' : 'Export Excel'}
            </button>
          </div>
          {trades.length === 0 && (
            <p className="text-[11px] text-muted-foreground">No data for the current filters.</p>
          )}
          {exportError && (
            <p className="text-[11px] text-red-600">{exportError}</p>
          )}
        </div>
      </div>

      {reportData && <PatternPerformanceReportView data={reportData} />}
    </>
  )
}
