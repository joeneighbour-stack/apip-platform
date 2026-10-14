// Server-side cache for the Analytics page's "default view" -- Since Inception, all
// analysts, all markets, no other filters. This is the single most expensive query the
// page makes (30,000+ trades, 40,000+ publications, fully recomputed) and per product the
// most common thing anyone actually loads, so it's the only view worth caching: every
// other filter combination is smaller and rarer, and stays on the existing fetch-and-
// compute-on-the-client path (see AnalyticsPage.tsx).
import { createAdminClient } from './supabase/server'
import { SINCE_INCEPTION_FLOOR } from './dateRanges'
import { describeUniverse, DEFAULT_FILTERS, type AnalyticsFilterState } from './analyticsFilters'
import {
  type MetricsTrade, type MetricsPublication,
  computeSummary, cumulativeSeries, drawdownSeries, rollingWindows, monthlyMatrix,
  attributionBy, computeTradeStatistics, resultDistribution, bestWorstTrades,
  rankAttribution, MIN_TRADES_FOR_MARKET_RANKING,
} from './metrics'

const CACHE_KEY = 'default-analytics-view'

async function fetchAllTrades(): Promise<any[]> {
  const db = createAdminClient()
  const FIELDS = `trade_id, analyst_id, direction, result_r,
    triggered, published_at, closed_at, source_system, session,
    market:market_id ( market_id, symbol, asset_class )`
  const all: any[] = []
  let page = 0, hasMore = true
  while (hasMore) {
    const { data, error } = await db.from('actual_trades').select(FIELDS)
      .gte('published_at', SINCE_INCEPTION_FLOOR + 'T00:00:00Z')
      .order('published_at', { ascending: false })
      .order('trade_id', { ascending: false })
      .range(page * 1000, page * 1000 + 999)
    if (error) {
      console.error('[analyticsCache] Failed to fetch actual_trades:', error.message)
      const msg = error.message.toLowerCase()
      if (msg.includes('statement timeout') || msg.includes('canceling statement')) {
        throw new Error('fetchAllTrades timed out')
      }
      hasMore = false
    } else if (!data?.length) { hasMore = false } else { all.push(...data); hasMore = data.length === 1000; page++ }
    if (all.length >= 150_000) break
  }
  return all
}

async function fetchAllPublications(): Promise<any[]> {
  const db = createAdminClient()
  const all: any[] = []
  let page = 0, hasMore = true
  while (hasMore) {
    const { data, error } = await db.from('analyst_publications')
      .select('analyst_id, market_id, published_at, reconciliation_status')
      .eq('source_system', 'ACUITY_PERFORMANCE_API')
      .gte('published_at', SINCE_INCEPTION_FLOOR + 'T00:00:00Z')
      .order('published_at', { ascending: false })
      .order('publication_id', { ascending: false })
      .range(page * 1000, page * 1000 + 999)
    if (error) {
      console.error('[analyticsCache] Failed to fetch analyst_publications:', error.message)
      const msg = error.message.toLowerCase()
      if (msg.includes('statement timeout') || msg.includes('canceling statement')) {
        throw new Error('analyst_publications fetch timed out')
      }
      hasMore = false
    } else if (!data?.length) { hasMore = false } else { all.push(...data); hasMore = data.length === 1000; page++ }
    if (all.length >= 150_000) break
  }
  return all
}

// Not cached itself -- called by getCachedDefaultAnalyticsView() below on a
// cache miss or explicit recompute.
async function computeDefaultAnalyticsView() {
  const db = createAdminClient()
  const [rawTrades, rawPubs, analystsRes, marketsRes] = await Promise.all([
    fetchAllTrades(),
    fetchAllPublications(),
    db.from('analysts').select('analyst_id, display_name, active').order('display_name'),
    db.from('markets').select('market_id, symbol, asset_class').order('asset_class, symbol'),
  ])
  if (analystsRes.error) console.error('[analyticsCache] Failed to fetch analysts:', analystsRes.error.message)
  if (marketsRes.error) console.error('[analyticsCache] Failed to fetch markets:', marketsRes.error.message)
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

  // Dedup: identical logic to calculateKpis.ts (lines ~154-184) -- MANUAL_BACKFILL is the
  // authoritative, complete history for every date before the live feed took over, so any
  // ACUITY_PERFORMANCE_API row before LIVE_API_START is either a duplicate of a backfill
  // trade or an incomplete/incorrect webhook capture and is dropped outright rather than
  // merged (confirmed there: Ian Coleman's July 2026 summed both sources to +15.95R against
  // backfill's real +7.84R for that month). From LIVE_API_START onwards the live feed is
  // primary: a triggered API row wins, and MANUAL_BACKFILL is kept only to fill days the API
  // has no triggered trade for that analyst. Key is analyst_id::date only (no market_id) --
  // matches calculateKpis.ts exactly, not a re-derivation.
  const LIVE_API_START = '2026-08-01'
  const dedupedTrades: MetricsTrade[] = []
  const apiKeySet = new Set(
    trades
      .filter(t => t.source_system === 'ACUITY_PERFORMANCE_API' && t.triggered && t.result_r !== null && t.published_at.slice(0, 10) >= LIVE_API_START)
      .map(t => `${t.analyst_id}::${t.published_at.slice(0, 10)}`)
  )
  for (const t of trades) {
    const tradeDate = t.published_at.slice(0, 10)
    if (tradeDate < LIVE_API_START) {
      if (t.source_system === 'ACUITY_PERFORMANCE_API') continue
    } else {
      if (t.source_system === 'MANUAL_BACKFILL') {
        const key = `${t.analyst_id}::${tradeDate}`
        if (apiKeySet.has(key)) continue
      }
    }
    dedupedTrades.push(t)
  }
  console.log(`Deduped ${trades.length - dedupedTrades.length} trades (MANUAL_BACKFILL authoritative before ${LIVE_API_START})`)

  const today = new Date().toISOString().slice(0, 10)
  const filters: AnalyticsFilterState = DEFAULT_FILTERS // analyst/market/direction/session/trigger all unfiltered
  const range = { start: SINCE_INCEPTION_FLOOR, end: today }

  const summary = computeSummary(dedupedTrades, pubs)
  const cumulative = cumulativeSeries(dedupedTrades)
  const drawdown = drawdownSeries(dedupedTrades)
  const rolling = rollingWindows(dedupedTrades, new Date())
  const monthly = monthlyMatrix(dedupedTrades)
  const tradeStats = computeTradeStatistics(dedupedTrades, pubs)
  const distribution = resultDistribution(dedupedTrades)

  const byAnalyst = attributionBy(dedupedTrades, t => ({ key: t.analyst_id, label: analystNameById.get(t.analyst_id) ?? 'Unknown' }))
  const byAssetClass = attributionBy(dedupedTrades, t => ({ key: t.asset_class, label: t.asset_class }))
  const byMarket = attributionBy(dedupedTrades, t => ({ key: t.market_id, label: t.symbol }))
  const bestMarkets = rankAttribution(byMarket, MIN_TRADES_FOR_MARKET_RANKING, 'best')
  const worstMarkets = rankAttribution(byMarket, MIN_TRADES_FOR_MARKET_RANKING, 'worst')

  const qualifyingMarketIds = new Set(byMarket.filter(r => r.trades >= MIN_TRADES_FOR_MARKET_RANKING).map(r => r.key))
  const { best } = bestWorstTrades(dedupedTrades.filter(t => qualifyingMarketIds.has(t.market_id)), 10)
  const bestTrades = best.map(t => ({
    date: t.published_at.slice(0, 10), symbol: t.symbol,
    analystName: analystNameById.get(t.analyst_id) ?? 'Unknown', direction: t.direction, resultR: t.result_r ?? 0,
  }))

  const universe = describeUniverse(filters, range, markets, analysts)
  const dataThroughDate = dedupedTrades.length === 0 ? today
    : dedupedTrades.reduce((max, t) => t.published_at > max ? t.published_at : max, dedupedTrades[0]!.published_at).slice(0, 10)

  return {
    summary, cumulative, drawdown, rolling, monthly, tradeStats, distribution,
    byAnalyst, byAssetClass, byMarket, bestMarkets, worstMarkets, bestTrades,
    universe, dataThroughDate, tradeCount: dedupedTrades.filter(t => t.triggered && t.result_r !== null).length,
    computedAt: new Date().toISOString(),
  }
}

export type DefaultAnalyticsView = Awaited<ReturnType<typeof computeDefaultAnalyticsView>>

// In-memory only -- doesn't help across separate Railway instances, but within a single
// process it collapses concurrent cache-miss callers (e.g. a force=true refresh racing
// the warm-cache cron) onto one recompute instead of each kicking off its own full
// 30,000+ trade / 40,000+ publication rebuild and contending for the same DB resources.
let recomputeInProgress: Promise<DefaultAnalyticsView> | null = null

// Set by invalidateAnalyticsCache() to force the next getCachedDefaultAnalyticsView()
// call to recompute instead of serving the existing row -- deliberately does NOT delete
// the row itself, so if that recompute fails, the previous (stale but complete) payload
// is still there for every other request to read instead of every call paying for a
// live 30,000+ trade / 40,000+ publication rebuild until someone succeeds.
let forceRecompute = false

async function doRecompute(): Promise<DefaultAnalyticsView> {
  const db = createAdminClient()

  console.log('Analytics cache miss -- computing...')
  let result: DefaultAnalyticsView
  try {
    result = await computeDefaultAnalyticsView()
  } catch (err) {
    console.error(
      '[analyticsCache] computeDefaultAnalyticsView() failed -- existing cache row left untouched:',
      err instanceof Error ? err.message : err,
    )
    throw err
  }

  const { error: upsertError } = await db.from('analytics_cache').upsert({
    cache_key: CACHE_KEY,
    payload: result as any,
    computed_at: new Date().toISOString(),
    trade_count: result.tradeCount,
  })
  if (upsertError) console.error('[analyticsCache] Failed to write analytics_cache:', upsertError.message)
  return result
}

// No TTL: the row is only replaced by an explicit recompute -- either
// /api/analytics/warm-cache (hit every 2 hours during market hours by
// analytics-cache-warm.yml) or /api/analytics/summary?force=true. This
// replaces unstable_cache, which hit Next.js's per-entry size limit on this
// payload (30,000+ trades, 40,000+ publications).
export async function getCachedDefaultAnalyticsView(): Promise<DefaultAnalyticsView> {
  // forceRecompute skips the cache-hit check below entirely for this one call, then
  // resets immediately (before any await) so only the triggering call pays for a
  // recompute -- every other request, including ones that land while this recompute is
  // still running, falls through to the normal read below.
  if (forceRecompute) {
    forceRecompute = false
  } else {
    const db = createAdminClient()

    const { data, error } = await db
      .from('analytics_cache')
      .select('payload, computed_at')
      .eq('cache_key', CACHE_KEY)
      .single()

    // PGRST116 ("no rows returned") is the routine cache-miss case .single() always hits
    // on the very first call -- not a real failure, so it's excluded from the error log
    // below.
    if (error && error.code !== 'PGRST116') {
      console.error('[analyticsCache] Failed to read analytics_cache:', error.message)
    }

    if (data) {
      console.log(`Analytics cache hit (computed ${data.computed_at})`)
      return data.payload as DefaultAnalyticsView
    }
  }

  if (recomputeInProgress) return recomputeInProgress

  recomputeInProgress = doRecompute().finally(() => { recomputeInProgress = null })
  return recomputeInProgress
}

// Does NOT delete the cached row -- see forceRecompute's own comment above for why.
export async function invalidateAnalyticsCache(): Promise<void> {
  forceRecompute = true
}

export { computeDefaultAnalyticsView }
