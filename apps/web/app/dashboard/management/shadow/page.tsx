import { getCurrentUser } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ShadowMonitoringPanel } from '@/components/management/ShadowMonitoringPanel'
import { AnalystShadowBreakdown } from '@/components/management/AnalystShadowBreakdown'

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

  // ── Analyst vs Shadow Breakdown ──────────────────────────────────────────
  // Per-analyst, per-market/day comparison: for every shadow setup, did THIS
  // analyst publish a matching recommendation (same market_id + direction +
  // calendar date)? adminDb throughout, deliberately -- analyst_publications
  // and actual_trades RLS scope MANAGER to only their own managed analysts
  // (migrations/018_publication_rls.sql, 002_rls.sql), and this breakdown
  // must show every active analyst regardless of which manager is viewing.
  const { data: breakdownAnalystsRaw } = await adminDb
    .from('analysts')
    .select('analyst_id, display_name')
    .eq('active', true)
    .order('display_name')
  const breakdownAnalysts = (breakdownAnalystsRaw as any[]) ?? []

  const breakdownShadowRaw: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data } = await adminDb
        .from('shadow_trade_outcomes')
        .select(`
          shadow_outcome_id,
          trade_outcome_status,
          result_r,
          shadow_trade:shadow_trade_id (
            rr, direction, generated_at,
            opportunity:opportunity_id (
              market_id,
              market:market_id ( symbol )
            )
          )
        `)
        .order('shadow_outcome_id', { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data?.length) { hasMore = false } else {
        breakdownShadowRaw.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }

  const breakdownPublications: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data } = await adminDb
        .from('analyst_publications')
        .select('analyst_id, market_id, direction, published_at, effective_triggered')
        .eq('source_system', 'ACUITY_PERFORMANCE_API')
        .gte('published_at', shadowStartDate)
        .order('publication_id', { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data?.length) { hasMore = false } else {
        breakdownPublications.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }

  const breakdownActualTrades: any[] = []
  {
    const PAGE_SIZE = 1000
    let page = 0
    let hasMore = true
    while (hasMore) {
      const { data } = await adminDb
        .from('actual_trades')
        .select('analyst_id, market_id, direction, published_at, result_r, triggered, source_system')
        .in('source_system', ['ACUITY_PERFORMANCE_API', 'MANUAL_BACKFILL'])
        .gte('published_at', shadowStartDate)
        .order('trade_id', { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data?.length) { hasMore = false } else {
        breakdownActualTrades.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }
  }

  const breakdownKey = (analystId: string, marketId: string, direction: string, date: string) =>
    `${analystId}::${marketId}::${direction}::${date}`

  // Publications carry effective_triggered but not a result -- a WEBHOOK_TRUE row has no
  // matched_trade_id (see migrations/015_publication_reconciliation.sql), so the R value for
  // a triggered publication has to come from a separate join to actual_trades on
  // analyst_id+market_id+direction+date. Same API-preferred, triggered-only source rule as
  // preferApiPerDay() above, scoped down to the exact match key instead of just date.
  const breakdownApiTriggeredKeys = new Set<string>()
  for (const t of breakdownActualTrades) {
    if (t.source_system === 'ACUITY_PERFORMANCE_API' && t.triggered && t.analyst_id && t.market_id && t.direction && t.published_at) {
      breakdownApiTriggeredKeys.add(breakdownKey(t.analyst_id, t.market_id, t.direction, t.published_at.slice(0, 10)))
    }
  }
  const breakdownResultByKey = new Map<string, number | null>()
  for (const t of breakdownActualTrades) {
    if (!t.triggered || !t.analyst_id || !t.market_id || !t.direction || !t.published_at) continue
    const key = breakdownKey(t.analyst_id, t.market_id, t.direction, t.published_at.slice(0, 10))
    if (t.source_system === 'MANUAL_BACKFILL' && breakdownApiTriggeredKeys.has(key)) continue
    breakdownResultByKey.set(key, t.result_r)
  }

  const breakdownPubByKey = new Map<string, { effective_triggered: boolean }>()
  for (const p of breakdownPublications) {
    if (!p.analyst_id || !p.market_id || !p.direction || !p.published_at) continue
    breakdownPubByKey.set(breakdownKey(p.analyst_id, p.market_id, p.direction, p.published_at.slice(0, 10)), p)
  }

  // Shadow trades aren't analyst-specific -- every active analyst is compared against the
  // same universe of shadow setups, with "no publication" being the expected/common result
  // for markets that analyst wasn't assigned that day.
  const breakdownRows: {
    date: string; symbol: string; direction: string
    shadowStatus: string; shadowR: number | null
    analystId: string; hasPublication: boolean
    analystTriggered: boolean | null; analystR: number | null
  }[] = []
  for (const outcome of breakdownShadowRaw) {
    const st = outcome.shadow_trade
    const opp = st?.opportunity
    const marketId = opp?.market_id
    const symbol = opp?.market?.symbol
    const direction = st?.direction
    const date = st?.generated_at?.slice(0, 10)
    if (!marketId || !symbol || !direction || !date) continue
    const shadowR = outcome.result_r !== null ? Number(outcome.result_r)
      : outcome.trade_outcome_status === 'TARGET_HIT' ? Number(st.rr)
      : outcome.trade_outcome_status === 'STOP_HIT' ? -1
      : null

    for (const analyst of breakdownAnalysts) {
      const key = breakdownKey(analyst.analyst_id, marketId, direction, date)
      const pub = breakdownPubByKey.get(key)
      breakdownRows.push({
        date, symbol, direction,
        shadowStatus: outcome.trade_outcome_status,
        shadowR,
        analystId: analyst.analyst_id,
        hasPublication: !!pub,
        analystTriggered: pub ? pub.effective_triggered : null,
        analystR: pub?.effective_triggered ? breakdownResultByKey.get(key) ?? null : null,
      })
    }
  }

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
      <AnalystShadowBreakdown
        rows={breakdownRows}
        analysts={breakdownAnalysts}
      />
    </div>
  )
}
