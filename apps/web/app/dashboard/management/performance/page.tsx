import { getCurrentUser } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TeamPerformanceGrid } from '@/components/management/TeamPerformanceGrid'
import { getShadowBreakdownData } from '@/lib/shadowBreakdown'

export default async function ManagementPerformancePage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const supabase = await createClient()
  const adminDb = createAdminClient()

  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const lastMonth = new Date(Date.UTC(year, month - 1, 1))
  const lastMonthStart = `${lastMonth.getUTCFullYear()}-${String(lastMonth.getUTCMonth() + 1).padStart(2, '0')}-01`
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

  // Supabase/PostgREST caps responses at 1000 rows server-side regardless of .limit() --
  // paginate with .range() to fetch all trades in the window (~1200+ rows in a 30-day span).
  // .range() pagination is only stable with an explicit deterministic .order() -- without one,
  // Postgres doesn't guarantee consistent row order across separate paginated queries, which
  // silently drops rows between page boundaries (confirmed: caused specific analysts' trades
  // to disappear from later pages even though the total row count looked correct).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const actualTrades: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data } = await supabase
        .from('actual_trades')
        .select('result_r, triggered, published_at, analyst_id, source_system')
        .in('source_system', ['ACUITY_PERFORMANCE_API', 'MANUAL_BACKFILL'])
        .gte('published_at', thirtyDaysAgo)
        .order('trade_id', { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data?.length) { hasMore = false } else {
        actualTrades.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }

  // Fetch last week API publications for trigger rate denominator
  const lwNow = new Date()
  const lwDayOfWeek = lwNow.getUTCDay()
  const lwDaysToLastMonday = (lwDayOfWeek + 6) % 7 + 7
  const lastMon = new Date(lwNow)
  lastMon.setUTCDate(lwNow.getUTCDate() - lwDaysToLastMonday)
  const lastFri = new Date(lastMon)
  lastFri.setUTCDate(lastMon.getUTCDate() + 4)
  const lwStart = lastMon.toISOString().slice(0, 10)
  const lwEnd = lastFri.toISOString().slice(0, 10)
  const { data: lastWeekPubs } = await adminDb
    .from('analyst_publications')
    .select('analyst_id, reconciliation_status')
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .gte('published_at', lwStart)
    .lte('published_at', lwEnd + 'T23:59:59Z')

  // Fetch this month's API publications for trigger rate denominator (month-to-date)
  const { data: thisMonthPubs } = await adminDb
    .from('analyst_publications')
    .select('analyst_id, reconciliation_status')
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .gte('published_at', monthStart)

  // Live 30-day shadow performance for the "Shadow System Performance" tiles + trend --
  // replaces the old executive_kpis(kpi_visibility='INTERNAL_ONLY') read, which showed the
  // current month's tile as 0R whenever calculateShadowKpis.ts's weekly batch hadn't
  // captured this month's closed shadow trades yet. Computed directly from
  // shadow_trade_outcomes, the same source ShadowMonitoringPanel.tsx already reads
  // successfully -- adminDb since this is management-only data with no analyst-facing RLS
  // grant. Filtered to the last 30 days here in JS rather than via a nested-column DB
  // filter (shadow_trade.generated_at), since the full history is only a few hundred rows.
  const { data: shadowOutcomesAll } = await adminDb
    .from('shadow_trade_outcomes')
    .select(`
      trade_outcome_status,
      result_r,
      shadow_trade:shadow_trade_id ( rr, generated_at )
    `)
  const shadowOutcomesRecent = ((shadowOutcomesAll ?? []) as any[]).filter(o =>
    o.shadow_trade?.generated_at && o.shadow_trade.generated_at.slice(0, 10) >= thirtyDaysAgo
  )

  const analystKpis = (kpiData as any[]) ?? []
  const analystIdsWithData = new Set(analystKpis.map((k: any) => k.analyst_id).filter(Boolean))
  const analystsWithData = ((analysts as any[]) ?? []).filter((a: any) => analystIdsWithData.has(a.analyst_id))

  // "Shadow vs Actual -- Since Platform Launch" -- shared with the Shadow Monitoring page so
  // both show identical numbers. shadowStartDate/analysts/rows come from the same source;
  // actualTrades/actualPublications are re-fetched here (rather than returned from
  // getShadowBreakdownData) mirroring shadow/page.tsx's exact fetch + preferApiPerDay dedupe,
  // since ShadowSinceLaunchStats needs the raw trade/publication rows, not the breakdown rows.
  const { shadowStartDate, analysts: shadowBreakdownAnalysts, rows: shadowBreakdownRows } = await getShadowBreakdownData()

  const rawSinceLaunchTrades: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data } = await supabase
        .from('actual_trades')
        .select('result_r, triggered, published_at, analyst_id, source_system')
        .in('source_system', ['ACUITY_PERFORMANCE_API', 'MANUAL_BACKFILL'])
        .gte('published_at', shadowStartDate)
        .order('trade_id', { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data?.length) { hasMore = false } else {
        rawSinceLaunchTrades.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }
  const sinceLaunchApiDatesByAnalyst = new Map<string, Set<string>>()
  for (const t of rawSinceLaunchTrades) {
    if (t.source_system === 'ACUITY_PERFORMANCE_API' && t.triggered && t.analyst_id && t.published_at) {
      const date = t.published_at.slice(0, 10)
      if (!sinceLaunchApiDatesByAnalyst.has(t.analyst_id)) sinceLaunchApiDatesByAnalyst.set(t.analyst_id, new Set())
      sinceLaunchApiDatesByAnalyst.get(t.analyst_id)!.add(date)
    }
  }
  const sinceLaunchActualTrades = rawSinceLaunchTrades.filter(t => {
    if (t.source_system === 'ACUITY_PERFORMANCE_API') return true
    if (!t.analyst_id || !t.published_at) return true
    return !sinceLaunchApiDatesByAnalyst.get(t.analyst_id)?.has(t.published_at.slice(0, 10))
  })

  const sinceLaunchActualPublications: any[] = []
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
        sinceLaunchActualPublications.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }

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
        analysts={(analysts as any[]) ?? []}
        kpiData={analystKpis}
        currentMonthStart={monthStart}
        lastMonthStart={lastMonthStart}
        shadowOutcomes={(shadowOutcomes as any[]) ?? []}
        actualTrades={(actualTrades as any[]) ?? []}
        shadowOutcomesRecent={shadowOutcomesRecent}
        lastWeekPublications={(lastWeekPubs as any[]) ?? []}
        lastWeekStart={lwStart}
        lastWeekEnd={lwEnd}
        thisMonthPublications={(thisMonthPubs as any[]) ?? []}
        sinceLaunchActualTrades={sinceLaunchActualTrades}
        sinceLaunchActualPublications={sinceLaunchActualPublications}
        shadowBreakdownRows={shadowBreakdownRows}
        shadowBreakdownAnalysts={shadowBreakdownAnalysts}
      />
    </div>
  )
}










