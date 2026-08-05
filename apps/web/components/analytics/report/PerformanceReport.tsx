import type { ReportData } from '@/lib/reportSanitiser'
import { MIN_TRADES_PER_ATTRIBUTION_ROW } from '@/lib/reportSanitiser'
import { MIN_TRADES_FOR_MARKET_RANKING } from '@/lib/metrics'
import { PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import { formatR, formatPercent } from '@/lib/format'
import { ReportHeader } from './ReportHeader'
import { ReportFooter } from './ReportFooter'
import { ReportDisclaimer } from './ReportDisclaimer'
import { ReportBestPerformers } from './ReportBestPerformers'
import { CumulativePerformanceChart } from '../CumulativePerformanceChart'
import { DrawdownChart } from '../DrawdownChart'
import { RollingPerformanceTable } from '../RollingPerformanceTable'
import { MonthlyPerformanceMatrix } from '../MonthlyPerformanceMatrix'
import { AttributionTable } from '../AttributionTable'
import { ContributionChart } from '../ContributionChart'
import { TradeStatistics } from '../TradeStatistics'

interface Props {
  data: ReportData
}

const DIMENSION_LABEL: Record<string, string> = {
  asset_class: 'By Asset Class',
  market: 'By Market',
  strategy: 'By Strategy',
}

const KPI_TILES: { key: keyof ReportData['summary']; label: string; fmt: (v: number | null) => string }[] = [
  { key: 'totalR', label: 'Total R', fmt: formatR },
  { key: 'maxDrawdown', label: 'Max Drawdown', fmt: formatR },
  { key: 'avgR', label: 'Avg R / Trade', fmt: formatR },
  { key: 'winRate', label: 'Win Rate', fmt: formatPercent },
  { key: 'triggeredCount', label: 'Triggered Trades', fmt: v => v === null ? '—' : v.toLocaleString() },
  { key: 'profitFactor', label: 'Profit Factor', fmt: v => v === null ? '—' : v.toFixed(2) },
]

// Rendered off-screen (not display:none) at all times so Recharts' ResponsiveContainer
// has real layout dimensions to measure well before printing -- a chart that only
// becomes visible at the moment window.print() fires risks rendering blank because
// ResizeObserver hasn't measured it yet. Flips into normal flow only under @media print.
//
// Page groupings are fixed (Overview / Consistency / Attribution & Contribution / Trade
// Detail / Disclaimer), independent of which sections the report author enabled -- each
// page is skipped only if every section that would appear on it is either disabled or has
// no data to show, never partially collapsed into a neighbouring page.
export function PerformanceReport({ data }: Props) {
  const dims = data.attributionDimensions

  const hasCumulative = data.sections.cumulativePerformance && data.cumulative.length > 0
  const hasDrawdown = data.sections.drawdown && data.drawdown.length > 0
  const hasRolling = data.sections.rollingPerformance && data.rolling.length > 0
  const hasMonthly = data.sections.monthlyPerformance && data.monthly.length > 0
  const hasAttribution = data.sections.attribution && dims.length > 0
  const hasContribution = data.sections.contribution && dims.length > 0
  const hasTradeStats = data.sections.tradeStatistics
  const hasBestWorst = data.sections.bestWorst

  return (
    <div className="absolute -left-[9999px] top-0 print:static print:left-auto w-[210mm] print:w-auto bg-white text-black text-[10pt] leading-snug">
      {/* PAGE 1 -- Performance Overview: Executive Summary, Cumulative Performance, Drawdown.
          The Acuity wordmark (via ReportHeader) appears here only -- it is not repeated on
          subsequent pages. */}
      <section className="break-after-page p-2">
        <ReportHeader universe={data.universe} />
        <p className="mt-1 mb-4 text-[9pt] font-medium border border-black/20 rounded px-3 py-2 bg-black/[0.03]">
          {PAST_PERFORMANCE_WARNING}
        </p>

        {data.sections.executiveSummary && (
          <div className="mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Executive Summary</h2>
            <div className="grid grid-cols-3 gap-2">
              {KPI_TILES.map(tile => (
                <div key={tile.key} className="border border-black/15 rounded px-2.5 py-2">
                  <p className="text-[7.5pt] text-black/60">{tile.label}</p>
                  <p className="text-[13pt] font-semibold tabular-nums">{tile.fmt(data.summary[tile.key] as number | null)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasCumulative && <div className="mb-3"><CumulativePerformanceChart data={data.cumulative} /></div>}
        {hasDrawdown && <div className="mb-3"><DrawdownChart data={data.drawdown} /></div>}

        <ReportFooter pageLabel="Page 1" />
      </section>

      {/* PAGE 2 -- Consistency: Rolling Performance, Monthly Performance Matrix */}
      {(hasRolling || hasMonthly) && (
        <section className="break-after-page p-2">
          {hasRolling && <div className="mb-4"><RollingPerformanceTable rows={data.rolling} /></div>}
          {hasMonthly && <MonthlyPerformanceMatrix rows={data.monthly} />}
          <ReportFooter pageLabel="Page 2" />
        </section>
      )}

      {/* PAGE 3 -- Attribution & Contribution, across every selected dimension */}
      {(hasAttribution || hasContribution) && (
        <section className="break-after-page p-2">
          {dims.map(dim => (
            <div key={dim} className="space-y-4 mb-4">
              {hasAttribution && (
                <AttributionTable title={DIMENSION_LABEL[dim] ?? dim} rows={data.attribution[dim] ?? []} minTrades={MIN_TRADES_PER_ATTRIBUTION_ROW} />
              )}
              {hasContribution && (
                <ContributionChart title={`Contribution ${DIMENSION_LABEL[dim] ?? dim}`} rows={data.contribution[dim] ?? []} />
              )}
            </div>
          ))}
          <ReportFooter pageLabel="Page 3" />
        </section>
      )}

      {/* PAGE 4 -- Trade Statistics, Best Performers */}
      {(hasTradeStats || hasBestWorst) && (
        <section className="break-after-page p-2">
          {hasTradeStats && <div className="mb-4"><TradeStatistics stats={data.tradeStats} distribution={data.distribution} /></div>}
          {hasBestWorst && data.bestWorst && (
            <div className="mb-4"><ReportBestPerformers best={data.bestWorst.best} /></div>
          )}
          {hasBestWorst && (
            <div className="grid grid-cols-2 gap-4">
              <AttributionTable title={`Best Performing Markets (min ${MIN_TRADES_FOR_MARKET_RANKING} trades)`}
                rows={data.bestMarkets} showMaxDD={false} />
              <AttributionTable title={`Worst Performing Markets (min ${MIN_TRADES_FOR_MARKET_RANKING} trades)`}
                rows={data.worstMarkets} showMaxDD={false} />
            </div>
          )}
          <ReportFooter pageLabel="Page 4" />
        </section>
      )}

      {/* FINAL PAGE -- Methodology, Risk & Regulatory. Always rendered: the FCA
          statement, disclaimer, sanctions line and past-performance warning are
          mandatory and not gated by any section toggle -- only the methodology
          bullet list within it responds to data.sections.methodology. */}
      <section className="p-2">
        <ReportDisclaimer universe={data.universe} showMethodology={data.sections.methodology} />
        <ReportFooter pageLabel="Final Page" />
      </section>
    </div>
  )
}
