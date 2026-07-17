import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { KpiSummary } from '@/components/analyst/KpiSummary'
import { PerformanceBreakdown } from '@/components/analyst/PerformanceBreakdown'

export default async function AnalystPerformancePage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/login')
  if (!user.analystId) redirect('/dashboard/analyst')

  const supabase = await createClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString().split('T')[0]

  const { data: kpiTrend } = await supabase
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start, period_end')
    .eq('analyst_id', user.analystId)
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
      .eq('analyst_id', user.analystId)
      .gte('published_at', twoYearsAgo)
      .order('published_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (!batch?.length) { hasMore = false } else {
      allTrades.push(...batch)
      hasMore = batch.length === PAGE_SIZE
      page++
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">My Performance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monthly KPIs and performance breakdown
          </p>
        </div>
        <a href="/dashboard/analyst"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Workspace
        </a>
      </div>

      <KpiSummary kpis={kpis} kpiTrend={kpiTrend ?? []} />
      <PerformanceBreakdown trades={allTrades} />
    </div>
  )
}
