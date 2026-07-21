import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { KpiSummary } from '@/components/analyst/KpiSummary'
import { PerformanceBreakdown } from '@/components/analyst/PerformanceBreakdown'
import { CompliancePanel } from '@/components/analyst/CompliancePanel'
import { TradeHistoryTable } from '@/components/analyst/TradeHistoryTable'

interface PageProps {
  params: { analystId: string }
}

export default async function AnalystProfilePage({ params }: PageProps) {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const supabase = await createClient()
  const { analystId } = params

  // Fetch analyst details
  const { data: analyst } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active')
    .eq('analyst_id', analystId)
    .single()

  if (!analyst) notFound()

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString().split('T')[0]
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // KPI trend
  const { data: kpiTrend } = await supabase
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start, period_end')
    .eq('analyst_id', analystId)
    .gte('period_start', twoYearsAgo)
    .order('period_start', { ascending: true })

  const kpis = (kpiTrend ?? []).filter((k: any) => k.period_start === monthStart)

  // All trades for breakdown
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
      .eq('analyst_id', analystId)
      .gte('published_at', twoYearsAgo)
      .order('published_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (!batch?.length) { hasMore = false } else {
      allTrades.push(...batch)
      hasMore = batch.length === PAGE_SIZE
      page++
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

  // Current month quick stats
  const currentMonthTrades = allTrades.filter((t: any) =>
    t.published_at >= monthStart + 'T00:00:00Z' && t.result_r !== null
  )
  const wins = currentMonthTrades.filter((t: any) => Number(t.result_r) > 0)
  const monthR = currentMonthTrades.reduce((s: number, t: any) => s + Number(t.result_r), 0)
  const winRate = currentMonthTrades.length > 0
    ? Math.round(wins.length / currentMonthTrades.length * 100)
    : null

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{analyst.display_name}</h1>
            {!analyst.active && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                Inactive
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Analyst profile &mdash; management view
          </p>
        </div>
        <a href="/dashboard/management"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Management
        </a>
      </div>

      {/* This month quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">This Month Return</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${monthR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {monthR > 0 ? '+' : ''}{monthR.toFixed(2)}R
          </p>
          <p className="text-xs text-muted-foreground mt-1">{currentMonthTrades.length} closed trades</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Win Rate</p>
          <p className={`text-2xl font-semibold mt-1 ${winRate !== null && winRate >= 50 ? 'text-green-700' : 'text-muted-foreground'}`}>
            {winRate !== null ? `${winRate}%` : '&mdash;'}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">All Time Trades</p>
          <p className="text-2xl font-semibold mt-1">{allTrades.length.toLocaleString()}</p>
        </div>
      </div>

      {/* KPI Summary */}
      <KpiSummary kpis={kpis} kpiTrend={kpiTrend ?? []} />

      {/* Performance Breakdown */}
      <PerformanceBreakdown trades={allTrades} />

      {/* Coaching Compliance */}
      <CompliancePanel reviews={reviews ?? []} />

      {/* 30-day Trade Log */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Trade Log &mdash; Last 30 Days</h2>
        <TradeHistoryTable
          trades={recentTradesWithDetails}
          analystId={analystId}
          disputesByTradeId={disputesByTradeId}
        />
      </section>
    </div>
  )
}
