import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TeamPerformanceGrid } from '@/components/management/TeamPerformanceGrid'

export default async function ManagementPerformancePage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/dashboard')

  const supabase = await createClient()

  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const threeMonthsAgo = `${month >= 2 ? year : year - 1}-${String(((month - 2 + 12) % 12) + 1).padStart(2, '0')}-01`

  // All analysts
  const { data: analysts } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active')
    .eq('active', true)
    .order('display_name')

  // All KPI data for last 3 months
  const { data: kpiData } = await supabase
    .from('executive_kpis')
    .select('analyst_id, kpi_name, kpi_value, period_start')
    .gte('period_start', threeMonthsAgo)
    .order('period_start', { ascending: true })

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
          ← Management
        </a>
      </div>

      <TeamPerformanceGrid
        analysts={analysts ?? []}
        kpiData={kpiData ?? []}
        currentMonthStart={monthStart}
      />
    </div>
  )
}
