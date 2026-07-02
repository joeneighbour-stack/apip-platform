import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AllocationTable } from '@/components/management/AllocationTable'
import { WorkloadPanel } from '@/components/management/WorkloadPanel'
import { DisputeQueue } from '@/components/management/DisputeQueue'
import { StaleExceptions } from '@/components/management/StaleExceptions'

export default async function ManagementWorkspacePage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/dashboard')

  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  // Today's allocations -- join to opportunities and markets
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
    .limit(50)

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

  // Stale/invalid active recommendations -- fetch separately and join manually
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

  // Fetch market symbols for each stale rec via opportunity -- query markets directly
  // to avoid RLS on opportunities blocking the manager view
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

  // Analyst availability today -- for workload context
  const { data: availability } = await supabase
    .from('analyst_availability')
    .select('analyst_id, available, workload_cap, session')
    .eq('date', today)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Allocation, team workload, disputes, and recommendation exceptions
        </p>
      </div>

      <WorkloadPanel allocations={allocations ?? []} availability={availability ?? []} />
      <AllocationTable allocations={allocations ?? []} />
      <StaleExceptions recommendations={staleRecsWithMarkets ?? []} />
      <DisputeQueue disputes={disputes ?? []} isAdmin={user.role === 'ADMIN'} />
    </div>
  )
}
