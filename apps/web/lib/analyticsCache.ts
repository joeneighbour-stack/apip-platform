// Server-side cache for the Analytics page's "default view" -- Since Inception, all
// analysts, all markets, no other filters. This is the single most expensive query the
// page makes (30,000+ trades, 40,000+ publications, fully recomputed) and per product the
// most common thing anyone actually loads, so it's the only view worth caching: every
// other filter combination is smaller and rarer, and stays on the existing fetch-and-
// compute-on-the-client path (see AnalyticsPage.tsx).
import { unstable_cache } from 'next/cache'
import { createAdminClient } from './supabase/server'
import { SINCE_INCEPTION_FLOOR } from './dateRanges'
import { describeUniverse, DEFAULT_FILTERS, type AnalyticsFilterState } from './analyticsFilters'
import {
  type MetricsTrade, type MetricsPublication,
  computeSummary, cumulativeSeries, drawdownSeries, rollingWindows, monthlyMatrix,
  attributionBy, computeTradeStatistics, resultDistribution, bestWorstTrades,
  rankAttribution, MIN_TRADES_FOR_MARKET_RANKING,
} from './metrics'

const CACHE_TAG = 'analytics-default-view'

async function fetchAllTrades(): Promise<any[]> {
  const db = createAdminClient()
  const FIELDS = `trade_id, analyst_id, direction, result_r,
    triggered, published_at, closed_at, source_system, session,
    market:market_id ( market_id, symbol, asset_class )`
  const all: any[] = []
  let page = 0, hasMore = true
  while (hasMore) {
    const { data } = await db.from('actual_trades').select(FIELDS)
      .gte('published_at', SINCE_INCEPTION_FLOOR + 'T00:00:00Z')
      .order('published_at', { ascending: false })
      .order('trade_id', { ascending: false })
      .range(page * 1000, page * 1000 + 999)
    if (!data?.length) { hasMore = false } else { all.push(...data); hasMore = data.length === 1000; page++ }
    if (all.length >= 150_000) break
  }
  return all
}

async function fetchAllPublications(): Promise<any[]> {
  const db = createAdminClient()
  const all: any[] = []
  let page = 0, hasMore = true
  while (hasMore) {
    const { data } = await db.from('analyst_publications')
      .select('analyst_id, market_id, published_at, reconciliation_status')
      .eq('source_system', 'ACUITY_PERFORMANCE_API')
      .gte('published_at', SINCE_INCEPTION_FLOOR + 'T00:00:00Z')
      .order('published_at', { ascending: false })
      .order('publication_id', { ascending: false })
      .range(page * 1000, page * 1000 + 999)
    if (!data?.length) { hasMore = false } else { all.push(...data); hasMore = data.length === 1000; page++ }
    if (all.length >= 150_000) break
  }
  return all
}

// Not cached itself -- called both directly (force-refresh) and through the
// unstable_cache wrapper below (normal path).
async function computeDefaultAnalyticsView() {
  const db = createAdminClient()
  const [rawTrades, rawPubs, analystsRes, marketsRes] = await Promise.all([
    fetchAllTrades(),
    fetchAllPublications(),
    db.from('analysts').select('analyst_id, display_name, active').order('display_name'),
    db.from('markets').select('market_id, symbol, asset_class').order('asset_class, symbol'),
  ])
  const analysts = (analystsRes.data as any[]) ?? []
  const markets = (marketsRes.data as any[]) ?? []
  const analystNameById = new Map(analysts.map(a => [a.analyst_id, a.display_name]))

  const trades: MetricsTrade[] = rawTrades.map(t => ({
    analyst_id: t.analyst_id, market_id: t.market?.market_id ?? '', symbol: t.market?.symbol ?? 'Unknown',
    asset_class: t.market?.asset_class ?? 'Unknown', direction: t.direction, session: t.session ?? null,
    source_system: t.source_system, triggered: t.triggered, result_r: t.result_r,
    published_at: t.published_at, closed_at: t.closed_at,
  }))
  const pubs: MetricsPublication[] = rawPubs

  const today = new Date().toISOString().slice(0, 10)
  const filters: AnalyticsFilterState = DEFAULT_FILTERS // product/analyst/market/direction/session/trigger all unfiltered
  const range = { start: SINCE_INCEPTION_FLOOR, end: today }

  const summary = computeSummary(trades, pubs)
  const cumulative = cumulativeSeries(trades)
  const drawdown = drawdownSeries(trades)
  const rolling = rollingWindows(trades, new Date())
  const monthly = monthlyMatrix(trades)
  const tradeStats = computeTradeStatistics(trades, pubs)
  const distribution = resultDistribution(trades)

  const byAnalyst = attributionBy(trades, t => ({ key: t.analyst_id, label: analystNameById.get(t.analyst_id) ?? 'Unknown' }))
  const byAssetClass = attributionBy(trades, t => ({ key: t.asset_class, label: t.asset_class }))
  const byMarket = attributionBy(trades, t => ({ key: t.market_id, label: t.symbol }))
  const bestMarkets = rankAttribution(byMarket, MIN_TRADES_FOR_MARKET_RANKING, 'best')
  const worstMarkets = rankAttribution(byMarket, MIN_TRADES_FOR_MARKET_RANKING, 'worst')

  const qualifyingMarketIds = new Set(byMarket.filter(r => r.trades >= MIN_TRADES_FOR_MARKET_RANKING).map(r => r.key))
  const { best } = bestWorstTrades(trades.filter(t => qualifyingMarketIds.has(t.market_id)), 10)
  const bestTrades = best.map(t => ({
    date: t.published_at.slice(0, 10), symbol: t.symbol,
    analystName: analystNameById.get(t.analyst_id) ?? 'Unknown', direction: t.direction, resultR: t.result_r ?? 0,
  }))

  const universe = describeUniverse(filters, range, markets, analysts)
  const dataThroughDate = trades.length === 0 ? today
    : trades.reduce((max, t) => t.published_at > max ? t.published_at : max, trades[0]!.published_at).slice(0, 10)

  return {
    summary, cumulative, drawdown, rolling, monthly, tradeStats, distribution,
    byAnalyst, byAssetClass, byMarket, bestMarkets, worstMarkets, bestTrades,
    universe, dataThroughDate, tradeCount: trades.filter(t => t.triggered && t.result_r !== null).length,
    computedAt: new Date().toISOString(),
  }
}

export type DefaultAnalyticsView = Awaited<ReturnType<typeof computeDefaultAnalyticsView>>

// 15-minute TTL -- matches the task's stated cadence for this specific view. Tagged so a
// manual refresh (see /api/analytics/summary?force=true) can invalidate it on demand
// without waiting out the TTL, without touching any other cached entry.
const getCachedDefaultAnalyticsView = unstable_cache(
  computeDefaultAnalyticsView,
  [CACHE_TAG],
  { revalidate: 900, tags: [CACHE_TAG] }
)

export { getCachedDefaultAnalyticsView, computeDefaultAnalyticsView, CACHE_TAG }
