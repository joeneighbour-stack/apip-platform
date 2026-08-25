import { getCurrentUser } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ShadowMonitoringPanel } from '@/components/management/LazyCharts'
import { AnalystShadowBreakdown } from '@/components/management/AnalystShadowBreakdown'
import { getShadowBreakdownData } from '@/lib/shadowBreakdown'

export default async function ShadowMonitoringPage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const supabase = await createClient()
  const adminDb = createAdminClient()

  // Shared with Team Performance so both pages agree on the "since launch" floor and the
  // analyst-vs-shadow breakdown numbers.
  const { shadowStartDate, analysts: breakdownAnalysts, rows: breakdownRows } = await getShadowBreakdownData(adminDb)

  // Shadow outcomes -- all resolved outcomes for like-for-like comparison. Paginated,
  // same reasoning/pattern as rawActualTrades/rawActualPublications below and
  // shadowBreakdown.ts's own shadow fetch: PostgREST caps responses at 1000 rows
  // regardless of .limit(), and this table has already grown past that.
  const shadowOutcomes: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data, error } = await supabase
        .from('shadow_trade_outcomes')
        .select(`
          shadow_outcome_id,
          trade_outcome_status,
          result_r,
          mfe_r,
          mae_r,
          outcome_timestamp,
          shadow_trade:shadow_trade_id (
            shadow_trade_id,
            entry, stop, target, rr,
            direction, session,
            template_source,
            generated_at,
            entry_variant,
            shadow_system,
            opportunity:opportunity_id (
              date,
              market:market_id ( symbol, asset_class, display_precision, market_id )
            )
          )
        `)
        .order('shadow_outcome_id', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (error) {
        console.error('[ShadowMonitoringPage] Failed to fetch shadow_trade_outcomes:', error.message)
        hasMore = false
      } else if (!data?.length) { hasMore = false } else {
        shadowOutcomes.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }

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
      const { data, error } = await supabase
        .from('actual_trades')
        .select(`
          trade_id, direction, result_r, triggered, published_at, analyst_id, source_system,
          market:market_id ( symbol, asset_class, market_id )
        `)
        .gte('published_at', shadowStartDate)
        .order('published_at', { ascending: false })
        .order('trade_id', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (error) {
        console.error('[ShadowMonitoringPage] Failed to fetch actual_trades:', error.message)
        hasMore = false
      } else if (!data?.length) { hasMore = false } else {
        rawActualTrades.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }

  // Same source-preference rule as TeamPerformanceGrid.tsx's preferApiPerDay(): API wins over
  // backfill for a given analyst+day when both exist, backfill is kept where API has a gap.
  // Only a *triggered* API row counts as covering that day -- an untriggered published setup
  // isn't the same event as a MANUAL_BACKFILL row recording a real executed trade, and treating
  // it as coverage was discarding real backfill trades on days where the API setup never fired.
  const apiDatesByAnalyst = new Map<string, Set<string>>()
  for (const t of rawActualTrades) {
    if (t.source_system === 'ACUITY_PERFORMANCE_API' && t.triggered && t.analyst_id && t.published_at) {
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
      const { data, error } = await adminDb
        .from('analyst_publications')
        .select('published_at, reconciliation_status')
        .eq('source_system', 'ACUITY_PERFORMANCE_API')
        .gte('published_at', shadowStartDate)
        .order('published_at', { ascending: false })
        .order('publication_id', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (error) {
        console.error('[ShadowMonitoringPage] Failed to fetch analyst_publications:', error.message)
        hasMore = false
      } else if (!data?.length) { hasMore = false } else {
        rawActualPublications.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }

  // Sort shadow by date desc
  const sorted = shadowOutcomes.sort((a, b) => {
    const dateA = (a.shadow_trade as any)?.opportunity?.date ?? ''
    const dateB = (b.shadow_trade as any)?.opportunity?.date ?? ''
    return dateB.localeCompare(dateA)
  })

  // Two views of the same fetch, no second query:
  // - canonicalShadowOutcomes (ANALYST_MIRROR + ZONE_MID only) -- the aggregate stats
  //   sections (period comparison, Since Platform Launch, By Market) use this as the
  //   fixed baseline, so those totals stay a clean 1:1 read against the pre-variant
  //   methodology rather than silently summing across all 3 entry variants x 2 systems.
  // - allShadowOutcomes -- every variant/system, for the variant-grouped trade table
  //   and the Variant Performance tab, which need the full picture.
  const canonicalShadowOutcomes = sorted.filter(
    o => (o.shadow_trade as any)?.shadow_system === 'ANALYST_MIRROR'
      && (o.shadow_trade as any)?.entry_variant === 'ZONE_MID'
  )
  const allShadowOutcomes = sorted

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
        shadowOutcomes={allShadowOutcomes}
        canonicalShadowOutcomes={canonicalShadowOutcomes}
        actualTrades={actualTrades ?? []}
        actualPublications={rawActualPublications}
        breakdownSlot={<AnalystShadowBreakdown rows={breakdownRows} analysts={breakdownAnalysts} />}
      />
    </div>
  )
}
