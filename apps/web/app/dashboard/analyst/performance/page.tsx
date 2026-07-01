import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TradeHistoryTable } from '@/components/analyst/TradeHistoryTable'
import { CompliancePanel } from '@/components/analyst/CompliancePanel'
import { KpiSummary } from '@/components/analyst/KpiSummary'

export default async function AnalystPerformancePage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/dashboard')
  if (!user.analystId) redirect('/dashboard/analyst')

  const supabase = await createClient()

  // Monthly KPIs -- current month
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]

  const { data: kpis } = await supabase
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start, period_end, includes_historical_backfill, requires_recommendation_version')
    .eq('analyst_id', user.analystId)
    .gte('period_start', monthStart)
    .lte('period_end', monthEnd)

  // Last 3 months for trend -- same KPI names, earlier periods
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0]
  const { data: kpiTrend } = await supabase
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start, period_end')
    .eq('analyst_id', user.analystId)
    .gte('period_start', threeMonthsAgo)
    .order('period_start', { ascending: true })

  // Trade history -- last 90 days, most recent first
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: trades } = await supabase
    .from('actual_trades')
    .select(`
      trade_id, direction, entry, result_r, triggered,
      published_at, session, historical_backfill,
      market:market_id ( symbol )
    `)
    .eq('analyst_id', user.analystId)
    .gte('published_at', ninetyDaysAgo)
    .order('published_at', { ascending: false })
    .limit(100)

  // Post-trade reviews -- compliance vs coaching
  const { data: reviews } = await supabase
    .from('post_trade_reviews')
    .select('review_id, market, session, direction_alignment, entry_alignment, alignment_score, review_status, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  // Existing disputes -- so the flag button shows correct state per trade
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
            Monthly KPIs, trade history, and compliance vs coaching
          </p>
        </div>
        <a
          href="/dashboard/analyst"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Workspace
        </a>
      </div>

      {/* Monthly KPI summary */}
      <KpiSummary kpis={kpis ?? []} kpiTrend={kpiTrend ?? []} />

      {/* Compliance vs coaching */}
      <CompliancePanel reviews={reviews ?? []} />

      {/* Trade history with dispute flagging */}
      <TradeHistoryTable
        trades={trades ?? []}
        disputesByTradeId={disputesByTradeId}
        analystId={user.analystId}
      />
    </div>
  )
}
