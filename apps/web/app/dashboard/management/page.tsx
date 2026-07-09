import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AllocationTable } from '@/components/management/AllocationTable'
import { WorkloadPanel } from '@/components/management/WorkloadPanel'
import { DisputeQueue } from '@/components/management/DisputeQueue'
import { StaleExceptions } from '@/components/management/StaleExceptions'
import { AbsenceQueue } from '@/components/management/AbsenceQueue'
import { EmergencyAbsence } from '@/components/management/EmergencyAbsence'
import { NotificationsPanel } from '@/components/management/NotificationsPanel'

export default async function ManagementWorkspacePage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/dashboard')

  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  // Most recent allocations -- deduplicated by market (latest per market)
  const { data: allocations } = await supabase
    .from('coverage_allocation')
    .select(`
      allocation_id, allocation_status, allocation_score,
      assigned_by_type, assigned_at, reason_summary,
      opportunity:opportunity_id (
        analyst_action, direction, expected_r, trigger_probability,
        current_zone, preferred_entry_zone, date,
        market:market_id ( symbol, asset_class )
      ),
      analyst:assigned_analyst_id ( analyst_id, display_name )
    `)
    .eq('allocation_status', 'ASSIGNED')
    .order('assigned_at', { ascending: false })
    .limit(200)

  // Deduplicate: keep only the most recent allocation per market symbol
  const seenMarkets = new Set<string>()
  const todayAllocations = (allocations ?? []).filter(a => {
    const symbol = (a.opportunity as any)?.market?.symbol
    if (!symbol || seenMarkets.has(symbol)) return false
    seenMarkets.add(symbol)
    return true
  })

  // Open disputes
  const { data: disputes } = await supabase
    .from('trade_disputes')
    .select(`
      dispute_id, dispute_type, analyst_note, status,
      original_values, created_at,
      analyst:raised_by_analyst_id ( display_name )
    `)
    .in('status', ['OPEN', 'UNDER_REVIEW'])
    .order('created_at', { ascending: false })

  // Stale/invalid active recommendations
  const { data: staleRecs } = await supabase
    .from('recommendation_versions')
    .select(`
      recommendation_version_id, recommendation_validity_status,
      volatility_warning, atr_move_since_generation, generated_at,
      opportunity_id
    `)
    .in('recommendation_validity_status', ['STALE_PRICE', 'ZONE_CHANGED', 'DO_NOT_USE_RECALCULATE'])
    .eq('is_active', true)
    .order('generated_at', { ascending: true })
    .limit(20)

  const staleRecsWithMarkets = await Promise.all(
    (staleRecs ?? []).map(async (rec) => {
      const { data: opp } = await supabase
        .from('opportunities')
        .select('direction, analyst_action, market_id')
        .eq('opportunity_id', rec.opportunity_id)
        .single()

      let market = null
      if (opp?.market_id) {
        const { data: m } = await supabase
          .from('markets')
          .select('symbol')
          .eq('market_id', opp.market_id)
          .single()
        market = m
      }

      return { ...rec, opportunity: opp ? { ...opp, market } : null }
    })
  )

  // Analyst availability today
  const { data: availability } = await supabase
    .from('analyst_availability')
    .select('analyst_id, available, workload_cap, session')
    .eq('date', today)

  // Absence requests
  const nextThirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data: absenceRequests } = await supabase
    .from('analyst_availability')
    .select(`
      availability_id, date, session, status,
      analyst:analyst_id ( analyst_id, display_name )
    `)
    .in('status', ['PENDING', 'APPROVED'])
    .gte('date', today)
    .lte('date', nextThirtyDays)
    .order('date', { ascending: true })

  // Active analysts for emergency absence
  const { data: activeAnalysts } = await supabase
    .from('analysts')
    .select('analyst_id, display_name')
    .eq('active', true)
    .order('display_name')

  // Notifications -- WARNING and CRITICAL for managers
  const { data: notifications } = await supabase
    .from('notifications')
    .select('notification_id, severity, notification_type, notification_status, title, message, related_table, related_id, sla_due_at, escalated_at, created_at')
    .in('notification_status', ['OPEN', 'ACKNOWLEDGED'])
    .in('severity', ['WARNING', 'CRITICAL', 'SYSTEM_FAILURE'])
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Allocation, team workload, disputes, and recommendation exceptions
          </p>
        </div>
        <EmergencyAbsence analysts={activeAnalysts ?? []} />
      </div>

      <NotificationsPanel notifications={notifications ?? []} />
      <WorkloadPanel allocations={todayAllocations} availability={availability ?? []} />
      <AllocationTable allocations={todayAllocations} />
      <AbsenceQueue requests={(absenceRequests ?? []) as any} />
      <StaleExceptions recommendations={staleRecsWithMarkets ?? []} />
      <DisputeQueue disputes={disputes ?? []} isAdmin={user.role === 'ADMIN'} />
    </div>
  )
}
