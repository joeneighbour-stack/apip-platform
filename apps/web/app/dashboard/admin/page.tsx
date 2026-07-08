import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { EngineRunsPanel } from '@/components/admin/EngineRunsPanel'
import { UserManagementPanel } from '@/components/admin/UserManagementPanel'
import { MarketManagementPanel } from '@/components/admin/MarketManagementPanel'
import { AnalystManagementPanel } from '@/components/admin/AnalystManagementPanel'
import { ThresholdsPanel } from '@/components/admin/ThresholdsPanel'

export default async function AdminCentrePage() {
  const user = await getCurrentUser()
  if (!['ADMIN', 'MANAGER'].includes(user.role)) redirect('/dashboard')

  const supabase = await createClient()

  // Engine runs -- last 20
  const { data: engineRuns } = await supabase
    .from('engine_runs')
    .select('engine_run_id, session, status, started_at, finished_at, error_summary, idempotency_key')
    .order('started_at', { ascending: false })
    .limit(20)

  // Users
  const { data: appUsers } = await supabase
    .from('app_users')
    .select('app_user_id, email, display_name, role, analyst_id, created_at')
    .order('created_at', { ascending: false })

  // Markets
  const { data: markets } = await supabase
    .from('markets')
    .select('market_id, symbol, asset_class, price_data_provider, price_data_symbol, active')
    .order('symbol')

  // Analysts
  const { data: analysts } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active, sessions')
    .order('display_name')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Admin Centre</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Engine monitoring, user management, market configuration
        </p>
      </div>

      <EngineRunsPanel runs={engineRuns ?? []} />
      <UserManagementPanel users={appUsers ?? []} analysts={analysts ?? []} isAdmin={user.role === 'ADMIN'} />
      <AnalystManagementPanel analysts={analysts ?? []} />
      <MarketManagementPanel markets={markets ?? []} />
      <ThresholdsPanel />
    </div>
  )
}
