import { createClient, createAdminClient } from '@/lib/supabase/server'

export interface AnalystProfileData {
  analyst: { analyst_id: string; display_name: string; active: boolean } | null
  kpis: any[]
  kpiTrend: any[]
  monthR: number
  monthTradeCount: number
  winRate: number | null
  allTrades: any[]
  reviews: any[]
}

// Shared by the management analyst-profile page (any analyst, mode='full') and the
// analyst's own "My KPIs" tab (their own analyst_id, mode='kpi-only') -- same queries
// either way. RLS already grants a MANAGER access to any analyst's actual_trades/
// executive_kpis/post_trade_reviews rows and grants an ANALYST access to their own
// (migrations/002_rls.sql, 035_post_trade_reviews_rls.sql), so no caller-role branching
// is needed here.
//
// mode='kpi-only' skips every query the KPI tiles/history table don't need (the full
// trade-history pagination and reviews) -- the My KPIs tab has no use for either, and
// the full trade-history fetch in particular is the most expensive query in here.
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

  const { data: analyst, error: analystError } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active')
    .eq('analyst_id', analystId)
    .single()
  // PGRST116 ("no rows returned") just means analystId doesn't exist -- the normal path
  // into the !analyst branch below, not a failure worth logging.
  if (analystError && analystError.code !== 'PGRST116') {
    console.error('[getAnalystProfileData] Failed to fetch analyst:', analystError.message)
  }

  if (!analyst) {
    return {
      analyst: null,
      kpis: [], kpiTrend: [], monthR: 0, monthTradeCount: 0, winRate: null,
      allTrades: [], reviews: [],
    }
  }

  // KPI trend (always fetched -- needed by both modes)
  const { data: kpiTrend, error: kpiTrendError } = await supabase
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start, period_end')
    .eq('analyst_id', analystId)
    .gte('period_start', historyFloor)
    .order('period_start', { ascending: true })
  if (kpiTrendError) console.error('[getAnalystProfileData] Failed to fetch executive_kpis:', kpiTrendError.message)

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
  const { data: monthTradesRaw, error: monthTradesError } = await supabase
    .from('actual_trades')
    .select('result_r, triggered, published_at, source_system')
    .eq('analyst_id', analystId)
    .in('source_system', ['ACUITY_PERFORMANCE_API', 'MANUAL_BACKFILL'])
    .gte('published_at', monthStart)
  if (monthTradesError) console.error('[getAnalystProfileData] Failed to fetch month actual_trades:', monthTradesError.message)

  const monthTrades = (monthTradesRaw as any[]) ?? []
  const monthTriggered = monthTrades.filter((t: any) => t.triggered && t.result_r !== null)
  const monthWins = monthTriggered.filter((t: any) => (t.result_r ?? 0) > 0)
  const liveTotalR = monthTriggered.reduce((s: number, t: any) => s + (t.result_r ?? 0), 0)
  const liveWinRate = monthTriggered.length > 0 ? monthWins.length / monthTriggered.length : null

  // analyst_publications has no ANALYST self-select RLS policy (only ADMIN/RESEARCH and
  // MANAGER-scoped -- migrations/018_publication_rls.sql), same reason
  // /api/analytics/publications uses the service-role client for ANALYST callers.
  const { data: monthPubs, error: monthPubsError } = await adminDb
    .from('analyst_publications')
    .select('reconciliation_status')
    .eq('analyst_id', analystId)
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .gte('published_at', monthStart)
  if (monthPubsError) console.error('[getAnalystProfileData] Failed to fetch month analyst_publications:', monthPubsError.message)

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
      kpis, kpiTrend: mergedKpiTrend,
      monthR, monthTradeCount, winRate,
      allTrades: [], reviews: [],
    }
  }

  // All trades for breakdown
  const allTrades: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data: batch, error } = await supabase
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
      if (error) {
        console.error('[getAnalystProfileData] Failed to fetch allTrades:', error.message)
        hasMore = false
      } else if (!batch?.length) { hasMore = false } else {
        allTrades.push(...batch)
        hasMore = batch.length === PAGE_SIZE
        page++
      }
    }
  }

  // Post-trade reviews -- post_trade_reviews has no analyst_id column, only
  // trade_id (FK to actual_trades), so it's scoped to this analyst via the
  // trade_id list already fetched above, not a direct analyst_id filter.
  const allTradeIds = allTrades.map((t: any) => t.trade_id)
  const { data: reviews, error: reviewsError } = allTradeIds.length > 0
    ? await supabase
        .from('post_trade_reviews')
        .select('review_id, market, session, direction_alignment, entry_alignment, alignment_score, review_status, created_at')
        .in('trade_id', allTradeIds)
        .order('created_at', { ascending: false })
        .limit(50)
    : { data: [], error: null }
  if (reviewsError) console.error('[getAnalystProfileData] Failed to fetch post_trade_reviews:', reviewsError.message)

  return {
    analyst: analyst as any,
    kpis,
    kpiTrend: mergedKpiTrend,
    monthR,
    monthTradeCount,
    winRate,
    allTrades,
    reviews: (reviews as any[]) ?? [],
  }
}
