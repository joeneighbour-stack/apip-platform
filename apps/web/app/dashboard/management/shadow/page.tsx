import { getCurrentUser } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ShadowMonitoringPanel } from '@/components/management/ShadowMonitoringPanel'

export default async function ShadowMonitoringPage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const supabase = await createClient()
  const adminDb = createAdminClient()
  // Only used as a fallback floor if shadow_trades is empty (see shadowStartDate below).
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Shadow outcomes -- all resolved outcomes for like-for-like comparison
  const { data: shadowOutcomes } = await supabase
    .from('shadow_trade_outcomes')
    .select(`
      shadow_outcome_id,
      trade_outcome_status,
      result_r,
      outcome_timestamp,
      shadow_trade:shadow_trade_id (
        shadow_trade_id,
        entry, stop, target, rr,
        direction, session,
        template_source,
        generated_at,
        opportunity:opportunity_id (
          date,
          market:market_id ( symbol, asset_class, display_precision, market_id )
        )
      )
    `)
    .order('shadow_outcome_id', { ascending: false })

  // The analyst-actual comparison should span the whole time shadow trading has been
  // running, not an arbitrary rolling window -- find the earliest shadow trade and use
  // its date as the floor. Falls back to a 90-day window only if shadow_trades is empty
  // (e.g. a fresh environment) so this page doesn't break before shadow trading starts.
  const { data: earliestShadowTrade } = await supabase
    .from('shadow_trades')
    .select('generated_at')
    .order('generated_at', { ascending: true })
    .limit(1)
  const shadowStartDate = (earliestShadowTrade as any[] | null)?.[0]?.generated_at?.slice(0, 10) ?? ninetyDaysAgo

  // Fetch ALL actual trades (both source systems) from shadowStartDate to now, paginated --
  // PostgREST caps responses at 1000 rows regardless of .limit(), and .range() pagination is
  // only stable with a deterministic tiebreaking .order() (unordered pagination has silently
  // dropped rows in this codebase before). Both ACUITY_PERFORMANCE_API and MANUAL_BACKFILL are
  // included because the live feed has real outage gaps (e.g. most of July 2026 has zero
  // API-sourced rows) that a source_system filter alone would wrongly read as "no trades" --
  // preferApiPerDay then resolves the rare date where both sources do overlap.
  const rawActualTrades: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data } = await supabase
        .from('actual_trades')
        .select(`
          trade_id, direction, result_r, triggered, published_at, analyst_id, source_system,
          market:market_id ( symbol, asset_class, market_id )
        `)
        .gte('published_at', shadowStartDate)
        .order('published_at', { ascending: false })
        .order('trade_id', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data?.length) { hasMore = false } else {
        rawActualTrades.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }

  // Same source-preference rule as TeamPerformanceGrid.tsx's preferApiPerDay(): API wins over
  // backfill for a given analyst+day when both exist, backfill is kept where API has a gap.
  const apiDatesByAnalyst = new Map<string, Set<string>>()
  for (const t of rawActualTrades) {
    if (t.source_system === 'ACUITY_PERFORMANCE_API' && t.analyst_id && t.published_at) {
      const date = t.published_at.slice(0, 10)
      if (!apiDatesByAnalyst.has(t.analyst_id)) apiDatesByAnalyst.set(t.analyst_id, new Set())
      apiDatesByAnalyst.get(t.analyst_id)!.add(date)
    }
  }
  const actualTrades = rawActualTrades.filter(t => {
    if (t.source_system === 'ACUITY_PERFORMANCE_API') return true
    if (!t.analyst_id || !t.published_at) return true
    return !apiDatesByAnalyst.get(t.analyst_id)?.has(t.published_at.slice(0, 10))
  })

  // "Total setups" on the analyst side should count the same thing shadow's 586 setups
  // count: recommendations generated, not trades executed -- a setup that never triggered
  // has an analyst_publications row but no actual_trades row at all, so counting trades
  // undercounts against shadow's universe. ACUITY_PERFORMANCE_API only, matching the shadow
  // era window; analyst_publications RLS scopes MANAGER to only their own managed analysts
  // (migrations/018_publication_rls.sql), so this needs the service-role client to see the
  // full team total, same as /api/analytics/publications and the Last Week fetch above.
  const rawActualPublications: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data } = await adminDb
        .from('analyst_publications')
        .select('published_at, reconciliation_status')
        .eq('source_system', 'ACUITY_PERFORMANCE_API')
        .gte('published_at', shadowStartDate)
        .order('published_at', { ascending: false })
        .order('publication_id', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data?.length) { hasMore = false } else {
        rawActualPublications.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }

  // Sort shadow by date desc
  const sorted = (shadowOutcomes ?? []).sort((a, b) => {
    const dateA = (a.shadow_trade as any)?.opportunity?.date ?? ''
    const dateB = (b.shadow_trade as any)?.opportunity?.date ?? ''
    return dateB.localeCompare(dateA)
  })

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Shadow Monitoring</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hidden benchmark performance — restricted to management only
          </p>
        </div>
        <a href="/dashboard/management"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back to Management
        </a>
      </div>
      <ShadowMonitoringPanel
        shadowOutcomes={sorted}
        actualTrades={actualTrades ?? []}
        actualPublications={rawActualPublications}
      />
    </div>
  )
}
