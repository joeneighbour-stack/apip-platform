'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  type MetricsTrade, type MetricsPublication,
  computeSummary, cumulativeSeries, drawdownSeries, rollingWindows, monthlyMatrix,
  attributionBy, computeTradeStatistics, resultDistribution, triggeredTrades, bestWorstTrades,
  rankAttribution, MIN_TRADES_FOR_MARKET_RANKING,
} from '@/lib/metrics'
import {
  type AnalyticsFilterState, filtersFromSearchParams, filtersToSearchParams,
  filterTrades, filterPublications, describeUniverse,
} from '@/lib/analyticsFilters'
import { resolveDateRange, resolveComparisonRange, SINCE_INCEPTION_FLOOR } from '@/lib/dateRanges'
import { formatDate } from '@/lib/format'
import type { DefaultAnalyticsView } from '@/lib/analyticsCache'
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
import { BestPerformers } from './BestPerformers'
import { ReportBuilder } from './ReportBuilder'

interface Analyst { analyst_id: string; display_name: string; active: boolean }
interface Market { market_id: string; symbol: string; asset_class: string }

interface Props {
  analysts: Analyst[]
  markets: Market[]
  // When set, this view is permanently scoped to one analyst (the analyst-facing "My
  // Performance" page): the analyst filter is forced to this id and hidden, "By Analyst"
  // attribution is dropped (redundant with a single analyst), and the API requests carry
  // it explicitly so the server can validate it against the session -- see
  // /api/analytics/trades and /publications routes. Undefined for the management view.
  lockedAnalystId?: string
}

export function AnalyticsPage({ analysts, markets, lockedAnalystId }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [filters, setFilters] = useState<AnalyticsFilterState>(() => {
    const initial = filtersFromSearchParams(searchParams)
    return lockedAnalystId ? { ...initial, analystIds: [lockedAnalystId] } : initial
  })
  const [trades, setTrades] = useState<MetricsTrade[]>([])
  const [pubs, setPubs] = useState<MetricsPublication[]>([])
  const [rawDataLoaded, setRawDataLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reportOpen, setReportOpen] = useState(false)
  const [cachedView, setCachedView] = useState<DefaultAnalyticsView | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // "Since Inception / All Analysts / All Markets" with nothing else applied -- the one
  // view worth serving from the server-side cache (see lib/analyticsCache.ts). Never true
  // for the analyst-locked view: a locked analyst is itself a filter.
  const isDefaultView = !lockedAnalystId &&
    filters.datePreset === 'SINCE_INCEPTION' && filters.product === 'ALL' &&
    filters.analystIds.length === 0 && filters.assetClasses.length === 0 &&
    filters.marketIds.length === 0 && filters.directions.length === 0 &&
    filters.sessions.length === 0 && filters.triggerStatus === 'ALL'

  function normaliseTrades(tradeRows: any[]): MetricsTrade[] {
    return (tradeRows ?? []).map((t: any) => ({
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
  }

  function fetchRawData(): Promise<void> {
    const analystParam = lockedAnalystId ? `&analystId=${lockedAnalystId}` : ''
    return Promise.all([
      fetch(`/api/analytics/trades?from=${SINCE_INCEPTION_FLOOR}${analystParam}`).then(r => r.json()),
      fetch(`/api/analytics/publications?from=${SINCE_INCEPTION_FLOOR}${analystParam}`).then(r => r.json()),
    ]).then(([tradeRows, pubRows]) => {
      // A failed fetch (e.g. a 403 Forbidden body like { error: 'Forbidden' }) is truthy and
      // not null/undefined, so `?? []` alone doesn't catch it -- Array.isArray does.
      setTrades(normaliseTrades(Array.isArray(tradeRows) ? tradeRows : []))
      setPubs(Array.isArray(pubRows) ? pubRows : [])
      setRawDataLoaded(true)
    })
  }

  // On the default view: show the cheap pre-computed cache immediately (fast first paint
  // for "the most expensive query and most common access pattern"), then fetch the full
  // raw dataset in the background anyway -- not for this render, but so filtering/Report
  // Builder work instantly the moment the user touches a filter, instead of only starting
  // that fetch reactively once they do. On any other view, this is unchanged from before:
  // fetch raw and compute everything client-side.
  useEffect(() => {
    if (isDefaultView) {
      fetch('/api/analytics/summary').then(r => r.json()).then((data: DefaultAnalyticsView) => {
        setCachedView(data)
        setLoading(false)
      }).catch(() => setLoading(false))
      fetchRawData().catch(() => {})
    } else {
      fetchRawData().then(() => setLoading(false)).catch(() => setLoading(false))
    }
    // Intentionally runs once on mount only -- filtering below is all client-side against
    // the fetched dataset, matching the page's existing (pre-cache) behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateFilters(next: AnalyticsFilterState) {
    const locked = lockedAnalystId ? { ...next, analystIds: [lockedAnalystId] } : next
    setFilters(locked)
    const params = filtersToSearchParams(locked)
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

  const byAnalyst = useMemo(() => lockedAnalystId ? [] : attributionBy(periodTrades, t => ({ key: t.analyst_id, label: analystNameById.get(t.analyst_id) ?? 'Unknown' })), [periodTrades, analystNameById, lockedAnalystId])
  const byAssetClass = useMemo(() => attributionBy(periodTrades, t => ({ key: t.asset_class, label: t.asset_class })), [periodTrades])
  const byMarket = useMemo(() => attributionBy(periodTrades, t => ({ key: t.market_id, label: t.symbol })), [periodTrades])

  // A single trade's worst possible outcome is capped at -1R, so every stop-out ranks
  // equally -- individual "worst performer" trades carry no signal. Ranking markets by
  // aggregate Total R (with a real sample size) surfaces where performance is won/lost.
  const bestMarkets = useMemo(() => rankAttribution(byMarket, MIN_TRADES_FOR_MARKET_RANKING, 'best'), [byMarket])
  const worstMarkets = useMemo(() => rankAttribution(byMarket, MIN_TRADES_FOR_MARKET_RANKING, 'worst'), [byMarket])

  // Same minimum-sample rule as the market attribution table: a market with only a
  // couple of trades can produce an eye-catching single result that isn't a genuine
  // "best performer" signal, so a trade can't appear here unless its own market has hit
  // MIN_TRADES_FOR_MARKET_RANKING triggered trades in this period.
  const qualifyingMarketIds = useMemo(
    () => new Set(byMarket.filter(r => r.trades >= MIN_TRADES_FOR_MARKET_RANKING).map(r => r.key)),
    [byMarket]
  )
  const bestTrades = useMemo(() => {
    const qualifyingTrades = periodTrades.filter(t => qualifyingMarketIds.has(t.market_id))
    const { best } = bestWorstTrades(qualifyingTrades, 10)
    return best.map(t => ({
      date: t.published_at.slice(0, 10), symbol: t.symbol,
      analystName: analystNameById.get(t.analyst_id) ?? 'Unknown', direction: t.direction, resultR: t.result_r ?? 0,
    }))
  }, [periodTrades, qualifyingMarketIds, analystNameById])

  const universe = useMemo(() => describeUniverse(filters, dateRange, markets, analysts), [filters, dateRange, markets, analysts])

  const dataThroughDate = useMemo(() => {
    if (trades.length === 0) return formatDate(today)
    const latest = trades.reduce((max, t) => t.published_at > max ? t.published_at : max, trades[0]!.published_at)
    return formatDate(latest.slice(0, 10))
  }, [trades, today])

  // Only the default view can be served from cache, and only once it's actually arrived --
  // every other rendered value below falls back to the normal client-computed pipeline
  // above, completely unchanged, the moment any filter takes this out of the default state.
  const useCache = isDefaultView && cachedView !== null
  const displaySummary = useCache ? cachedView!.summary : summary
  const displayPrevious = useCache ? null : previousSummary
  const displayCumulative = useCache ? cachedView!.cumulative : cumulative
  const displayDrawdown = useCache ? cachedView!.drawdown : drawdown
  const displayRolling = useCache ? cachedView!.rolling : rolling
  const displayMonthly = useCache ? cachedView!.monthly : monthly
  const displayTradeStats = useCache ? cachedView!.tradeStats : tradeStats
  const displayDistribution = useCache ? cachedView!.distribution : distribution
  const displayByAnalyst = useCache ? cachedView!.byAnalyst : byAnalyst
  const displayByAssetClass = useCache ? cachedView!.byAssetClass : byAssetClass
  const displayByMarket = useCache ? cachedView!.byMarket : byMarket
  const displayBestMarkets = useCache ? cachedView!.bestMarkets : bestMarkets
  const displayWorstMarkets = useCache ? cachedView!.worstMarkets : worstMarkets
  const displayBestTrades = useCache ? cachedView!.bestTrades : bestTrades
  const displayUniverse = useCache ? cachedView!.universe : universe
  const displayTradeCount = useCache ? cachedView!.tradeCount : triggeredTrades(periodTrades).length

  const lastUpdatedLabel = useMemo(() => {
    if (!cachedView) return null
    const ms = Date.now() - new Date(cachedView.computedAt).getTime()
    const mins = Math.max(0, Math.round(ms / 60_000))
    if (mins < 1) return 'Last updated: just now'
    if (mins === 1) return 'Last updated: 1 minute ago'
    if (mins < 60) return `Last updated: ${mins} minutes ago`
    const hours = Math.round(mins / 60)
    return `Last updated: ${hours} hour${hours === 1 ? '' : 's'} ago`
  }, [cachedView])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const data = await fetch('/api/analytics/summary?force=true').then(r => r.json())
      setCachedView(data)
    } finally {
      setRefreshing(false)
    }
  }

  // Report Builder needs the raw trade/publication rows (it computes its own report-safe
  // projection from them), not the pre-aggregated cache -- fetch them now if the page
  // loaded straight into the cached default view and the background fetch hasn't landed yet.
  async function handleGenerateReport() {
    if (!rawDataLoaded) await fetchRawData().catch(() => {})
    setReportOpen(true)
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border p-12 text-center space-y-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground">Loading performance data...</p>
      </div>
    )
  }

  return (
    <>
    {/* print:hidden must be scoped to the dashboard chrome only -- ReportBuilder (and
        the PerformanceReport it mounts) is rendered as a sibling below, outside this
        div. A display:none ancestor can't be overridden by a descendant's print:static,
        so nesting the report inside a print:hidden wrapper would hide it under print
        media too (confirmed via Playwright print-media screenshot during verification). */}
    <div className="space-y-6 print:hidden">
      <AnalyticsFilters filters={filters} onChange={updateFilters} analysts={analysts} markets={markets} hideAnalystFilter={!!lockedAnalystId} />

      <div className="flex items-start justify-between gap-4">
        <UniverseSummary
          title={displayUniverse.title} periodLabel={displayUniverse.periodLabel} segments={displayUniverse.segments}
          analystSegment={displayUniverse.analystSegment} redactAnalysts={false}
          tradeCount={displayTradeCount}
        />
        <div className="flex shrink-0 items-center gap-3">
          {useCache && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{lastUpdatedLabel}</span>
              <button onClick={handleRefresh} disabled={refreshing}
                title="Bypass the cache and recompute now"
                className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-50 transition-colors">
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          )}
          <button onClick={handleGenerateReport}
            className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            Generate Report
          </button>
        </div>
      </div>

      <PerformanceKpiStrip summary={displaySummary} previous={displayPrevious} comparisonLabel={comparison.label} />

      <CumulativePerformanceChart data={displayCumulative} />
      <DrawdownChart data={displayDrawdown} />

      <RollingPerformanceTable rows={displayRolling} />
      <MonthlyPerformanceMatrix rows={displayMonthly} />

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Performance Attribution</h2>
        {!lockedAnalystId && <AttributionTable title="By Analyst" rows={displayByAnalyst} />}
        <AttributionTable title="By Asset Class" rows={displayByAssetClass} />
        <AttributionTable title="By Market" rows={displayByMarket} minTrades={10} entityLabel="Markets" />
      </section>

      <ContributionChart title="Contribution by Market" rows={displayByMarket} />

      <TradeStatistics stats={displayTradeStats} distribution={displayDistribution} />

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Best / Worst Performance</h2>
        <BestPerformers best={displayBestTrades} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AttributionTable title={`Best Performing Markets (min ${MIN_TRADES_FOR_MARKET_RANKING} trades)`}
            rows={displayBestMarkets} showMaxDD={false} />
          <AttributionTable title={`Worst Performing Markets (min ${MIN_TRADES_FOR_MARKET_RANKING} trades)`}
            rows={displayWorstMarkets} showMaxDD={false} />
        </div>
      </section>

    </div>

    {reportOpen && (
      <ReportBuilder
        trades={periodTrades} pubs={periodPubs} historyTrades={historyTrades}
        previousTrades={previousTrades} previousPubs={previousPubs}
        dateRange={dateRange} comparisonLabel={comparison.label}
        defaultTitle={universe.title}
        defaultSubtitle={universe.segments.join(' • ')}
        dataThroughDate={dataThroughDate}
        onClose={() => setReportOpen(false)}
      />
    )}
    </>
  )
}
