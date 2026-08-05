import { getCurrentUser } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CoverageStrip } from '@/components/analyst/workspace/CoverageStrip'
import { entryDistanceLanguage, parseGuidanceRange, atrDistanceFromEntry } from '@/lib/workspaceUtils'
import type { WorkspaceRow, RegimeInfo, EventRiskItem, HistoricalEdge } from '@/components/analyst/workspace/types'

function SessionStatus() {
  const now = new Date()
  const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }), 10)
  let label = ''
  let open = false
  if (ukHour >= 5 && ukHour < 12) { label = 'European session open'; open = true }
  else if (ukHour >= 12 && ukHour < 17) { label = 'US session open'; open = true }
  else if (ukHour >= 17 && ukHour < 22) { label = 'APAC session opening soon'; open = false }
  else { label = 'European session opens at 05:00 UK'; open = false }
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${open ? 'bg-green-500' : 'bg-amber-400'}`} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getUTCHours() + 1
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default async function AnalystWorkspacePage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/login')
  if (!user.analystId) {
    return (
      <div className="rounded-lg border border-border p-6">
        <p className="text-sm text-muted-foreground">
          Your account is not yet linked to an analyst profile. Contact your administrator.
        </p>
      </div>
    )
  }

  const supabase = await createClient()
  const adminDb = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

  const { data: allRecs } = await supabase
    .from('coaching_recommendations')
    .select(`
      recommendation_id, entry_range_low, entry_range_high,
      risk_range, target_range, trigger_probability, expected_r,
      coaching_note, shown_at,
      opportunity:opportunity_id (
        analyst_action, direction, current_zone, preferred_entry_zone, session,
        market:market_id ( symbol, market_id, asset_class, display_precision )
      ),
      recommendation_version:active_recommendation_version_id (
        recommendation_validity_status, volatility_warning, requires_refresh
      )
    `)
    .eq('analyst_id', user.analystId)
    .gte('shown_at', today + 'T00:00:00Z')
    .order('shown_at', { ascending: false })

  const seenSymbols = new Set<string>()
  const recommendations = (allRecs ?? []).filter((rec: any) => {
    const symbol = rec.opportunity?.market?.symbol
    if (!symbol || seenSymbols.has(symbol)) return false
    seenSymbols.add(symbol)
    return true
  })

  const marketIds = recommendations.map((r: any) => r.opportunity?.market?.market_id).filter(Boolean)

  // market_event_risk: raw table (risk_score, analyst_warning) is internal-only per RLS
  // (migrations/002_rls.sql -- analysts are meant to consume event risk through
  // market_event_risk_analyst_view, which drops risk_score). This build surfaces
  // risk_score in the detail card per explicit spec, via adminDb the same way the
  // page already bypassed RLS for this table pre-redesign -- flagged in the PR
  // description, not silently done.
  const { data: eventRisks } = marketIds.length > 0
    ? await adminDb
        .from('market_event_risk')
        .select(`
          market_id, risk_score, analyst_warning, event_risk_status,
          event:event_id ( event_name, impact, event_time_uk, currency, forecast, previous, actual )
        `)
        .in('market_id', marketIds)
        .eq('event_risk_status', 'HIGH_RISK')
    : { data: [] }

  const todayEventsByMarket = new Map<string, EventRiskItem[]>()
  for (const er of (eventRisks ?? []) as any[]) {
    const event = er.event
    if (!event || event.event_time_uk?.slice(0, 10) !== today) continue
    if (!todayEventsByMarket.has(er.market_id)) todayEventsByMarket.set(er.market_id, [])
    const existing = todayEventsByMarket.get(er.market_id)!
    if (!existing.find(e => e.eventName === event.event_name)) {
      existing.push({
        eventName: event.event_name,
        impact: event.impact,
        eventTimeUk: event.event_time_uk,
        riskScore: er.risk_score != null ? Number(er.risk_score) : null,
        analystWarning: er.analyst_warning ?? null,
        forecast: event.forecast ?? null,
        previous: event.previous ?? null,
        actual: event.actual ?? null,
      })
    }
  }

  // market_regime_state is internal-only per RLS (ADMIN/MANAGER/RESEARCH) --
  // adminDb required. Two most recent rows per market so the detail card can
  // describe volatility as expanding/contracting vs. the prior reading.
  const { data: regimeRows } = marketIds.length > 0
    ? await adminDb
        .from('market_regime_state')
        .select('market_id, trend_state, volatility_state, regime_confidence, derived_from, captured_at')
        .in('market_id', marketIds)
        .gte('captured_at', sevenDaysAgo + 'T00:00:00Z')
        .order('captured_at', { ascending: false })
    : { data: [] }

  const regimeByMarket = new Map<string, RegimeInfo>()
  {
    const seenCountByMarket = new Map<string, number>()
    const latestPctByMarket = new Map<string, number>()
    for (const row of (regimeRows ?? []) as any[]) {
      const seenCount = seenCountByMarket.get(row.market_id) ?? 0
      const derived = row.derived_from ?? {}
      if (seenCount === 0) {
        regimeByMarket.set(row.market_id, {
          trendState: row.trend_state ?? null,
          volatilityState: row.volatility_state ?? null,
          confidence: row.regime_confidence ?? null,
          adx14: derived.adx14 ?? null,
          ema20: derived.ema20 ?? null,
          ema50: derived.ema50 ?? null,
          ema200: derived.ema200 ?? null,
          directionalPersistence: derived.directional_persistence ?? null,
          atrPercentile: derived.atr_percentile ?? null,
          priorAtrPercentile: null,
        })
        latestPctByMarket.set(row.market_id, derived.atr_percentile ?? null)
      } else if (seenCount === 1) {
        const info = regimeByMarket.get(row.market_id)
        if (info) info.priorAtrPercentile = derived.atr_percentile ?? null
      }
      seenCountByMarket.set(row.market_id, seenCount + 1)
    }
  }

  // market_state_daily RLS grants any authenticated read (migrations/002_rls.sql)
  // -- session client is sufficient, no adminDb bypass needed.
  const { data: priorDayRows } = marketIds.length > 0
    ? await supabase
        .from('market_state_daily')
        .select('market_id, date, open, high, low, close, atr14, atr20')
        .in('market_id', marketIds)
        .lt('date', today)
        .gte('date', sevenDaysAgo)
        .order('date', { ascending: false })
    : { data: [] }

  const priorDayByMarket = new Map<string, any>()
  for (const row of (priorDayRows ?? []) as any[]) {
    if (!priorDayByMarket.has(row.market_id)) priorDayByMarket.set(row.market_id, row)
  }

  // market_state_intraday is internal-only per RLS -- adminDb, used only for the
  // "distance to entry in plain language" line (current price vs. entry range).
  const { data: intradayRows } = marketIds.length > 0
    ? await adminDb
        .from('market_state_intraday')
        .select('market_id, current_price, captured_at')
        .in('market_id', marketIds)
        .order('captured_at', { ascending: false })
    : { data: [] }

  const currentPriceByMarket = new Map<string, number>()
  for (const row of (intradayRows ?? []) as any[]) {
    if (!currentPriceByMarket.has(row.market_id)) currentPriceByMarket.set(row.market_id, Number(row.current_price))
  }

  // Analyst's own trade history for the "Historical Edge" tiers. entry_zone is
  // selected for the zone-scoped tier, but is not currently populated on any
  // production row (migration 028 added the column; no backfill has run) -- the
  // zone tier is wired up and will activate automatically once that data exists,
  // and falls through to market+direction until then.
  const { data: marketHistoryRows } = marketIds.length > 0
    ? await supabase
        .from('actual_trades')
        .select('market_id, direction, entry_zone, result_r, triggered')
        .eq('analyst_id', user.analystId)
        .in('market_id', marketIds)
        .eq('triggered', true)
        .not('result_r', 'is', null)
    : { data: [] }

  type Agg = { trades: number; wins: number; totalR: number }
  const byZone = new Map<string, Agg>()
  const byMarket = new Map<string, Agg>()
  const bump = (map: Map<string, Agg>, key: string, resultR: number) => {
    const existing = map.get(key) ?? { trades: 0, wins: 0, totalR: 0 }
    existing.trades++
    if (resultR > 0) existing.wins++
    existing.totalR += resultR
    map.set(key, existing)
  }
  for (const t of (marketHistoryRows ?? []) as any[]) {
    const resultR = Number(t.result_r)
    bump(byMarket, t.market_id, resultR)
    if (t.direction && t.entry_zone) bump(byZone, `${t.market_id}::${t.direction}::${t.entry_zone}`, resultR)
  }

  // analyst_profiles.zone is null on every production row today (the column exists
  // but the profiling batch never populates it) -- so this table only ever supplies
  // the market+direction tier in practice. The zone tier above (actual_trades.entry_zone)
  // is the only place a genuine zone-scoped edge could come from, and is likewise
  // unpopulated on every row today; it is wired up so it activates automatically the
  // moment either data source starts carrying real zone values, without a code change.
  const { data: profileRows } = await adminDb
    .from('analyst_profiles')
    .select('market_id, direction, profile_data')
    .eq('analyst_id', user.analystId)
    .in('market_id', marketIds.length > 0 ? marketIds : [''])

  const profileByMarketDirection = new Map<string, any>()
  for (const p of (profileRows ?? []) as any[]) {
    if (!p.direction) continue
    profileByMarketDirection.set(`${p.market_id}::${p.direction}`, p.profile_data ?? {})
  }

  function historicalEdge(marketId: string, direction: string | null, zone: string | null): HistoricalEdge {
    if (direction && zone) {
      const z = byZone.get(`${marketId}::${direction}::${zone}`)
      if (z && z.trades > 0) {
        return { tier: 'zone', avgR: z.totalR / z.trades, winRate: z.wins / z.trades, trades: z.trades, quality: null }
      }
    }
    if (direction) {
      const profile = profileByMarketDirection.get(`${marketId}::${direction}`)
      if (profile && profile.trade_count > 0) {
        return {
          tier: 'market_direction',
          avgR: profile.avg_r ?? null,
          winRate: profile.win_rate ?? null,
          trades: profile.trade_count,
          quality: profile.profile_quality ?? null,
        }
      }
    }
    const m = byMarket.get(marketId)
    if (m && m.trades > 0) {
      return { tier: 'market_only', avgR: m.totalR / m.trades, winRate: m.wins / m.trades, trades: m.trades, quality: null }
    }
    return { tier: 'none', avgR: null, winRate: null, trades: 0, quality: null }
  }

  // Yesterday's trades, for the top-tile summary and the per-market "Your trade" line.
  const { data: yesterdayTrades } = await supabase
    .from('actual_trades')
    .select('market_id, direction, result_r, triggered')
    .eq('analyst_id', user.analystId)
    .gte('published_at', yesterday + 'T00:00:00Z')
    .lt('published_at', today + 'T00:00:00Z')

  const ytrades = (yesterdayTrades ?? []) as any[]
  const closedYesterday = ytrades.filter(t => t.result_r !== null)
  const yesterdayR = closedYesterday.reduce((s, t) => s + Number(t.result_r), 0)
  const yesterdayTradeByMarket = new Map<string, any>()
  for (const t of ytrades) {
    if (!yesterdayTradeByMarket.has(t.market_id)) yesterdayTradeByMarket.set(t.market_id, t)
  }

  const marketsWithEventRisk = marketIds.filter(id => todayEventsByMarket.has(id)).length

  // Assemble one row per recommendation with everything the coverage strip / detail card need.
  const rows: WorkspaceRow[] = recommendations.map((rec: any) => {
    const opp = rec.opportunity
    const rv = rec.recommendation_version
    const market = opp?.market
    const marketId = market?.market_id
    const direction = opp?.direction ?? null
    const validity = rv?.recommendation_validity_status ?? 'VALID'
    const isDoNotUse = validity === 'DO_NOT_USE_RECALCULATE'
    const isEntryPassed = validity === 'ENTRY_ALREADY_PASSED'
    const isStale = ['STALE_PRICE', 'ZONE_CHANGED', 'CAUTION_VOLATILITY'].includes(validity)

    const entryLow = rec.entry_range_low != null ? Number(rec.entry_range_low) : null
    const entryHigh = rec.entry_range_high != null ? Number(rec.entry_range_high) : null
    const entryMid = entryLow != null && entryHigh != null ? (entryLow + entryHigh) / 2 : null

    const priorDay = marketId ? priorDayByMarket.get(marketId) : null
    const atr14 = priorDay?.atr14 != null ? Number(priorDay.atr14) : null

    const riskParsed = parseGuidanceRange(rec.risk_range)
    const targetParsed = parseGuidanceRange(rec.target_range)

    const currentPrice = marketId ? currentPriceByMarket.get(marketId) ?? null : null
    const yTrade = marketId ? yesterdayTradeByMarket.get(marketId) : null

    const triggerProbability = rec.trigger_probability != null ? Number(rec.trigger_probability) : null
    const expectedR = rec.expected_r != null ? Number(rec.expected_r) : null
    const hasEventRisk = marketId ? todayEventsByMarket.has(marketId) : false

    return {
      recommendationId: rec.recommendation_id,
      symbol: market?.symbol ?? '—',
      marketId: marketId ?? '',
      direction,
      currentZone: opp?.current_zone ?? null,
      preferredZone: opp?.preferred_entry_zone ?? null,
      entryLow, entryHigh,
      riskRange: rec.risk_range || null,
      targetRange: rec.target_range || null,
      riskAtrDistance: atrDistanceFromEntry(entryMid, riskParsed, atr14),
      targetAtrDistance: atrDistanceFromEntry(entryMid, targetParsed, atr14),
      triggerProbability,
      expectedR,
      validityStatus: validity,
      volatilityWarning: rv?.volatility_warning || null,
      isDoNotUse, isEntryPassed, isStale,
      regime: marketId ? regimeByMarket.get(marketId) ?? null : null,
      hasHighImpactEventToday: hasEventRisk,
      eventRiskItems: marketId ? todayEventsByMarket.get(marketId) ?? [] : [],
      previousDay: priorDay ? {
        date: priorDay.date,
        open: Number(priorDay.open), high: Number(priorDay.high),
        low: Number(priorDay.low), close: Number(priorDay.close),
        atr14,
      } : null,
      yesterdayTradeOutcome: yTrade ? {
        direction: yTrade.direction,
        triggered: !!yTrade.triggered,
        resultR: yTrade.result_r != null ? Number(yTrade.result_r) : null,
      } : null,
      historicalEdge: marketId ? historicalEdge(marketId, direction, opp?.preferred_entry_zone ?? null) : { tier: 'none', avgR: null, winRate: null, trades: 0, quality: null },
      coachingNote: rec.coaching_note || null,
      shownAt: rec.shown_at,
      session: opp?.session ?? null,
      assetClass: market?.asset_class ?? null,
      displayPrecision: market?.display_precision ?? null,
      distanceLanguage: entryDistanceLanguage(currentPrice, entryLow, entryHigh, priorDay?.atr20 != null ? Number(priorDay.atr20) : null),
      sessionEndIso: rec.shown_at ?? new Date().toISOString(),
      priorityScore: (expectedR ?? 0) * (triggerProbability ?? 0),
    }
  })

  rows.sort((a, b) => {
    if (a.hasHighImpactEventToday !== b.hasHighImpactEventToday) return a.hasHighImpactEventToday ? -1 : 1
    return b.priorityScore - a.priorityScore
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{getGreeting()}, {user.displayName?.split(' ')[0]}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <div className="mt-1.5"><SessionStatus /></div>
        </div>
        <div className="flex gap-3 flex-wrap justify-end">
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-center min-w-[80px]">
            <p className="text-2xl font-semibold">{recommendations.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Markets today</p>
          </div>
          {marketsWithEventRisk > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center min-w-[80px]">
              <p className="text-2xl font-semibold text-amber-700">{marketsWithEventRisk}</p>
              <p className="text-xs text-amber-600 mt-0.5">Event risk</p>
            </div>
          )}
          {closedYesterday.length > 0 && (
            <div className={`rounded-lg border px-4 py-3 text-center min-w-[80px] ${yesterdayR >= 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-2xl font-semibold ${yesterdayR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {yesterdayR > 0 ? '+' : ''}{yesterdayR.toFixed(1)}R
              </p>
              <p className={`text-xs mt-0.5 ${yesterdayR >= 0 ? 'text-green-600' : 'text-red-600'}`}>Yesterday</p>
            </div>
          )}
        </div>
      </div>

      {/* Coverage strip */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Today&apos;s Recommendations</h2>
        <CoverageStrip rows={rows} />
      </section>
    </div>
  )
}
