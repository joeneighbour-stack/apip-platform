'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
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
import { CumulativePerformanceChart, DrawdownChart, ContributionChart, TradeStatistics } from './LazyCharts'
import { RollingPerformanceTable } from './RollingPerformanceTable'
import { MonthlyPerformanceMatrix } from './MonthlyPerformanceMatrix'
import { AttributionTable } from './AttributionTable'
import { BestPerformers } from './BestPerformers'
import { PatternsTab } from './PatternsTab'
import { AiSignalsTab } from './AiSignalsTab'
import { CombinedSignalsTab } from './CombinedSignalsTab'

// ReportBuilder mounts report/PerformanceReport.tsx, which pulls in a second copy of
// the four recharts components above -- dynamic-importing it here keeps that whole
// subtree (recharts included) out of the initial bundle, since it only ever renders
// after the user clicks "Generate Report" (reportOpen below). ssr:false is safe: this
// file is already a Client Component, and ReportBuilder has no server-rendered role.
const ReportBuilder = dynamic(() => import('./ReportBuilder').then(m => ({ default: m.ReportBuilder })), {
  ssr: false,
})

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

  // Patterns and AI Signals tabs are independent of everything below -- each has its
  // own component doing its own fetch (pattern_trades / ai_trades, via
  // /api/analytics/patterns and /api/analytics/ai-signals respectively), unrelated to
  // the trades/publications data this page otherwise loads. Rendered outside the
  // loading/error short-circuits below so switching to either works regardless of
  // the Performance tab's own fetch state.
  const [pageTab, setPageTab] = useState<'PERFORMANCE' | 'PATTERNS' | 'AI_SIGNALS' | 'ALL_SIGNALS'>('PERFORMANCE')

  const [filters, setFilters] = useState<AnalyticsFilterState>(() => {
    const initial = filtersFromSearchParams(searchParams)
    return lockedAnalystId ? { ...initial, analystIds: [lockedAnalystId] } : initial
  })
  const [trades, setTrades] = useState<MetricsTrade[]>([])
  const [pubs, setPubs] = useState<MetricsPublication[]>([])
  const [rawDataLoaded, setRawDataLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [cachedView, setCachedView] = useState<DefaultAnalyticsView | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // "Since Inception / All Analysts / All Markets" with nothing else applied -- the one
  // view worth serving from the server-side cache (see lib/analyticsCache.ts). Never true
  // for the analyst-locked view: a locked analyst is itself a filter.
  const isDefaultView = !lockedAnalystId &&
    filters.datePreset === 'SINCE_INCEPTION' &&
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
      // A failed fetch (e.g. a 403 Forbidden body, or a 502 from the pagination helper
      // giving up after retries -- see lib/paginatedFetch.ts) returns a truthy, non-array
      // body like { error: '...' }. Previously this silently became an empty dataset via
      // `?? []`/Array.isArray fallbacks, which let a failed fetch render as "zero trades"
      // instead of surfacing the failure -- exactly the silent-truncation bug that fix
      // replaced server-side. Throwing here instead means every caller's existing
      // .catch() (loadData, updateFilters, handleGenerateReport) now actually fires and
      // shows an error instead of rendering a report or dashboard from partial/empty data.
      if (!Array.isArray(tradeRows)) {
        throw new Error(typeof tradeRows?.error === 'string' ? tradeRows.error : 'Failed to load trade data')
      }
      if (!Array.isArray(pubRows)) {
        throw new Error(typeof pubRows?.error === 'string' ? pubRows.error : 'Failed to load publication data')
      }
      setTrades(normaliseTrades(tradeRows))
      setPubs(pubRows)
      setRawDataLoaded(true)
    })
  }

  // On the default view: show the cheap pre-computed cache immediately (fast first paint
  // for "the most expensive query and most common access pattern") and stop there -- the
  // 21MB raw trade/publication dataset is only needed once the user actually applies a
  // filter or opens Report Builder, so it's fetched lazily then instead (see updateFilters
  // and handleGenerateReport below), not on every default-view load. On any other view (a
  // filter is already active via URL params, or this is the analyst-locked view, which can
  // never use the cache), this is unchanged: fetch raw and compute everything client-side.
  // Shared by the mount effect below and the error state's "Try again" button -- checks
  // isDefaultView fresh each call, so a retry after a filter's already been applied
  // correctly re-fetches raw data instead of re-fetching the (no longer relevant) cache.
  function loadData() {
    if (isDefaultView) {
      fetch('/api/analytics/summary').then(r => r.json()).then((data: DefaultAnalyticsView) => {
        setCachedView(data)
        setLoading(false)
      }).catch(() => {
        setError('Failed to load analytics. Please refresh the page.')
        setLoading(false)
      })
    } else {
      fetchRawData().then(() => setLoading(false)).catch(() => {
        setError('Failed to load trade data. Please refresh the page.')
        setLoading(false)
      })
    }
  }

  useEffect(() => {
    loadData()
    // Intentionally runs once on mount only -- filtering below is all client-side against
    // the fetched dataset, matching the page's existing (pre-cache) behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateFilters(next: AnalyticsFilterState) {
    const locked = lockedAnalystId ? { ...next, analystIds: [lockedAnalystId] } : next
    setFilters(locked)
    const params = filtersToSearchParams(locked)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })

    // Lazy-load raw data the first time a filter is applied on the default view --
    // subsequent filter changes reuse it. The locked-analyst view never hits this: it
    // already fetched raw data on mount above (isDefaultView is always false there), so
    // rawDataLoaded is already true by the time any filter runs.
    if (!rawDataLoaded && !lockedAnalystId) {
      setLoading(true)
      fetchRawData().then(() => setLoading(false)).catch(() => {
        setError('Failed to load trade data. Please refresh the page.')
        setLoading(false)
      })
    }
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
      const res = await fetch('/api/analytics/summary?force=true')
      const data = await res.json()
      if (!res.ok || (data && typeof data === 'object' && 'error' in data)) {
        setError(typeof data?.error === 'string' ? data.error : 'Failed to refresh analytics.')
        return
      }
      setCachedView(data)
    } catch {
      setError('Failed to refresh analytics.')
    } finally {
      setRefreshing(false)
    }
  }

  // Report Builder needs the raw trade/publication rows (it computes its own report-safe
  // projection from them), not the pre-aggregated cache -- fetch them now if the page
  // loaded straight into the cached default view and the background fetch hasn't landed yet.
  // If that fetch fails, the report must NOT open against stale/empty state -- show the
  // error instead (same refusal as the PDF-generation requirement this satisfies).
  async function handleGenerateReport() {
    if (!rawDataLoaded) {
      try {
        await fetchRawData()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load trade data. Please refresh the page.')
        return
      }
    }
    setReportOpen(true)
  }

  // Patterns and AI Signals are management-only tabs: pattern_trades/ai_trades have no
  // ANALYST RLS grant at all (migrations/065_pattern_trades.sql, 066_ai_trades.sql --
  // ADMIN/MANAGER/RESEARCH only), and this same AnalyticsPage component is also
  // rendered for the analyst-facing "My Performance" page with lockedAnalystId set (see
  // that prop's own comment). Both tabs (and the ability to ever reach either branch
  // below) only exist when lockedAnalystId is unset -- the management view.
  const showManagementTabs = !lockedAnalystId

  // Styled to match ShadowMonitoringPanel.tsx's border-b-2/-mb-px underline tab
  // pattern -- the existing convention elsewhere in the management dashboard for
  // this exact "outer tab spanning otherwise-separate sections" shape.
  const tabBar = showManagementTabs ? (
    <div className="flex items-center gap-1 border-b border-border print:hidden">
      <button
        onClick={() => setPageTab('PERFORMANCE')}
        className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
          pageTab === 'PERFORMANCE'
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        Analyst Signals
      </button>
      <button
        onClick={() => setPageTab('PATTERNS')}
        className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
          pageTab === 'PATTERNS'
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        Patterns
      </button>
      <button
        onClick={() => setPageTab('AI_SIGNALS')}
        className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
          pageTab === 'AI_SIGNALS'
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        AI Signals
      </button>
      <button
        onClick={() => setPageTab('ALL_SIGNALS')}
        className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
          pageTab === 'ALL_SIGNALS'
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        All Signals
      </button>
    </div>
  ) : null

  if (showManagementTabs && pageTab === 'PATTERNS') {
    // PatternsTab manages its own print:hidden scoping internally (its Report Builder/
    // PerformanceReport must render outside any print:hidden ancestor -- see its own
    // comment) -- only tabBar, not PatternsTab itself, is wrapped here.
    return (
      <div className="space-y-6">
        <div className="print:hidden">{tabBar}</div>
        <PatternsTab />
      </div>
    )
  }

  if (showManagementTabs && pageTab === 'AI_SIGNALS') {
    // AiSignalsTab manages its own print:hidden scoping internally (its Report Builder/
    // print layout must render outside any print:hidden ancestor -- see its own
    // comment, same as PatternsTab's) -- only tabBar, not AiSignalsTab itself, is
    // wrapped here.
    return (
      <div className="space-y-6">
        <div className="print:hidden">{tabBar}</div>
        <AiSignalsTab />
      </div>
    )
  }

  if (showManagementTabs && pageTab === 'ALL_SIGNALS') {
    // Same print:hidden scoping as the Patterns/AI Signals branches above --
    // CombinedSignalsTab manages it internally for its own Report Builder.
    return (
      <div className="space-y-6">
        <div className="print:hidden">{tabBar}</div>
        <CombinedSignalsTab analysts={analysts} />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6 print:hidden">
        {tabBar}
        <div className="rounded-lg border border-border p-12 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">
            {!rawDataLoaded && !isDefaultView ? 'Loading trade data for filtering...' : 'Loading performance data...'}
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6 print:hidden">
        {tabBar}
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => { setError(null); setLoading(true); loadData() }}
            className="mt-2 text-xs text-red-600 underline">
            Try again
          </button>
        </div>
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
      {tabBar}
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
        // Fix: with no asset-class/market filter active (the default "since inception,
        // everything" view), universe.segments is [] -- describeUniverse() only ever
        // pushes a segment when that specific filter is active (lib/analyticsFilters.ts).
        // An empty join('') leaves both the report's subtitle AND filterSummary (which
        // is just subtitle, see ReportBuilder.tsx's handleGenerate()) blank, which
        // reportSanitiser.ts then rejects outright ("Report universe description is
        // missing") -- confirmed live: Generate Report was completely blocked for the
        // single most common case, a no-filter report. Falls back to stating the (also
        // real) unfiltered scope explicitly instead of leaving it blank.
        defaultSubtitle={universe.segments.length > 0 ? universe.segments.join(' • ') : 'All Asset Classes • All Markets'}
        dataThroughDate={dataThroughDate}
        onClose={() => setReportOpen(false)}
      />
    )}
    </>
  )
}
