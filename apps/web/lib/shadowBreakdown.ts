import { createClient, createAdminClient } from '@/lib/supabase/server'

export interface ShadowBreakdownRow {
  analystId: string
  date: string
  symbol: string
  analystDirection: string
  analystTriggered: boolean
  analystR: number | null
  shadowDirection: string | null
  shadowStatus: string
  shadowR: number | null
}

export interface ShadowBreakdownAnalyst {
  analyst_id: string
  display_name: string
}

export interface ShadowBreakdownData {
  // Earliest shadow_trades.generated_at (falls back to 90 days ago if shadow_trades is
  // empty) -- the floor every "since platform launch" comparison should use, on both the
  // Shadow Monitoring page and Team Performance, so the two pages' numbers agree.
  shadowStartDate: string
  analysts: ShadowBreakdownAnalyst[]
  rows: ShadowBreakdownRow[]
}

// Per-analyst comparison, scoped to each analyst's own coverage: for every market+date THIS
// analyst published on, is there a shadow trade for the same market+date? Direction is
// deliberately NOT part of the match key -- the comparison question is "did the shadow
// system also look at this market on this day", not "did it pick the same side". adminDb
// throughout -- analyst_publications and actual_trades RLS scope MANAGER to only their own
// managed analysts (migrations/018_publication_rls.sql, 002_rls.sql), and this must show
// every active analyst regardless of which manager is viewing.
//
// Shared by the Shadow Monitoring page (AnalystShadowBreakdown in its own section) and Team
// Performance (the same component, replacing the old simplified shadow summary) -- same
// query, same computation, so both pages show identical numbers for "the same" comparison.
export async function getShadowBreakdownData(): Promise<ShadowBreakdownData> {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data: earliestShadowTrade } = await supabase
    .from('shadow_trades')
    .select('generated_at')
    .order('generated_at', { ascending: true })
    .limit(1)
  const shadowStartDate = (earliestShadowTrade as any[] | null)?.[0]?.generated_at?.slice(0, 10) ?? ninetyDaysAgo

  const { data: breakdownAnalystsRaw } = await adminDb
    .from('analysts')
    .select('analyst_id, display_name')
    .eq('active', true)
    .order('display_name')
  const analysts = (breakdownAnalystsRaw as any[]) ?? []

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

  // Shadow side, keyed by market_id + date only -- one shadow trade per market/day is
  // expected, so the first match wins if that's ever violated rather than silently
  // overwriting.
  const breakdownShadowByMarketDate = new Map<string, {
    symbol: string; direction: string | null; status: string; resultR: number | null
  }>()
  for (const outcome of breakdownShadowRaw) {
    const st = outcome.shadow_trade
    const opp = st?.opportunity
    const marketId = opp?.market_id
    const symbol = opp?.market?.symbol
    const date = st?.generated_at?.slice(0, 10)
    if (!marketId || !symbol || !date) continue
    const key = `${marketId}::${date}`
    if (breakdownShadowByMarketDate.has(key)) continue
    const resultR = outcome.result_r !== null ? Number(outcome.result_r)
      : outcome.trade_outcome_status === 'TARGET_HIT' ? Number(st.rr)
      : outcome.trade_outcome_status === 'STOP_HIT' ? -1
      : null
    breakdownShadowByMarketDate.set(key, { symbol, direction: st?.direction ?? null, status: outcome.trade_outcome_status, resultR })
  }

  // Analyst's own triggered-trade result, keyed by analyst+market+direction+date -- a
  // WEBHOOK_TRUE publication has no matched_trade_id, so the R value for a triggered
  // publication has to come from a separate join to actual_trades. API-preferred,
  // triggered-only source rule, scoped to the exact match key.
  const breakdownResultKey = (analystId: string, marketId: string, direction: string, date: string) =>
    `${analystId}::${marketId}::${direction}::${date}`

  const breakdownApiTriggeredKeys = new Set<string>()
  for (const t of breakdownActualTrades) {
    if (t.source_system === 'ACUITY_PERFORMANCE_API' && t.triggered && t.analyst_id && t.market_id && t.direction && t.published_at) {
      breakdownApiTriggeredKeys.add(breakdownResultKey(t.analyst_id, t.market_id, t.direction, t.published_at.slice(0, 10)))
    }
  }
  const breakdownResultByKey = new Map<string, number | null>()
  for (const t of breakdownActualTrades) {
    if (!t.triggered || !t.analyst_id || !t.market_id || !t.direction || !t.published_at) continue
    const key = breakdownResultKey(t.analyst_id, t.market_id, t.direction, t.published_at.slice(0, 10))
    if (t.source_system === 'MANUAL_BACKFILL' && breakdownApiTriggeredKeys.has(key)) continue
    breakdownResultByKey.set(key, t.result_r)
  }

  // Scope to each analyst's own coverage: only market+date pairs THIS analyst published
  // on. A shadow trade for a market the analyst never covered isn't a valid comparison,
  // and a market+date the analyst covered but shadow didn't isn't one either.
  const breakdownActiveAnalystIds = new Set(analysts.map((a: any) => a.analyst_id))
  const rows: ShadowBreakdownRow[] = []
  for (const p of breakdownPublications) {
    if (!p.analyst_id || !p.market_id || !p.direction || !p.published_at) continue
    if (!breakdownActiveAnalystIds.has(p.analyst_id)) continue
    const date = p.published_at.slice(0, 10)
    const shadow = breakdownShadowByMarketDate.get(`${p.market_id}::${date}`)
    if (!shadow) continue

    rows.push({
      analystId: p.analyst_id,
      date,
      symbol: shadow.symbol,
      analystDirection: p.direction,
      analystTriggered: p.effective_triggered,
      analystR: p.effective_triggered ? breakdownResultByKey.get(breakdownResultKey(p.analyst_id, p.market_id, p.direction, date)) ?? null : null,
      shadowDirection: shadow.direction,
      shadowStatus: shadow.status,
      shadowR: shadow.resultR,
    })
  }

  return { shadowStartDate, analysts, rows }
}
