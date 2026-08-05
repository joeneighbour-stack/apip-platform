import { Suspense } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AnalystPerformanceTabs } from '@/components/analyst/AnalystPerformanceTabs'

export default async function AnalystPerformancePage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/login')
  if (!user.analystId) redirect('/dashboard/analyst')

  const supabase = await createClient()
  const adminDb = createAdminClient()

  // Only the caller's own analyst record is needed -- the analyst filter is locked and
  // hidden on this view, so there's no reason to hand the client the full roster.
  const { data: analystRow } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active')
    .eq('analyst_id', user.analystId)
    .single()

  const { data: markets } = await supabase
    .from('markets')
    .select('market_id, symbol, asset_class')
    .order('asset_class, symbol')

  // Same period math as management/performance/page.tsx's TeamPerformanceGrid feed,
  // scoped to this one analyst for the My KPIs tab.
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const lastMonth = new Date(Date.UTC(year, month - 1, 1))
  const lastMonthStart = `${lastMonth.getUTCFullYear()}-${String(lastMonth.getUTCMonth() + 1).padStart(2, '0')}-01`
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const d36 = new Date(Date.UTC(year, month - 35, 1))
  const thirtySixMonthsAgo = d36.toISOString().slice(0, 10)

  // executive_kpis RLS grants an ANALYST their own kpi_visibility='ANALYST_OWN' rows
  // directly (migrations/002_rls.sql) -- no admin client needed here.
  const { data: kpiData } = await supabase
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start')
    .eq('analyst_id', user.analystId)
    .gte('period_start', thirtySixMonthsAgo)
    .order('period_start', { ascending: true })

  // actual_trades_select_own (migrations/002_rls.sql) grants an ANALYST their own rows
  // directly. Both source systems, paginated the same way as the management fetch --
  // PostgREST caps responses at 1000 rows regardless of .limit().
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const actualTrades: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data } = await supabase
        .from('actual_trades')
        .select('result_r, triggered, published_at, source_system')
        .eq('analyst_id', user.analystId)
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

  // Last week (Mon-Fri) window, same calculation as management/performance/page.tsx.
  const lwNow = new Date()
  const lwDayOfWeek = lwNow.getUTCDay()
  const lwDaysToLastMonday = (lwDayOfWeek + 6) % 7 + 7
  const lastMon = new Date(lwNow)
  lastMon.setUTCDate(lwNow.getUTCDate() - lwDaysToLastMonday)
  const lastFri = new Date(lastMon)
  lastFri.setUTCDate(lastMon.getUTCDate() + 4)
  const lwStart = lastMon.toISOString().slice(0, 10)
  const lwEnd = lastFri.toISOString().slice(0, 10)

  // analyst_publications has no ANALYST self-select RLS policy at all (only ADMIN/RESEARCH
  // and MANAGER-scoped -- migrations/018_publication_rls.sql), the same reason
  // /api/analytics/publications uses the service-role client for ANALYST callers. Bypassing
  // RLS means these queries must scope to analyst_id themselves.
  const { data: lastWeekPubs } = await adminDb
    .from('analyst_publications')
    .select('reconciliation_status')
    .eq('analyst_id', user.analystId)
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .gte('published_at', lwStart)
    .lte('published_at', lwEnd + 'T23:59:59Z')

  const { data: thisMonthPubs } = await adminDb
    .from('analyst_publications')
    .select('reconciliation_status')
    .eq('analyst_id', user.analystId)
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .gte('published_at', monthStart)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-semibold">My Performance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Institutional-style performance analysis of your own trading history
          </p>
        </div>
        <a href="/dashboard/analyst"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Workspace
        </a>
      </div>
      <Suspense>
        <AnalystPerformanceTabs
          kpiSummaryProps={{
            kpiData: (kpiData as any[]) ?? [],
            currentMonthStart: monthStart,
            lastMonthStart,
            actualTrades: (actualTrades as any[]) ?? [],
            lastWeekPublications: (lastWeekPubs as any[]) ?? [],
            lastWeekStart: lwStart,
            lastWeekEnd: lwEnd,
            thisMonthPublications: (thisMonthPubs as any[]) ?? [],
          }}
          analyticsProps={{
            analysts: analystRow ? [analystRow as any] : [],
            markets: (markets as any[]) ?? [],
            lockedAnalystId: user.analystId,
          }}
        />
      </Suspense>
    </div>
  )
}
