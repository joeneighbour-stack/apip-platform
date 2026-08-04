'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  type MetricsTrade, type MetricsPublication,
  computeSummary, cumulativeSeries, drawdownSeries, rollingWindows, monthlyMatrix,
  attributionBy, computeTradeStatistics, resultDistribution, triggeredTrades, isTriggeredWithResult,
} from '@/lib/metrics'
import {
  type AnalyticsFilterState, filtersFromSearchParams, filtersToSearchParams,
  filterTrades, filterPublications, describeUniverse,
} from '@/lib/analyticsFilters'
import { resolveDateRange, resolveComparisonRange, SINCE_INCEPTION_FLOOR } from '@/lib/dateRanges'
import { formatDate } from '@/lib/format'
import { AnalyticsFilters } from './AnalyticsFilters'
import { UniverseSummary } from './UniverseSummary'
import { PerformanceKpiStrip } from './PerformanceKpiStrip'
import { CumulativePerformanceChart } from './CumulativePerformanceChart'
import { DrawdownChart } from './DrawdownChart'
import { RollingPerformanceTable } from './RollingPerformanceTable'
import { MonthlyPerformanceMatrix } from './MonthlyPerformanceMatrix'
import { AttributionTable } from './AttributionTable'
import { ContributionChart } from './ContributionChart'
import { TradeStatistics } from './TradeStatistics'
import { BestWorstTrades } from './BestWorstTrades'
import { ReportBuilder } from './ReportBuilder'

interface Analyst { analyst_id: string; display_name: string; active: boolean }
interface Market { market_id: string; symbol: string; asset_class: string }

interface Props {
  analysts: Analyst[]
  markets: Market[]
}

export function AnalyticsPage({ analysts, markets }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [filters, setFilters] = useState<AnalyticsFilterState>(() => filtersFromSearchParams(searchParams))
  const [trades, setTrades] = useState<MetricsTrade[]>([])
  const [pubs, setPubs] = useState<MetricsPublication[]>([])
  const [loading, setLoading] = useState(true)
  const [reportOpen, setReportOpen] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/analytics/trades?from=${SINCE_INCEPTION_FLOOR}`).then(r => r.json()),
      fetch(`/api/analytics/publications?from=${SINCE_INCEPTION_FLOOR}`).then(r => r.json()),
    ]).then(([tradeRows, pubRows]) => {
      const normalisedTrades: MetricsTrade[] = (tradeRows ?? []).map((t: any) => ({
        analyst_id: t.analyst_id,
        market_id: t.market?.market_id ?? '',
        symbol: t.market?.symbol ?? 'Unknown',
        asset_class: t.market?.asset_class ?? 'Unknown',
        direction: t.direction,
        session: t.session ?? null,
        source_system: t.source_system,
        triggered: t.triggered,
        result_r: t.result_r,
        published_at: t.published_at,
        closed_at: t.closed_at,
      }))
      setTrades(normalisedTrades)
      setPubs(pubRows ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function updateFilters(next: AnalyticsFilterState) {
    setFilters(next)
    const params = filtersToSearchParams(next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const assetClassByMarketId = useMemo(() => new Map(markets.map(m => [m.market_id, m.asset_class])), [markets])
  const analystNameById = useMemo(() => new Map(analysts.map(a => [a.analyst_id, a.display_name])), [analysts])

  const today = new Date().toISOString().slice(0, 10)
  const dateRange = useMemo(() => resolveDateRange(filters.datePreset, filters.customStart ?? undefined, filters.customEnd ?? undefined), [filters])
  const comparison = useMemo(() => resolveComparisonRange(filters.datePreset, dateRange), [filters.datePreset, dateRange])
  const allTimeRange = useMemo(() => ({ start: SINCE_INCEPTION_FLOOR, end: today }), [today])

  // Current-period data (KPIs, cumulative/drawdown, attribution, trade stats, best/worst)
  const periodTrades = useMemo(() => filterTrades(trades, filters, dateRange), [trades, filters, dateRange])
  const periodPubs = useMemo(() => filterPublications(pubs, filters, dateRange, assetClassByMarketId), [pubs, filters, dateRange, assetClassByMarketId])

  // Comparison-period data
  const previousTrades = useMemo(() => comparison.range ? filterTrades(trades, filters, comparison.range) : null, [trades, filters, comparison.range])
  const previousPubs = useMemo(() => comparison.range ? filterPublications(pubs, filters, comparison.range, assetClassByMarketId) : [], [pubs, filters, comparison.range, assetClassByMarketId])

  // Consistency data (Rolling / Monthly) always looks across full history for the
  // other active filters, independent of the top date-range preset -- see lib/metrics
  // rollingWindows() comment.
  const historyTrades = useMemo(() => filterTrades(trades, filters, allTimeRange), [trades, filters, allTimeRange])

  const summary = useMemo(() => computeSummary(periodTrades, periodPubs), [periodTrades, periodPubs])
  const previousSummary = useMemo(() => previousTrades ? computeSummary(previousTrades, previousPubs) : null, [previousTrades, previousPubs])
  const cumulative = useMemo(() => cumulativeSeries(periodTrades), [periodTrades])
  const drawdown = useMemo(() => drawdownSeries(periodTrades), [periodTrades])
  const rolling = useMemo(() => rollingWindows(historyTrades, new Date()), [historyTrades])
  const monthly = useMemo(() => monthlyMatrix(historyTrades), [historyTrades])
  const tradeStats = useMemo(() => computeTradeStatistics(periodTrades, periodPubs), [periodTrades, periodPubs])
  const distribution = useMemo(() => resultDistribution(periodTrades), [periodTrades])

  const byAnalyst = useMemo(() => attributionBy(periodTrades, t => ({ key: t.analyst_id, label: analystNameById.get(t.analyst_id) ?? 'Unknown' })), [periodTrades, analystNameById])
  const byAssetClass = useMemo(() => attributionBy(periodTrades, t => ({ key: t.asset_class, label: t.asset_class })), [periodTrades])
  const byMarket = useMemo(() => attributionBy(periodTrades, t => ({ key: t.market_id, label: t.symbol })), [periodTrades])

  const bestWorst = useMemo(() => {
    const triggered = triggeredTrades(periodTrades).filter(isTriggeredWithResult)
    const sorted = [...triggered].sort((a, b) => (b.result_r ?? 0) - (a.result_r ?? 0))
    const toRow = (t: MetricsTrade) => ({
      date: t.published_at.slice(0, 10), symbol: t.symbol,
      analystName: analystNameById.get(t.analyst_id) ?? 'Unknown', direction: t.direction, resultR: t.result_r ?? 0,
    })
    return { best: sorted.slice(0, 10).map(toRow), worst: sorted.slice(-10).reverse().map(toRow) }
  }, [periodTrades, analystNameById])

  const universe = useMemo(() => describeUniverse(filters, dateRange, markets, analysts), [filters, dateRange, markets, analysts])

  const dataThroughDate = useMemo(() => {
    if (trades.length === 0) return formatDate(today)
    const latest = trades.reduce((max, t) => t.published_at > max ? t.published_at : max, trades[0]!.published_at)
    return formatDate(latest.slice(0, 10))
  }, [trades, today])

  if (loading) {
    return (
      <div className="rounded-lg border border-border p-12 text-center space-y-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground">Loading performance data...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 print:hidden">
      <AnalyticsFilters filters={filters} onChange={updateFilters} analysts={analysts} markets={markets} />

      <div className="flex items-start justify-between gap-4">
        <UniverseSummary
          title={universe.title} periodLabel={universe.periodLabel} segments={universe.segments}
          analystSegment={universe.analystSegment} redactAnalysts={false}
          tradeCount={triggeredTrades(periodTrades).length}
        />
        <button onClick={() => setReportOpen(true)}
          className="shrink-0 text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
          Generate Report
        </button>
      </div>

      <PerformanceKpiStrip summary={summary} previous={previousSummary} comparisonLabel={comparison.label} />

      <CumulativePerformanceChart data={cumulative} />
      <DrawdownChart data={drawdown} />

      <RollingPerformanceTable rows={rolling} />
      <MonthlyPerformanceMatrix rows={monthly} />

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Performance Attribution</h2>
        <AttributionTable title="By Analyst" rows={byAnalyst} />
        <AttributionTable title="By Asset Class" rows={byAssetClass} />
        <AttributionTable title="By Market" rows={byMarket} />
      </section>

      <ContributionChart title="Contribution by Market" rows={byMarket} />

      <TradeStatistics stats={tradeStats} distribution={distribution} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Best / Worst Performance</h2>
        <BestWorstTrades best={bestWorst.best} worst={bestWorst.worst} />
      </section>

      {reportOpen && (
        <ReportBuilder
          trades={periodTrades} pubs={periodPubs}
          previousTrades={previousTrades} previousPubs={previousPubs}
          dateRange={dateRange} comparisonLabel={comparison.label}
          defaultTitle={universe.title}
          defaultSubtitle={universe.segments.join(' • ')}
          dataThroughDate={dataThroughDate}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  )
}
