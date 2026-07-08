import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TradeHistoryTable } from '@/components/analyst/TradeHistoryTable'
import { CompliancePanel } from '@/components/analyst/CompliancePanel'
import { KpiSummary } from '@/components/analyst/KpiSummary'
import { PerformanceBreakdown } from '@/components/analyst/PerformanceBreakdown'

export default async function AnalystPerformancePage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/dashboard')
  if (!user.analystId) redirect('/dashboard/analyst')

  const supabase = await createClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split('T')[0]
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString().split('T')[0]

  // KPIs
  const { data: kpiTrend } = await supabase
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start, period_end')
    .eq('analyst_id', user.analystId)
    .gte('period_start', threeMonthsAgo)
    .order('period_start', { ascending: true })

  const kpis = (kpiTrend ?? []).filter(k => k.period_start === monthStart)

  // All trades for breakdown -- paginated
  const allTrades: any[] = []
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
      .eq('analyst_id', user.analystId)
      .gte('published_at', twoYearsAgo)
      .order('published_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (!batch?.length) {
      hasMore = false
    } else {
      allTrades.push(...batch)
      hasMore = batch.length === PAGE_SIZE
      page++
    }
  }

  // Recent trades for history table (last 90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const recentTrades = allTrades.filter(t => t.published_at >= ninetyDaysAgo)

  // Recent trades need entry/stop/target for the dispute modal
  const tradeIds = recentTrades.map(t => t.trade_id)
  const { data: tradeDetails } = await supabase
    .from('actual_trades')
    .select('trade_id, entry, stop, target, session')
    .in('trade_id', tradeIds)

  const detailsByTradeId = new Map((tradeDetails ?? []).map(t => [t.trade_id, t]))
  const recentTradesWithDetails = recentTrades.map(t => ({
    ...t,
    ...(detailsByTradeId.get(t.trade_id) ?? {}),
  }))

  // Compliance reviews
  const { data: reviews } = await supabase
    .from('post_trade_reviews')
    .select('review_id, market, session, direction_alignment, entry_alignment, alignment_score, review_status, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  // Existing disputes
  const { data: disputes } = await supabase
    .from('trade_disputes')
    .select('trade_id, status, dispute_type')
    .eq('raised_by_analyst_id', user.analystId)

  const disputesByTradeId = new Map(
    (disputes ?? []).map(d => [d.trade_id, d])
  )

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">My Performance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monthly KPIs, performance breakdown, and trade history
          </p>
        </div>
        <a href="/dashboard/analyst"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back to Workspace
        </a>
      </div>

      <KpiSummary kpis={kpis} kpiTrend={kpiTrend ?? []} />
      <PerformanceBreakdown trades={allTrades} />
      <TradeHistoryTable
        trades={recentTradesWithDetails}
        disputesByTradeId={disputesByTradeId}
        analystId={user.analystId}
      />
      <CompliancePanel reviews={reviews ?? []} />
    </div>
  )
}
