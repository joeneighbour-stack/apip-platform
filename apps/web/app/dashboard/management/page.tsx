import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { WorkloadPanel } from '@/components/management/WorkloadPanel'
import { DisputeQueue } from '@/components/management/DisputeQueue'
import { AbsenceQueue } from '@/components/management/AbsenceQueue'
import { EmergencyAbsence } from '@/components/management/EmergencyAbsence'
import { LiveTradesPanel } from '@/components/management/LiveTradesPanel'

export default async function ManagementWorkspacePage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  // Today's allocations
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
      trade:trade_id (
        direction, entry, result_r, triggered,
        market:market_id ( symbol ),
        analyst:analyst_id ( display_name )
      ),
      analyst:raised_by_analyst_id ( display_name )
    `)
    .in('status', ['OPEN', 'UNDER_REVIEW'])
    .order('created_at', { ascending: false })

  // Analyst availability
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

  // Active analysts
  const { data: activeAnalysts } = await supabase
    .from('analysts')
    .select('analyst_id, display_name')
    .eq('active', true)
    .order('display_name')

  // Today's actual trades with analyst and market
  const { data: todayTrades } = await supabase
    .from('actual_trades')
    .select(`
      trade_id, direction, entry, stop, target,
      triggered, result_r, published_at,
      analyst:analyst_id ( display_name ),
      market:market_id ( symbol )
    `)
    .gte('published_at', `${today}T00:00:00Z`)
    .order('published_at', { ascending: false })

  // Today's recommendations for direction alignment
  const { data: todayOpps } = await supabase
    .from('opportunities')
    .select('direction, market:market_id ( symbol )')
    .eq('date', today)

  const recDirBySymbol = new Map(
    (todayOpps ?? []).map((o: any) => [o.market?.symbol, o.direction])
  )

  // Merge recommended direction into trades
  const tradesWithAlignment = (todayTrades ?? []).map((t: any) => ({
    ...t,
    recommended_dir: recDirBySymbol.get(t.market?.symbol) ?? null,
  }))

  // Alert counts for header strip
  const openDisputes = (disputes ?? []).length
  const pendingAbsences = (absenceRequests ?? []).filter((a: any) => a.status === 'PENDING').length

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {openDisputes > 0 && (
            <a href="#disputes" className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors">
              <span className="w-4 h-4 rounded-full bg-red-600 text-white text-[10px] flex items-center justify-center font-bold">{openDisputes}</span>
              Open dispute{openDisputes > 1 ? 's' : ''}
            </a>
          )}
          {pendingAbsences > 0 && (
            <a href="#absences" className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors">
              <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center font-bold">{pendingAbsences}</span>
              Absence{pendingAbsences > 1 ? 's' : ''} pending
            </a>
          )}
          <EmergencyAbsence analysts={activeAnalysts ?? []} />
        </div>
      </div>

      {/* Workload summary */}
      <WorkloadPanel allocations={todayAllocations} availability={availability ?? []} />

      {/* Today's live trades */}
      <LiveTradesPanel trades={tradesWithAlignment} />
      {/* Absences */}
      <div id="absences">
        <AbsenceQueue requests={(absenceRequests ?? []) as any} />
      </div>

      {/* Disputes */}
      <div id="disputes">
        <DisputeQueue disputes={disputes ?? []} isAdmin={user.role === 'ADMIN'} />
      </div>
    </div>
  )
}

