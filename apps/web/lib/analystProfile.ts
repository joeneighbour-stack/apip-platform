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
  const adminDb = createAdminClient()

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

  // The current, still-in-progress month's executive_kpis row is written by a weekly
  // batch job (calculateKpis.ts), so it can be missing entirely, or present but stale/
  // partial (e.g. total_return_r computed before this week's trades, no triggered_rate
  // row yet at all -- confirmed against production: 2026-08 had total_return_r/
  // max_drawdown/win_rate but no triggered_rate row). total_return_r/win_rate/
  // triggered_rate for the current month are therefore always computed live from
  // actual_trades + analyst_publications here and override whatever executive_kpis has --
  // the same "This Month is always live, never read from the KPI table" rule
  // management/performance/page.tsx's TeamPerformanceGrid uses for its own This Month
  // view. max_drawdown (and alignment_rate, which has no live equivalent) are left
  // exactly as executive_kpis has them for the current month, present or not -- a
  // missing one doesn't block the others, it just reads as "--" downstream.
  const { data: monthTradesRaw } = await supabase
    .from('actual_trades')
    .select('result_r, triggered, published_at, source_system')
    .eq('analyst_id', analystId)
    .in('source_system', ['ACUITY_PERFORMANCE_API', 'MANUAL_BACKFILL'])
    .gte('published_at', monthStart)

  const monthTrades = (monthTradesRaw as any[]) ?? []
  const monthTriggered = monthTrades.filter((t: any) => t.triggered && t.result_r !== null)
  const monthWins = monthTriggered.filter((t: any) => (t.result_r ?? 0) > 0)
  const liveTotalR = monthTriggered.reduce((s: number, t: any) => s + (t.result_r ?? 0), 0)
  const liveWinRate = monthTriggered.length > 0 ? monthWins.length / monthTriggered.length : null

  // analyst_publications has no ANALYST self-select RLS policy (only ADMIN/RESEARCH and
  // MANAGER-scoped -- migrations/018_publication_rls.sql), same reason
  // /api/analytics/publications uses the service-role client for ANALYST callers.
  const { data: monthPubs } = await adminDb
    .from('analyst_publications')
    .select('reconciliation_status')
    .eq('analyst_id', analystId)
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .gte('published_at', monthStart)

  const pubTotal = (monthPubs ?? []).length
  const apiTriggered = monthTriggered.filter((t: any) => t.source_system === 'ACUITY_PERFORMANCE_API')
  // A zero numerator (nothing triggered yet this month) isn't a meaningful "0%" signal, same
  // rule as KpiSummary.tsx/TeamPerformanceGrid.tsx's getValue() -- it reads as no data ("--"),
  // not as "missing every target".
  const liveTrigRate = pubTotal > 0 && apiTriggered.length > 0 ? apiTriggered.length / pubTotal : null

  const liveRows = [
    { kpi_name: 'total_return_r', kpi_value: { value: liveTotalR, unit: 'R', trade_count: monthTriggered.length }, period_start: monthStart, period_end: null },
    ...(liveWinRate !== null ? [{ kpi_name: 'win_rate', kpi_value: { value: liveWinRate, unit: 'rate', wins: monthWins.length, triggered: monthTriggered.length }, period_start: monthStart, period_end: null }] : []),
    ...(liveTrigRate !== null ? [{ kpi_name: 'triggered_rate', kpi_value: { value: liveTrigRate, unit: 'rate', triggered: apiTriggered.length, total_setups: pubTotal }, period_start: monthStart, period_end: null }] : []),
  ]

  const baseKpiTrend = (kpiTrend as any[]) ?? []
  const staleCurrentMonthMetrics = new Set(['total_return_r', 'win_rate', 'triggered_rate'])
  const mergedKpiTrend = [
    ...baseKpiTrend.filter((k: any) => !(k.period_start === monthStart && staleCurrentMonthMetrics.has(k.kpi_name))),
    ...liveRows,
  ].sort((a, b) => a.period_start.localeCompare(b.period_start))

  const kpis = mergedKpiTrend.filter((k: any) => k.period_start === monthStart)

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
      kpis, kpiTrend: mergedKpiTrend,
      monthR, monthTradeCount, winRate,
      allTrades: [], recentTradesWithDetails: [], reviews: [], disputesByTradeId: new Map(),
    }
  }

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
    kpiTrend: mergedKpiTrend,
    monthR,
    monthTradeCount,
    winRate,
    allTrades,
    recentTradesWithDetails,
    reviews: (reviews as any[]) ?? [],
    disputesByTradeId,
  }
}
