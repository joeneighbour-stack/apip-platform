import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TeamPerformanceGrid } from '@/components/management/TeamPerformanceGrid'

export default async function ManagementPerformancePage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const supabase = await createClient()
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`

  // 36 months for long-term trend
  const d36 = new Date(Date.UTC(year, month - 35, 1))
  const thirtyySixMonthsAgo = d36.toISOString().slice(0, 10)

  // Active analysts
  const { data: analysts } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active')
    .eq('active', true)
    .order('display_name')

  // KPI data for last 36 months
  const { data: kpiData } = await supabase
    .from('executive_kpis')
    .select('analyst_id, kpi_name, kpi_value, period_start')
    .gte('period_start', thirtyySixMonthsAgo)
    .order('period_start', { ascending: true })

  // Shadow summary for comparison
  const { data: shadowOutcomes } = await supabase
    .from('shadow_trade_outcomes')
    .select(`
      trade_outcome_status,
      result_r,
      shadow_trade:shadow_trade_id ( rr )
    `)

  // Actual trades last 30 days for comparison
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data: actualTrades } = await supabase
    .from('actual_trades')
    .select('result_r, triggered')
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .gte('published_at', thirtyDaysAgo)

  const analystIdsWithData = new Set((kpiData ?? []).map(k => k.analyst_id))
  const analystsWithData = (analysts ?? []).filter(a => analystIdsWithData.has(a.analyst_id))

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Team Performance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monthly KPIs across all active analysts
          </p>
        </div>
        <a href="/dashboard/management"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back to Management
        </a>
      </div>
      <TeamPerformanceGrid
        analysts={analystsWithData}
        kpiData={kpiData ?? []}
        currentMonthStart={monthStart}
        shadowOutcomes={shadowOutcomes ?? []}
        actualTrades={actualTrades ?? []}
      />
    </div>
  )
}
