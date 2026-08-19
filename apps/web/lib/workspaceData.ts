import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  entryDistanceLanguage, parseGuidanceRange, atrDistanceFromEntry, marketCurrencies, computeZoneBoundaries, trendLabelFull,
  selectEvidenceTier, type EvidenceTier, type TierProfile,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow, RegimeInfo, EventRiskItem, HistoricalEdge, PriceBar } from '@/components/analyst/workspace/types'

const EVENT_CAP = 4
// Trade context chart shows 10 trading days (redesign spec). Fetched over a wider
// 20-calendar-day cutoff and sliced below, same "fetch wide, slice narrow" reasoning
// as before -- 10 calendar days isn't reliably 10 TRADING days across a holiday week.
const CHART_TRADING_DAYS = 10

export interface WorkspaceData {
  rows: WorkspaceRow[]
  marketsToday: number
  marketsWithEventRisk: number
  yesterdayR: number
  closedYesterdayCount: number
  // Section 4 selection funnel -- total opportunities/recommendations generated
  // across ALL analysts today (any session), via adminDb since opportunities RLS
  // scopes ANALYST to their own assigned rows only (migrations/002_rls.sql).
  recommendationsGeneratedToday: number
}

// Shared by the analyst's own workspace (/dashboard/analyst, their own analyst_id) and the
// management read-only workspace view (/dashboard/management/analyst/[analystId]/workspace,
// an arbitrary analyst_id) -- same queries, same row assembly either way.
//
// coaching_recommendations uses adminDb rather than the session client: the analyst's own
// page worked fine on the session client because ANALYST has a self-select RLS grant there,
// but MANAGER has no equivalent broad grant for an arbitrary analyst_id (confirmed by
// lib/analystProfile.ts's getAnalystProfileData, which already serves this exact
// analyst-vs-management dual-caller shape and uses adminDb for the same table for the same
// reason). Every other query here already explicitly scopes by analystId in application code
// regardless of client, and actual_trades/market_state_daily RLS already grants both ANALYST
// self-access and broad MANAGER access (same file's comment), so those stay on the session
// client unchanged.
export async function getWorkspaceData(analystId: string): Promise<WorkspaceData> {
  const supabase = await createClient()
  const adminDb = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

  // Wave 1 -- none of these four depend on each other or on anything computed below.
  // allRecs is the only one wave 2 needs anything from (marketIds, extracted after this
  // resolves); the other three don't depend on allRecs either, so there's no reason to
  // make any of them wait on one another. Collapses 4 sequential round-trips into 1.
  const [
    { data: allRecs },
    { data: allAnalystProfileRowsRaw },
    { data: yesterdayTrades },
    { count: recommendationsGeneratedToday },
  ] = await Promise.all([
    adminDb
      .from('coaching_recommendations')
      .select(`
        recommendation_id, opportunity_id, entry_range_low, entry_range_high,
        risk_range, target_range, trigger_probability, expected_r,
        coaching_note, shown_at,
        opportunity:opportunity_id (
          analyst_action, direction, current_zone, preferred_entry_zone, session,
          market:market_id ( symbol, market_id, asset_class, display_precision )
        ),
        recommendation_version:active_recommendation_version_id (
          recommendation_validity_status, volatility_warning, requires_refresh, regime_tags
        )
      `)
      .eq('analyst_id', analystId)
      .gte('shown_at', today + 'T00:00:00Z')
      .order('shown_at', { ascending: false }),
    // This analyst's FULL profile set, every market (not scoped to marketIds) --
    // needed for the tiered evidence system's REGIME tier, which deliberately
    // rolls up across every market in the same asset class, not just today's
    // recommended ones. asset_class comes from the market:market_id FK embed
    // rather than a separate markets query. Mirrors
    // intelligence-engine/src/services/analystScoringService.ts's own tiers.
    // Scoped by analystId only -- independent of allRecs/marketIds.
    adminDb
      .from('analyst_profiles')
      .select('market_id, direction, profile_data, market:market_id ( asset_class )')
      .eq('analyst_id', analystId),
    // Yesterday's trades, for the top-tile summary and the per-market "Your trade" line.
    // Scoped by analystId + a fixed date range only -- independent of allRecs/marketIds.
    supabase
      .from('actual_trades')
      .select('market_id, direction, result_r, triggered')
      .eq('analyst_id', analystId)
      .gte('published_at', yesterday + 'T00:00:00Z')
      .lt('published_at', today + 'T00:00:00Z'),
    // Section 4 selection funnel, "N with recommendations generated" -- total opportunities
    // for today across every analyst/session, via adminDb (opportunities RLS scopes ANALYST
    // to only their own assigned rows, migrations/002_rls.sql). Every opportunity gets exactly
    // one recommendation_version at generation (runEngineSession.ts), so this count doubles as
    // "recommendations generated." Scoped by today's date only -- independent of allRecs/marketIds.
    adminDb
      .from('opportunities')
      .select('opportunity_id', { count: 'exact', head: true })
      .eq('date', today),
  ])

  const seenSymbols = new Set<string>()
  const recommendations = (allRecs ?? []).filter((rec: any) => {
    const symbol = rec.opportunity?.market?.symbol
    if (!symbol || seenSymbols.has(symbol)) return false
    seenSymbols.add(symbol)
    return true
  })

  const marketIds = recommendations.map((r: any) => r.opportunity?.market?.market_id).filter(Boolean)

  const marketMetaById = new Map<string, { symbol: string; assetClass: string | null }>()
  for (const rec of recommendations as any[]) {
    const market = rec.opportunity?.market
    if (market?.market_id && !marketMetaById.has(market.market_id)) {
      marketMetaById.set(market.market_id, { symbol: market.symbol, assetClass: market.asset_class ?? null })
    }
  }

  const priceHistoryFetchStart = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10)

  // Wave 2 -- all seven of these depend only on marketIds (resolved just above) and/or
  // analystId, never on each other, so they all run together too. Collapses 7 sequential
  // round-trips into 1.
  const [
    { data: eventRisks },
    { data: regimeRows },
    { data: priorDayRows },
    { data: priceHistoryRows },
    { data: intradayRows },
    { data: marketHistoryRows },
    { data: profileRows },
  ] = await Promise.all([
    // market_event_risk: raw table (risk_score, analyst_warning) is internal-only per RLS
    // (migrations/002_rls.sql -- analysts are meant to consume event risk through
    // market_event_risk_analyst_view, which drops risk_score). adminDb bypasses this
    // deliberately, same as before this function was extracted.
    marketIds.length > 0
      ? adminDb
          .from('market_event_risk')
          .select(`
            market_id, risk_score, analyst_warning, event_risk_status,
            event:event_id ( event_name, impact, event_time_uk, currency, forecast, previous, actual )
          `)
          .in('market_id', marketIds)
          .eq('event_risk_status', 'HIGH_RISK')
      : Promise.resolve({ data: [] as any[] }),
    // market_regime_state is internal-only per RLS (ADMIN/MANAGER/RESEARCH) -- adminDb
    // required. No date window here: the regime batch job doesn't write a row for every
    // market every day, so a recent-window filter was silently dropping markets whose last
    // real update happened to fall just outside it. Ordering by captured_at desc + taking
    // the first two rows per market (below) always gets the true latest reading regardless
    // of how old it is.
    marketIds.length > 0
      ? adminDb
          .from('market_regime_state')
          .select('market_id, trend_state, volatility_state, regime_confidence, derived_from, captured_at')
          .in('market_id', marketIds)
          .order('captured_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    // market_state_daily RLS grants any authenticated read -- session client is sufficient.
    marketIds.length > 0
      ? supabase
          .from('market_state_daily')
          .select('market_id, date, open, high, low, close, atr14, atr20')
          .in('market_id', marketIds)
          .lt('date', today)
          .gte('date', sevenDaysAgo)
          .order('date', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    // Last 10 TRADING days of OHLC for the trade context chart. Fetched over a wider
    // 20-calendar-day cutoff and sliced to the last 10 rows per market below, rather than
    // gte'ing "10 days ago" directly: a pure 10-calendar-day cutoff would return fewer than
    // 10 trading days across a week that includes a weekend or holiday.
    marketIds.length > 0
      ? supabase
          .from('market_state_daily')
          .select('market_id, date, open, high, low, close')
          .in('market_id', marketIds)
          .gte('date', priceHistoryFetchStart)
          .order('date', { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    // market_state_intraday is internal-only per RLS -- adminDb. Session anchors
    // (session_high/session_low/previous_close) for the zone calc, plus current price.
    marketIds.length > 0
      ? adminDb
          .from('market_state_intraday')
          .select('market_id, current_price, session_high, session_low, previous_close, captured_at')
          .in('market_id', marketIds)
          .order('captured_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    // Analyst's own trade history for the "Historical Edge" tiers. entry_zone is selected for
    // the zone-scoped tier, but is not currently populated on any production row -- the zone
    // tier is wired up and will activate automatically once that data exists, and falls
    // through to market+direction until then.
    marketIds.length > 0
      ? supabase
          .from('actual_trades')
          .select('market_id, direction, entry_zone, result_r, triggered')
          .eq('analyst_id', analystId)
          .in('market_id', marketIds)
          .eq('triggered', true)
          .not('result_r', 'is', null)
      : Promise.resolve({ data: [] as any[] }),
    // analyst_profiles.zone is null on every production row today -- this table only ever
    // supplies the market+direction tier in practice. The zone tier above
    // (actual_trades.entry_zone) is the only place a genuine zone-scoped edge could come
    // from, and is likewise unpopulated on every row today; wired up to activate
    // automatically the moment either data source starts carrying real zone values.
    //
    // Fetched as an ARRAY per (market, direction), not a single row: generateAnalystProfiles.ts
    // writes one row PER REGIME (profile_data.regime = TRENDING_UP/TRENDING_DOWN/RANGE/MIXED)
    // whenever regime-specific data exists, and only falls back to a single regime-agnostic
    // row when it doesn't -- so "this analyst's overall record for market+direction" has to be
    // computed by blending across whichever rows exist, not read off one row directly.
    adminDb
      .from('analyst_profiles')
      .select('market_id, direction, profile_data')
      .eq('analyst_id', analystId)
      .in('market_id', marketIds.length > 0 ? marketIds : ['']),
  ])

  // risk_score is a fixed categorical value keyed off event_risk_status, not a
  // continuous per-event score (verified live: WATCH rows are always 0.5,
  // HIGH_RISK rows always 0.9) -- every row here reads 9.0/10 because this
  // fetch already filters to HIGH_RISK only, not because of a join-key bug.
  const todayEventsByMarket = new Map<string, EventRiskItem[]>()
  for (const er of (eventRisks ?? []) as any[]) {
    const event = er.event
    if (!event || event.event_time_uk?.slice(0, 10) !== today) continue
    const meta = marketMetaById.get(er.market_id)
    const currencies = meta ? marketCurrencies(meta.symbol, meta.assetClass) : []
    const isRelevant = event.impact === 'HIGH' || (event.currency && currencies.includes(event.currency))
    if (!isRelevant) continue
    if (!todayEventsByMarket.has(er.market_id)) todayEventsByMarket.set(er.market_id, [])
    const existing = todayEventsByMarket.get(er.market_id)!
    if (!existing.find(e => e.eventName === event.event_name)) {
      existing.push({
        eventName: event.event_name,
        impact: event.impact,
        eventTimeUk: event.event_time_uk,
        currency: event.currency ?? null,
        riskScore: er.risk_score != null ? Number(er.risk_score) : null,
        analystWarning: er.analyst_warning ?? null,
        forecast: event.forecast ?? null,
        previous: event.previous ?? null,
        actual: event.actual ?? null,
      })
    }
  }
  for (const items of todayEventsByMarket.values()) {
    items.sort((a, b) => a.eventTimeUk.localeCompare(b.eventTimeUk))
  }

  const regimeByMarket = new Map<string, RegimeInfo>()
  {
    const seenCountByMarket = new Map<string, number>()
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
      } else if (seenCount === 1) {
        const info = regimeByMarket.get(row.market_id)
        if (info) info.priorAtrPercentile = derived.atr_percentile ?? null
      }
      seenCountByMarket.set(row.market_id, seenCount + 1)
    }
  }

  const priorDayByMarket = new Map<string, any>()
  for (const row of (priorDayRows ?? []) as any[]) {
    if (!priorDayByMarket.has(row.market_id)) priorDayByMarket.set(row.market_id, row)
  }

  const priceHistoryByMarketRaw = new Map<string, PriceBar[]>()
  for (const row of (priceHistoryRows ?? []) as any[]) {
    if (!priceHistoryByMarketRaw.has(row.market_id)) priceHistoryByMarketRaw.set(row.market_id, [])
    priceHistoryByMarketRaw.get(row.market_id)!.push({
      date: row.date,
      open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
    })
  }
  const priceHistoryByMarket = new Map<string, PriceBar[]>()
  for (const [marketId, bars] of priceHistoryByMarketRaw) {
    priceHistoryByMarket.set(marketId, bars.slice(-CHART_TRADING_DAYS))
  }

  const currentPriceByMarket = new Map<string, number>()
  const intradayByMarket = new Map<string, any>()
  for (const row of (intradayRows ?? []) as any[]) {
    if (!currentPriceByMarket.has(row.market_id)) currentPriceByMarket.set(row.market_id, Number(row.current_price))
    if (!intradayByMarket.has(row.market_id)) intradayByMarket.set(row.market_id, row)
  }

  // Engine-accurate zone boundaries (Pine-style ATR bands, matching marketStateService.ts
  // exactly) -- session_high/session_low/previous_close from the latest intraday snapshot
  // when available, falling back to the latest daily bar's own high/low/close as anchors
  // (matches the engine's own non-session fallback path).
  function resolveZoneBoundaries(marketId: string, currentPrice: number | null) {
    const priorDay = priorDayByMarket.get(marketId)
    const atr20 = priorDay?.atr20 != null ? Number(priorDay.atr20) : null
    const intraday = intradayByMarket.get(marketId)
    if (intraday?.session_high != null && intraday?.session_low != null && intraday?.previous_close != null) {
      return computeZoneBoundaries(
        atr20, Number(intraday.previous_close), Number(intraday.session_high), Number(intraday.session_low), currentPrice,
      )
    }
    if (priorDay) {
      return computeZoneBoundaries(
        atr20, Number(priorDay.close), Number(priorDay.high), Number(priorDay.low), currentPrice,
      )
    }
    return null
  }

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

  const profilesByMarketDirection = new Map<string, any[]>()
  for (const p of (profileRows ?? []) as any[]) {
    if (!p.direction || !p.profile_data) continue
    const key = `${p.market_id}::${p.direction}`
    if (!profilesByMarketDirection.has(key)) profilesByMarketDirection.set(key, [])
    profilesByMarketDirection.get(key)!.push(p.profile_data)
  }

  const allProfilesForTier: TierProfile[] = []
  for (const p of (allAnalystProfileRowsRaw ?? []) as any[]) {
    const assetClass = p.market?.asset_class
    if (!p.market_id || !p.direction || !p.profile_data || !assetClass) continue
    allProfilesForTier.push({
      market_id: p.market_id,
      direction: p.direction,
      asset_class: assetClass,
      profile_data: {
        trade_count: p.profile_data.trade_count ?? 0,
        avg_r: p.profile_data.avg_r ?? 0,
        win_rate: p.profile_data.win_rate ?? 0,
        profile_quality: p.profile_data.profile_quality ?? 'LOW',
        regime: p.profile_data.regime ?? null,
        volatility_state: p.profile_data.volatility_state ?? null,
        has_regime_data: !!p.profile_data.has_regime_data,
      },
    })
  }

  // Trade-count-weighted blend across every profile row for a market+direction,
  // regardless of regime -- "all conditions", not just whichever row happened to be
  // fetched last. Quality is taken from whichever single row has the most trades (a
  // representative pick, not a re-derived combined threshold the source data doesn't state).
  function blendProfiles(rows: any[]): { avgR: number; winRate: number | null; trades: number; quality: string | null } | null {
    const withTrades = rows.filter(r => (r.trade_count ?? 0) > 0)
    if (withTrades.length === 0) return null
    const totalTrades = withTrades.reduce((s, r) => s + r.trade_count, 0)
    const avgR = withTrades.reduce((s, r) => s + (r.avg_r ?? 0) * r.trade_count, 0) / totalTrades
    const withWinRate = withTrades.filter(r => r.win_rate != null)
    const winRate = withWinRate.length > 0
      ? withWinRate.reduce((s, r) => s + r.win_rate * r.trade_count, 0) / withWinRate.reduce((s, r) => s + r.trade_count, 0)
      : null
    const mostTrades = [...withTrades].sort((a, b) => b.trade_count - a.trade_count)[0]
    return { avgR, winRate, trades: totalTrades, quality: mostTrades?.profile_quality ?? null }
  }

  function regimeMatchedProfile(rows: any[], trendState: string | null): { avgR: number; winRate: number | null; trades: number; quality: string | null; regime: string } | null {
    if (!trendState) return null
    const match = rows.find(r => r.regime === trendState && (r.trade_count ?? 0) > 0)
    if (!match) return null
    return { avgR: match.avg_r ?? 0, winRate: match.win_rate ?? null, trades: match.trade_count, quality: match.profile_quality ?? null, regime: trendState }
  }

  function historicalEdge(marketId: string, direction: string | null, zone: string | null, trendState: string | null): HistoricalEdge {
    if (direction && zone) {
      const z = byZone.get(`${marketId}::${direction}::${zone}`)
      if (z && z.trades > 0) {
        return { tier: 'zone', avgR: z.totalR / z.trades, winRate: z.wins / z.trades, trades: z.trades, quality: null, regimeLabel: null }
      }
    }
    if (direction) {
      const rows = profilesByMarketDirection.get(`${marketId}::${direction}`) ?? []
      const regimeMatch = regimeMatchedProfile(rows, trendState)
      if (regimeMatch) {
        return { tier: 'regime_direction', avgR: regimeMatch.avgR, winRate: regimeMatch.winRate, trades: regimeMatch.trades, quality: regimeMatch.quality, regimeLabel: regimeMatch.regime }
      }
      const blended = blendProfiles(rows)
      if (blended) {
        return { tier: 'market_direction', avgR: blended.avgR, winRate: blended.winRate, trades: blended.trades, quality: blended.quality, regimeLabel: null }
      }
    }
    const m = byMarket.get(marketId)
    if (m && m.trades > 0) {
      return { tier: 'market_only', avgR: m.totalR / m.trades, winRate: m.wins / m.trades, trades: m.trades, quality: null, regimeLabel: null }
    }
    return { tier: 'none', avgR: null, winRate: null, trades: 0, quality: null, regimeLabel: null }
  }

  // Section 4 Block 4 ("Why You're Seeing This") -- personalised only when the analyst's
  // regime-matched record for this market+direction is genuinely better than their blended
  // "all conditions" record for the same market+direction. Never fabricated: both numbers
  // come from the same analyst_profiles rows historicalEdge() above already reads.
  function personalisationMessage(marketId: string, direction: string | null, trendState: string | null): string | null {
    if (!direction) return null
    const rows = profilesByMarketDirection.get(`${marketId}::${direction}`) ?? []
    const regimeMatch = regimeMatchedProfile(rows, trendState)
    const blended = blendProfiles(rows)
    if (regimeMatch && blended && regimeMatch.avgR > blended.avgR) {
      return `Your results in ${trendLabelFull(trendState).toLowerCase()} conditions have historically been above your overall average.`
    }
    return null
  }

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
    const riskMid = riskParsed ? (riskParsed[0] + riskParsed[1]) / 2 : null
    const targetMid = targetParsed ? (targetParsed[0] + targetParsed[1]) / 2 : null

    // Live intraday price is the real "current price"; yesterday's close is the fallback
    // for markets/sessions without a fresh intraday snapshot -- the zone ladder labels
    // this fallback "Last close" so it's never mistaken for a live tick.
    const liveIntradayPrice = marketId ? currentPriceByMarket.get(marketId) ?? null : null
    const dailyClosePrice = priorDay?.close != null ? Number(priorDay.close) : null
    const currentPrice = liveIntradayPrice ?? dailyClosePrice
    const currentPriceSource: 'live' | 'close' | null =
      liveIntradayPrice != null ? 'live' : dailyClosePrice != null ? 'close' : null
    const yTrade = marketId ? yesterdayTradeByMarket.get(marketId) : null

    const triggerProbability = rec.trigger_probability != null ? Number(rec.trigger_probability) : null
    const expectedR = rec.expected_r != null ? Number(rec.expected_r) : null
    const hasEventRisk = marketId ? todayEventsByMarket.has(marketId) : false
    const allEventItems = marketId ? todayEventsByMarket.get(marketId) ?? [] : []
    const zoneBoundaries = marketId ? resolveZoneBoundaries(marketId, currentPrice) : null
    const trendState = marketId ? regimeByMarket.get(marketId)?.trendState ?? null : null
    const volatilityState = marketId ? regimeByMarket.get(marketId)?.volatilityState ?? null : null

    const evidenceTier: EvidenceTier = (marketId && direction)
      ? selectEvidenceTier(
          allProfilesForTier.filter(p => p.market_id === marketId),
          allProfilesForTier,
          market?.asset_class ?? '',
          direction,
          trendState,
          volatilityState,
          market?.symbol ?? '',
        )
      : { tier: 'NONE', avgR: 0, winRate: 0, tradeCount: 0, profileQuality: 'LOW', label: '' }

    // Set by the engine's scoreAnalystForMarket() at generation time (see
    // runEngineSession.ts's recommendation_versions upsert) -- null when the
    // fallback allocation path was used, not recomputed here. Key is
    // camelCase (directionAlignment) to match runEngineSession.ts's write,
    // which was itself just changed from a mismatched direction_alignment
    // (an unrelated audit query expecting the camelCase key was reading null
    // off it -- this reader here happened to already match the old key, so
    // updating both together keeps them in sync rather than trading one
    // consumer's correctness for another's).
    const directionAlignment: WorkspaceRow['directionAlignment'] =
      (rv?.regime_tags as { directionAlignment?: string } | null)?.directionAlignment as WorkspaceRow['directionAlignment'] ?? null

    return {
      recommendationId: rec.recommendation_id,
      opportunityId: rec.opportunity_id ?? null,
      symbol: market?.symbol ?? '—',
      marketId: marketId ?? '',
      direction,
      analystAction: opp?.analyst_action ?? null,
      currentZone: opp?.current_zone ?? null,
      preferredZone: opp?.preferred_entry_zone ?? null,
      entryLow, entryHigh,
      riskRange: rec.risk_range || null,
      targetRange: rec.target_range || null,
      riskAtrDistance: atrDistanceFromEntry(entryMid, riskParsed, atr14),
      targetAtrDistance: atrDistanceFromEntry(entryMid, targetParsed, atr14),
      riskMid, targetMid,
      triggerProbability,
      expectedR,
      validityStatus: validity,
      volatilityWarning: rv?.volatility_warning || null,
      isDoNotUse, isEntryPassed, isStale,
      regime: marketId ? regimeByMarket.get(marketId) ?? null : null,
      hasHighImpactEventToday: hasEventRisk,
      eventRiskItems: allEventItems.slice(0, EVENT_CAP),
      eventRiskOverflowCount: Math.max(0, allEventItems.length - EVENT_CAP),
      currentPrice,
      currentPriceSource,
      priceHistory: marketId ? priceHistoryByMarket.get(marketId) ?? [] : [],
      zoneBoundaries,
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
      historicalEdge: marketId
        ? historicalEdge(marketId, direction, opp?.preferred_entry_zone ?? null, trendState)
        : { tier: 'none', avgR: null, winRate: null, trades: 0, quality: null, regimeLabel: null },
      evidenceTier,
      directionAlignment,
      personalisation: marketId ? personalisationMessage(marketId, direction, trendState) : null,
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

  // Note on recommendationsGeneratedToday (fetched in wave 1 above): the upstream "N markets
  // analysed" count has no DB home at all (SESSION_MARKETS is hardcoded engine config, never
  // persisted) -- deliberately not queried; the funnel UI shows that row as unavailable
  // rather than a fabricated number.

  return {
    rows,
    marketsToday: recommendations.length,
    marketsWithEventRisk,
    yesterdayR,
    closedYesterdayCount: closedYesterday.length,
    recommendationsGeneratedToday: recommendationsGeneratedToday ?? 0,
  }
}
