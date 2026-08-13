import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { EngineRunsPanel } from '@/components/admin/EngineRunsPanel'
import { UserManagementPanel } from '@/components/admin/UserManagementPanel'
import { MarketManagementPanel } from '@/components/admin/MarketManagementPanel'
import { AnalystManagementPanel } from '@/components/admin/AnalystManagementPanel'
import { ThresholdsPanel } from '@/components/admin/ThresholdsPanel'
import { ManualTradeEntryPanel } from '@/components/admin/ManualTradeEntryPanel'
import { NotificationsPanel } from '@/components/management/NotificationsPanel'

interface PageProps {
  // Populated by DisputeQueue's "Add manual trade entry" link on a MISSED_TRIGGER
  // dispute -- a JSON-encoded {analystId, marketId, direction, date}, used to pre-fill
  // ManualTradeEntryPanel's form instead of the manager re-typing what the dispute
  // already establishes.
  searchParams: Promise<{ prefill?: string }>
}

interface ManualEntryPrefill {
  analystId?: string
  marketId?: string
  direction?: 'BUY' | 'SELL'
  date?: string
}

function parsePrefill(raw: string | undefined): ManualEntryPrefill | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

export default async function AdminCentrePage({ searchParams }: PageProps) {
  const user = await getCurrentUser()
  if (!['ADMIN', 'MANAGER'].includes(user.role)) redirect('/login')

  const { prefill } = await searchParams
  const manualEntryPrefill = parsePrefill(prefill)

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

  // All notifications for admin (all severities)
  const { data: notifications } = await supabase
    .from('notifications')
    .select('notification_id, severity, notification_type, notification_status, title, message, related_table, related_id, sla_due_at, escalated_at, created_at')
    .in('notification_status', ['OPEN', 'ACKNOWLEDGED'])
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Admin Centre</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Engine monitoring, user management, market configuration
        </p>
      </div>

      <NotificationsPanel notifications={notifications ?? []} showAll={true} />
      <EngineRunsPanel runs={engineRuns ?? []} />
      <ManualTradeEntryPanel analysts={(analysts as any[]) ?? []} markets={(markets as any[]) ?? []} initialValues={manualEntryPrefill} />
      <UserManagementPanel users={appUsers ?? []} analysts={analysts ?? []} isAdmin={user.role === 'ADMIN'} />
      <AnalystManagementPanel analysts={analysts ?? []} />
      <MarketManagementPanel markets={markets ?? []} />
      <ThresholdsPanel />
    </div>
  )
}
