import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { KpiSummary } from '@/components/analyst/KpiSummary'
import { PerformanceBreakdown } from '@/components/analyst/PerformanceBreakdown'

export default async function AnalystDrillDownPage({
  params
}: {
  params: { analystId: string }
}) {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/dashboard')

  const supabase = await createClient()
  const { analystId } = params

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split('T')[0]
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString().split('T')[0]

  // Analyst info
  const { data: analyst } = await supabase
    .from('analysts')
    .select('display_name')
    .eq('analyst_id', analystId)
    .single()

  // KPIs
  const { data: kpiTrend } = await supabase
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start, period_end')
    .eq('analyst_id', analystId)
    .gte('period_start', threeMonthsAgo)
    .order('period_start', { ascending: true })

  const kpis = (kpiTrend ?? []).filter(k => k.period_start === monthStart)

  // Trades for breakdown
  const { data: allTrades } = await supabase
    .from('actual_trades')
    .select(`
      trade_id, direction, result_r, triggered,
      published_at, historical_backfill,
      market:market_id ( symbol, asset_class )
    `)
    .eq('analyst_id', analystId)
    .gte('published_at', twoYearsAgo)
    .order('published_at', { ascending: false })

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{analyst?.display_name ?? 'Analyst'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Performance detail — last 24 months
          </p>
        </div>
        <a href="/dashboard/management/performance"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Team Performance
        </a>
      </div>

      <KpiSummary kpis={kpis} kpiTrend={kpiTrend ?? []} />
      <PerformanceBreakdown trades={(allTrades ?? []) as any} />
    </div>
  )
}
