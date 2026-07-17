import { getCurrentUser } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TeamPerformanceGrid } from '@/components/management/TeamPerformanceGrid'

export default async function ManagementPerformancePage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const supabase = await createClient()
  const adminDb = createAdminClient()

  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`

  const d36 = new Date(Date.UTC(year, month - 35, 1))
  const thirtyySixMonthsAgo = d36.toISOString().slice(0, 10)

  const { data: analysts } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active')
    .eq('active', true)
    .order('display_name')

  const { data: kpiData } = await supabase
    .from('executive_kpis')
    .select('analyst_id, kpi_name, kpi_value, period_start')
    .gte('period_start', thirtyySixMonthsAgo)
    .order('period_start', { ascending: true })

  const { data: shadowOutcomes } = await supabase
    .from('shadow_trade_outcomes')
    .select(`
      trade_outcome_status,
      result_r,
      shadow_trade:shadow_trade_id ( rr )
    `)

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data: actualTrades } = await supabase
    .from('actual_trades')
    .select('result_r, triggered')
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .gte('published_at', thirtyDaysAgo)

  // Admin client bypasses RLS to read INTERNAL_ONLY shadow KPIs
  const { data: shadowKpiRows } = await adminDb
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start')
    .eq('kpi_visibility', 'INTERNAL_ONLY')
    .gte('period_start', thirtyySixMonthsAgo)
    .order('period_start', { ascending: true })

  const shadowKpiData = (shadowKpiRows ?? []) as { kpi_name: string; kpi_value: any; period_start: string }[]

  const analystKpis = (kpiData as any[]) ?? []
  const analystIdsWithData = new Set(analystKpis.map((k: any) => k.analyst_id).filter(Boolean))
  const analystsWithData = ((analysts as any[]) ?? []).filter((a: any) => analystIdsWithData.has(a.analyst_id))

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
          &larr; Back
        </a>
      </div>
      <TeamPerformanceGrid
        analysts={analystsWithData}
        kpiData={analystKpis}
        currentMonthStart={monthStart}
        shadowOutcomes={(shadowOutcomes as any[]) ?? []}
        actualTrades={(actualTrades as any[]) ?? []}
        shadowKpiData={shadowKpiData}
      />
    </div>
  )
}
