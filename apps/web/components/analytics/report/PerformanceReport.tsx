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
export function PerformanceReport({ data }: Props) {
  const dims = data.attributionDimensions
  const page2Dims = dims.slice(0, 1)
  const page3Dims = dims.slice(1)

  return (
    <div className="absolute -left-[9999px] top-0 print:static print:left-auto w-[210mm] print:w-auto bg-white text-black text-[10pt] leading-snug">
      {/* PAGE 1 -- Performance Overview */}
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

        {data.sections.cumulativePerformance && <div className="mb-3"><CumulativePerformanceChart data={data.cumulative} /></div>}
        {data.sections.drawdown && <div className="mb-3"><DrawdownChart data={data.drawdown} /></div>}
        {data.sections.rollingPerformance && <RollingPerformanceTable rows={data.rolling} />}

        <ReportFooter pageLabel="Page 1" />
      </section>

      {/* PAGE 2 -- Consistency & Attribution */}
      {(data.sections.monthlyPerformance || data.sections.contribution || (data.sections.attribution && page2Dims.length > 0)) && (
        <section className="break-after-page p-2">
          {data.sections.monthlyPerformance && <div className="mb-4"><MonthlyPerformanceMatrix rows={data.monthly} /></div>}
          {data.sections.contribution && page2Dims.map(dim => (
            <div key={dim} className="mb-4">
              <ContributionChart title={`Contribution ${DIMENSION_LABEL[dim] ?? dim}`} rows={data.contribution[dim] ?? []} />
            </div>
          ))}
          {data.sections.attribution && page2Dims.map(dim => (
            <div key={dim} className="mb-4">
              <AttributionTable title={DIMENSION_LABEL[dim] ?? dim} rows={data.attribution[dim] ?? []} minTrades={MIN_TRADES_PER_ATTRIBUTION_ROW} />
            </div>
          ))}
          <ReportFooter pageLabel="Page 2" />
        </section>
      )}

      {/* PAGE 3 -- Detailed Analysis */}
      {(page3Dims.length > 0 || data.sections.tradeStatistics || data.sections.bestWorst) && (
        <section className="break-after-page p-2">
          {data.sections.attribution && page3Dims.map(dim => (
            <div key={dim} className="mb-4">
              <AttributionTable title={DIMENSION_LABEL[dim] ?? dim} rows={data.attribution[dim] ?? []} minTrades={MIN_TRADES_PER_ATTRIBUTION_ROW} />
            </div>
          ))}
          {data.sections.tradeStatistics && <div className="mb-4"><TradeStatistics stats={data.tradeStats} distribution={data.distribution} /></div>}
          {data.sections.bestWorst && data.bestWorst && (
            <div className="mb-4"><ReportBestPerformers best={data.bestWorst.best} /></div>
          )}
          {data.sections.bestWorst && (
            <div className="grid grid-cols-2 gap-4">
              <AttributionTable title={`Best Performing Markets (min ${MIN_TRADES_FOR_MARKET_RANKING} trades)`}
                rows={data.bestMarkets} showMaxDD={false} />
              <AttributionTable title={`Worst Performing Markets (min ${MIN_TRADES_FOR_MARKET_RANKING} trades)`}
                rows={data.worstMarkets} showMaxDD={false} />
            </div>
          )}
          <ReportFooter pageLabel="Page 3" />
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
