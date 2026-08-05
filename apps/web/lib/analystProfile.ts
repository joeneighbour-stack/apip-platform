import { createClient, createAdminClient } from '@/lib/supabase/server'

export interface AnalystProfileData {
  analyst: { analyst_id: string; display_name: string; active: boolean } | null
  recommendations: any[]
  eventsByMarket: Map<string, string[]>
  kpis: any[]
  kpiTrend: any[]
  monthR: number
  monthTradeCount: number
  winRate: number | null
  allTrades: any[]
  recentTradesWithDetails: any[]
  reviews: any[]
  disputesByTradeId: Map<string, { trade_id: string; status: string; dispute_type: string }>
}

// Shared by the management analyst-profile page (any analyst, mode='full') and the
// analyst's own "My KPIs" tab (their own analyst_id, mode='kpi-only') -- same queries
// either way. RLS already grants a MANAGER access to any analyst's actual_trades/
// executive_kpis/post_trade_reviews/trade_disputes rows and grants an ANALYST access to
// their own (migrations/002_rls.sql, 035_post_trade_reviews_rls.sql), so no caller-role
// branching is needed here -- only coaching_recommendations and market_event_risk need
// the service-role client, same as the original management page did, since analysts have
// no direct RLS grant on those.
//
// mode='kpi-only' skips every query the KPI tiles/history table don't need (today's
// recommendations + event risk, the full trade history pagination, reviews, disputes) --
// the My KPIs tab has no use for any of that, and the full trade-history fetch in
// particular is the most expensive query in here.
export async function getAnalystProfileData(
  analystId: string,
  mode: 'full' | 'kpi-only' = 'full'
): Promise<AnalystProfileData> {
  const supabase = await createClient()

  const now = new Date()
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  // Full history floor -- the KPI backfill and actual_trades import both cover back to
  // 2017, and "All Time Trades" / KPI History are meant to show the whole thing.
  const historyFloor = '2015-01-01'

  const { data: analyst } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active')
    .eq('analyst_id', analystId)
    .single()

  if (!analyst) {
    return {
      analyst: null, recommendations: [], eventsByMarket: new Map(),
      kpis: [], kpiTrend: [], monthR: 0, monthTradeCount: 0, winRate: null,
      allTrades: [], recentTradesWithDetails: [], reviews: [], disputesByTradeId: new Map(),
    }
  }

  // KPI trend (always fetched -- needed by both modes)
  const { data: kpiTrend } = await supabase
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start, period_end')
    .eq('analyst_id', analystId)
    .gte('period_start', historyFloor)
    .order('period_start', { ascending: true })

  const kpis = ((kpiTrend as any[]) ?? []).filter((k: any) => k.period_start === monthStart)

  // Current month stats from KPIs
  const currentMonthKpi = kpis.find((k: any) => k.kpi_name === 'total_return_r')
  const monthR = currentMonthKpi ? Number(currentMonthKpi.kpi_value?.value ?? 0) : 0
  const monthTradeCount = currentMonthKpi ? Number(currentMonthKpi.kpi_value?.trade_count ?? 0) : 0
  const winRateKpi = kpis.find((k: any) => k.kpi_name === 'win_rate')
  const winRate = winRateKpi ? Math.round(Number(winRateKpi.kpi_value?.value ?? 0) * 100) : null

  if (mode === 'kpi-only') {
    return {
      analyst: analyst as any,
      recommendations: [], eventsByMarket: new Map(),
      kpis, kpiTrend: (kpiTrend as any[]) ?? [],
      monthR, monthTradeCount, winRate,
      allTrades: [], recentTradesWithDetails: [], reviews: [], disputesByTradeId: new Map(),
    }
  }

  const adminDb = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Today's recommendations via adminDb (bypass RLS)
  const { data: allRecs } = await adminDb
    .from('coaching_recommendations')
    .select(`
      recommendation_id, entry_range_low, entry_range_high,
      risk_range, target_range, trigger_probability, expected_r,
      coaching_note, shown_at,
      opportunity:opportunity_id (
        analyst_action, direction, current_zone,
        market:market_id ( symbol, asset_class, market_id )
      ),
      recommendation_version:active_recommendation_version_id (
        recommendation_validity_status
      )
    `)
    .eq('analyst_id', analystId)
    .gte('shown_at', today + 'T00:00:00Z')
    .order('shown_at', { ascending: false })

  // Deduplicate by symbol
  const seenSymbols = new Set<string>()
  const recommendations = (allRecs ?? []).filter((rec: any) => {
    const symbol = rec.opportunity?.market?.symbol
    if (!symbol || seenSymbols.has(symbol)) return false
    seenSymbols.add(symbol)
    return true
  })

  // Event risk for today's markets
  const marketIds = recommendations.map((r: any) => r.opportunity?.market?.market_id).filter(Boolean)
  const { data: eventRisks } = marketIds.length > 0
    ? await adminDb
        .from('market_event_risk')
        .select('market_id, event:event_id ( event_name, event_time_uk )')
        .in('market_id', marketIds)
        .eq('event_risk_status', 'HIGH_RISK')
    : { data: [] }

  const eventsByMarket = new Map<string, string[]>()
  for (const er of (eventRisks ?? []) as any[]) {
    const event = er.event
    if (!event || event.event_time_uk?.slice(0, 10) !== today) continue
    if (!eventsByMarket.has(er.market_id)) eventsByMarket.set(er.market_id, [])
    eventsByMarket.get(er.market_id)!.push(event.event_name)
  }

  // All trades for breakdown
  const allTrades: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data: batch } = await supabase
        .from('actual_trades')
        .select(`
          trade_id, direction, result_r, triggered,
          published_at, historical_backfill,
          market:market_id ( symbol, asset_class )
        `)
        .eq('analyst_id', analystId)
        .gte('published_at', historyFloor)
        .order('published_at', { ascending: false })
        .order('trade_id', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!batch?.length) { hasMore = false } else {
        allTrades.push(...batch)
        hasMore = batch.length === PAGE_SIZE
        page++
      }
    }
  }

  // Last 30 days trades for trade log
  const recentTrades = allTrades.filter((t: any) => t.published_at >= thirtyDaysAgo + 'T00:00:00Z')
  const tradeIds = recentTrades.map((t: any) => t.trade_id)

  const { data: tradeDetails } = tradeIds.length > 0
    ? await supabase
        .from('actual_trades')
        .select('trade_id, entry, stop, target, session')
        .in('trade_id', tradeIds)
    : { data: [] }

  const detailsByTradeId = new Map((tradeDetails ?? []).map((t: any) => [t.trade_id, t]))
  const recentTradesWithDetails = recentTrades.map((t: any) => ({
    ...t,
    ...(detailsByTradeId.get(t.trade_id) ?? {}),
  }))

  // Post-trade reviews
  const { data: reviews } = await supabase
    .from('post_trade_reviews')
    .select('review_id, market, session, direction_alignment, entry_alignment, alignment_score, review_status, created_at')
    .eq('analyst_id', analystId)
    .order('created_at', { ascending: false })
    .limit(50)

  // Disputes
  const { data: disputes } = await supabase
    .from('trade_disputes')
    .select('trade_id, status, dispute_type')
    .eq('raised_by_analyst_id', analystId)

  const disputesByTradeId = new Map(
    (disputes ?? []).map((d: any) => [d.trade_id, d])
  )

  return {
    analyst: analyst as any,
    recommendations,
    eventsByMarket,
    kpis,
    kpiTrend: (kpiTrend as any[]) ?? [],
    monthR,
    monthTradeCount,
    winRate,
    allTrades,
    recentTradesWithDetails,
    reviews: (reviews as any[]) ?? [],
    disputesByTradeId,
  }
}
