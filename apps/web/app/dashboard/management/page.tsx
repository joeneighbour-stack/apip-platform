import { getCurrentUser } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { WorkloadPanel } from '@/components/management/WorkloadPanel'
import { DisputeQueue } from '@/components/management/DisputeQueue'
import { AbsenceQueue } from '@/components/management/AbsenceQueue'
import { EmergencyAbsence } from '@/components/management/EmergencyAbsence'
import { LiveTradesPanel } from '@/components/management/LiveTradesPanel'
import { ManagementMonitor } from '@/components/management/ManagementMonitor'
import { ManagementTabs } from '@/components/management/ManagementTabs'

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
    .gte('assigned_at', today + 'T00:00:00Z')
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
      created_at, raised_by_analyst_id,
      trade:trade_id (
        direction, entry, stop, result_r, triggered, published_at, market_id,
        market:market_id ( symbol )
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

  // ── Monitor tab: unified 30-day trade stream across all analysts ────────────────
  // Uses the service-role client (adminDb), not the RLS-scoped `supabase` used
  // everywhere else on this page -- actual_trades_select_manager (migrations/
  // 002_rls.sql) and post_trade_reviews_select_manager (035_post_trade_reviews_rls.sql)
  // both restrict reads to rows where manages_analyst() is true for the analyst_id in
  // question. A manager who doesn't manage every analyst on the team would get a
  // silently incomplete (or empty) result under the RLS-scoped client for either query
  // -- this tab is meant to be a full cross-team view (same reasoning already applied
  // to the coachingAlignment query below), so both deliberately bypass that scoping.
  const adminDb = createAdminClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: allTrades } = await adminDb
    .from('actual_trades')
    .select(`
      trade_id, direction, result_r, triggered,
      published_at, historical_backfill, analyst_id,
      entry, stop, target, session, expiry,
      market:market_id ( symbol, asset_class )
    `)
    .gte('published_at', thirtyDaysAgo + 'T00:00:00Z')
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .order('published_at', { ascending: false })
    .limit(500)

  const allTradeIds = (allTrades ?? []).map((t: any) => t.trade_id)

  // post_trade_reviews has no analyst_id column -- `trade:trade_id!inner` filters via
  // the FK-joined actual_trades row instead (see monitor/page.tsx's identical pattern).
  // Not scoped to a single analyst here, so a plain (non-!inner) embed would already
  // return every matching review -- !inner kept anyway for consistency with that file
  // and because it's required if this ever adds an analyst-scoped filter later.
  //
  // Batched: a single .in() with up to 500 UUIDs can exceed PostgREST/Supabase's URL
  // length limit ("TypeError: fetch failed"), so trade IDs are chunked instead.
  const BATCH_SIZE = 100
  const allReviews: any[] = []
  for (let i = 0; i < allTradeIds.length; i += BATCH_SIZE) {
    const batch = allTradeIds.slice(i, i + BATCH_SIZE)
    const { data: batchReviews } = await adminDb
      .from('post_trade_reviews')
      .select(`
        review_id, trade_id, market, session,
        direction_alignment, entry_alignment, stop_alignment, target_alignment,
        alignment_score, review_status, analyst_facing_review, created_at,
        trade:trade_id!inner ( result_r, triggered, analyst_id )
      `)
      .in('trade_id', batch)
    if (batchReviews) allReviews.push(...batchReviews)
  }

  const reviewsByTradeId = new Map(allReviews.map((r: any) => [r.trade_id, r]))

  // Every dispute for this 30-day trade set, any status -- TradeHistoryTable's Flag
  // column needs RESOLVED/REJECTED too, not just the open ones DisputeQueue shows above.
  // Batched for the same URL-length reason as allReviews above.
  const allDisputes: any[] = []
  for (let i = 0; i < allTradeIds.length; i += BATCH_SIZE) {
    const batch = allTradeIds.slice(i, i + BATCH_SIZE)
    const { data: batchDisputes } = await supabase
      .from('trade_disputes')
      .select('trade_id, status, dispute_type')
      .in('trade_id', batch)
    if (batchDisputes) allDisputes.push(...batchDisputes)
  }

  const allDisputesByTradeId = new Map(allDisputes.map((d: any) => [d.trade_id, d]))

  // Coaching alignment by analyst -- not scoped to the 30-day trade window above,
  // full history. `trade:trade_id!inner` already guarantees a non-null trade on every
  // returned row (inner join semantics), so no separate not-null filter is needed --
  // confirmed live: an explicit .not('trade', 'is', null) here returns the identical
  // row count with or without it.
  //
  // Reuses the same adminDb declared above (allTrades/allReviews) -- same RLS reasoning.
  //
  // Paginated -- this used to be a single `.limit(1000)` with no `.order()`, flagged by
  // the Phase 6 performance audit (docs/qa/performance-audit.md, Check 5) as a silent-
  // truncation risk once total reviews passed 1000 (372 at the time), and with no
  // deterministic ordering even below that. Same .range() + explicit .order() pattern as
  // every other full-history fetch in this file (allTrades/allReviews/allDisputes above)
  // and in lib/shadowBreakdown.ts -- ordering by review_id purely for pagination
  // determinism, not because it carries any meaning here.
  const coachingAlignment: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data, error } = await adminDb
        .from('post_trade_reviews')
        .select(`
          direction_alignment, alignment_score,
          trade:trade_id!inner ( result_r, analyst_id )
        `)
        .order('review_id', { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (error) { console.error('coaching alignment query failed:', error); break }
      if (!data?.length) { hasMore = false } else {
        coachingAlignment.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }

  // Aggregate per analyst
  const alignmentByAnalyst = (activeAnalysts ?? []).map(analyst => {
    const reviews = (coachingAlignment ?? []).filter(
      r => (r.trade as any)?.analyst_id === analyst.analyst_id
    )
    const total = reviews.length
    const aligned = reviews.filter(r => r.direction_alignment === 'Aligned').length
    const different = reviews.filter(r => r.direction_alignment === 'Different').length
    const closedAligned = reviews.filter(r =>
      r.direction_alignment === 'Aligned' && (r.trade as any)?.result_r != null
    )
    const closedDifferent = reviews.filter(r =>
      r.direction_alignment === 'Different' && (r.trade as any)?.result_r != null
    )
    const alignedAvgR = closedAligned.length > 0
      ? closedAligned.reduce((s, r) => s + Number((r.trade as any).result_r), 0) / closedAligned.length
      : null
    const differentAvgR = closedDifferent.length > 0
      ? closedDifferent.reduce((s, r) => s + Number((r.trade as any).result_r), 0) / closedDifferent.length
      : null
    const fullAlignment = reviews.filter(r => r.alignment_score === 4).length

    return {
      analyst_id: analyst.analyst_id,
      display_name: analyst.display_name,
      total,
      aligned,
      different,
      pctAligned: total > 0 ? Math.round(100 * aligned / total) : null,
      alignedAvgR,
      differentAvgR,
      closedAlignedCount: closedAligned.length,
      closedDifferentCount: closedDifferent.length,
      fullAlignment,
      fullAlignmentPct: total > 0 ? Math.round(100 * fullAlignment / total) : null,
    }
  }).filter(a => a.total > 0)

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

      <ManagementTabs
        overview={
          <div className="space-y-8">
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
              <DisputeQueue disputes={(disputes ?? []) as any} />
            </div>

            {/* Automation Readiness -- placeholder until sufficient clean shadow data available */}
            <div className="rounded-lg border border-border bg-card p-6 mt-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium">Automation Readiness</h2>
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                  Coming soon
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Automation readiness metrics will be available once sufficient clean shadow trade
                data has been collected. Requires approximately 4 weeks of reliable engine runs
                with correct regime classification.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Available from approximately mid-September 2026.
              </p>
            </div>
          </div>
        }
        monitor={
          <ManagementMonitor
            trades={(allTrades ?? []) as any}
            disputesByTradeId={allDisputesByTradeId}
            reviewsByTradeId={reviewsByTradeId}
            activeAnalysts={activeAnalysts ?? []}
            alignmentByAnalyst={alignmentByAnalyst}
            currentUserRole={user.role as 'MANAGER' | 'ADMIN'}
            currentUserDisplayName={user.displayName}
          />
        }
      />
    </div>
  )
}

