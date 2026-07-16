// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Engine Session Orchestrator
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { buildMarketState } from '../services/marketStateService.js'
import { assessOpportunity } from '../services/opportunityService.js'
import { buildRecommendation, type RecommendationInputTrade } from '../services/recommendationService.js'
import { buildCoachingRecommendation } from '../services/coachingService.js'
import { allocateCoverage, type OpportunityForAllocation } from '../services/allocationService.js'
import { createShadowTrade } from '../services/shadowTradeService.js'
import type { ActiveAnalyst } from '../services/analystProfileService.js'
import type { SessionType } from '../types/domain.js'

const SYSTEM_ENGINE_ID = 'ab9359b6-0e78-49fc-8a0a-1cf589552280'
const ATR_PERIOD = 20
const ZONE_COUNT = 4
const MINIMUM_RR = 2.0
const MIN_TRIGGER_SAMPLE = 20
const FALLBACK_TRIGGER_PROBABILITY = 0.5
const STALE_ATR_THRESHOLD = 0.25
const FORCE_RECALC_ATR_THRESHOLD = 0.5

const SESSION_WINDOWS: Record<string, { windowStartHour: number; windowEndHour: number }> = {
  EUROPEAN: { windowStartHour: 6,  windowEndHour: 7  },
  US:       { windowStartHour: 12, windowEndHour: 13 },
  APAC:     { windowStartHour: 15, windowEndHour: 16 },
}

function computeExpiresAt(sessionType: string, assetClass: string | null, generatedAt: Date): Date {
  const isCrypto = assetClass === 'CRYPTO'
  const isApac   = sessionType === 'APAC'
  const base     = new Date(generatedAt)
  if (isApac || isCrypto) base.setUTCDate(base.getUTCDate() + 1)
  const targetHour = isCrypto ? 12 : isApac ? 16 : 21
  const dateStr = base.toISOString().slice(0, 10)
  for (let utcH = 0; utcH < 24; utcH++) {
    const candidate = new Date(`${dateStr}T${String(utcH).padStart(2,'0')}:00:00Z`)
    const londonHour = parseInt(candidate.toLocaleString('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', hour12: false,
    }), 10)
    if (londonHour === targetHour) return candidate
  }
  const isDST = new Date(`${dateStr}T12:00:00Z`).toLocaleString('en-GB', {
    timeZone: 'Europe/London', timeZoneName: 'short',
  }).includes('BST')
  return new Date(`${dateStr}T${String(targetHour - (isDST ? 1 : 0)).padStart(2,'0')}:00:00Z`)
}
const SESSION_MARKETS: Record<string, string[]> = {
  EUROPEAN: [
    'EURNZD', 'EURGBP', 'Natural Gas', 'AUDCAD',
    'FTSE', 'GBPCHF', 'Silver', 'Brent', 'GBPUSD',
    'USDMXN', 'AUDJPY', 'USDTRY', 'USDCAD', 'EURJPY',
    'Oil', 'USDJPY', 'CAC', 'Palladium', 'Gold', 'EURSEK',
    'AUDUSD', 'GBPJPY', 'EURCHF', 'Platinum', 'Copper', 'EURUSD', 'USDCHF', 'DAX',
  ],
  US:   ['DOW', 'SP500', 'NASDAQ', 'US2000', 'Ripple', 'Solana', 'Ethereum', 'Bitcoin', 'Litecoin'],
  APAC: ['CHINA A50', 'ASX200', 'GBPAUD', 'NZDJPY', 'NZDUSD', 'NIKKEI', 'EURAUD', 'GBPNZD'],
}

async function createStep(db: SupabaseClient, engineRunId: string, stepName: string): Promise<string> {
  const { data } = await db.from('engine_run_steps').insert({
    engine_run_id: engineRunId,
    step_name: stepName,
    started_at: new Date().toISOString(),
    status: 'RUNNING',
    retry_count: 0,
  }).select('engine_run_step_id').single()
  return data?.engine_run_step_id ?? ''
}

async function completeStep(
  db: SupabaseClient, stepId: string,
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL_SUCCESS',
  outputSummary: object, errorDetail?: string
) {
  await db.from('engine_run_steps').update({
    finished_at: new Date().toISOString(),
    status, output_summary: outputSummary,
    error_detail: errorDetail ?? null,
  }).eq('engine_run_step_id', stepId)
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const isDryRun = process.argv.includes('--dry-run')
  const sessionArg = process.argv.find(a => a.startsWith('--session='))?.split('=')[1]
  const session = (sessionArg ?? 'EUROPEAN').toUpperCase() as SessionType

  if (!SESSION_WINDOWS[session as string]) {
    console.error(`Unknown session: ${session}. Use EUROPEAN, US, or APAC.`)
    process.exit(1)
  }

  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const { windowStartHour, windowEndHour } = SESSION_WINDOWS[session as string]!
  const windowStart = new Date(`${today}T${String(windowStartHour).padStart(2,'0')}:00:00Z`)
  const windowEnd   = new Date(`${today}T${String(windowEndHour).padStart(2,'0')}:00:00Z`)
  const idempotencyKey = `${session}:${today}:${windowStartHour}`
  const generatedAt = now.toISOString()

  console.log(`\n=== APIP Engine Session Runner ===`)
  console.log(`Session:  ${session}`)
  console.log(`Date:     ${today}`)
  console.log(`Window:   ${windowStart.toISOString()} → ${windowEnd.toISOString()}`)
  console.log(`Mode:     ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(`Key:      ${idempotencyKey}\n`)

  let engineRunId: string

  const { data: existingRun } = await db
    .from('engine_runs').select('engine_run_id, status')
    .eq('idempotency_key', idempotencyKey).single()

  if (existingRun) {
    if (existingRun.status === 'SUCCESS') {
      console.log(`Already succeeded for key ${idempotencyKey} -- skipping.`)
      process.exit(0)
    }
    if (existingRun.status === 'RUNNING') {
      console.log(`Already RUNNING for key ${idempotencyKey} -- aborting to prevent overlap.`)
      process.exit(1)
    }
    engineRunId = existingRun.engine_run_id
    console.log(`Resuming run ${engineRunId} (status: ${existingRun.status})`)
    if (!isDryRun) {
      await db.from('engine_runs').update({ status: 'RUNNING', started_at: generatedAt })
        .eq('engine_run_id', engineRunId)
    }
  } else {
    if (!isDryRun) {
      const { data: newRun, error } = await db.from('engine_runs').insert({
        run_type: 'SESSION', session,
        window_start: windowStart.toISOString(), window_end: windowEnd.toISOString(),
        idempotency_key: idempotencyKey, started_at: generatedAt,
        status: 'RUNNING', triggered_by_type: 'SYSTEM', triggered_by_id: SYSTEM_ENGINE_ID,
      }).select('engine_run_id').single()
      if (error || !newRun) { console.error('Failed to create engine_run:', error?.message); process.exit(1) }
      engineRunId = newRun.engine_run_id
      console.log(`Created engine_run: ${engineRunId}`)
    } else {
      engineRunId = 'dry-run-' + Date.now()
      console.log(`[DRY RUN] Would create engine_run: ${idempotencyKey}`)
    }
  }

  const sessionMarkets = SESSION_MARKETS[session as string] ?? []
  let opportunitiesCreated = 0, recommendationsCreated = 0
  let coachingCreated = 0, shadowTradesCreated = 0

  try {
    // ── Step 1: Load market state ────────────────────────────────────────────
    console.log('\nStep 1: Loading market state...')
    const stepId1 = isDryRun ? '' : await createStep(db, engineRunId, 'LOAD_MARKET_STATE')

    const { data: marketRows } = await db.from('markets')
      .select('market_id, symbol, asset_class, display_precision').in('symbol', sessionMarkets)
    const marketBySymbol = new Map((marketRows ?? []).map(m => [m.symbol, m]))

    const barWindowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const allBars: any[] = []
    let barPage = 0, barHasMore = true
    while (barHasMore) {
      const { data: barBatch } = await db.from('market_state_daily')
        .select('market_id, date, open, high, low, close, atr20, atr14')
        .gte('date', barWindowStart)
        .order('date', { ascending: true })
        .range(barPage * 1000, barPage * 1000 + 999)
      if (!barBatch?.length) { barHasMore = false } else {
        allBars.push(...barBatch)
        barHasMore = barBatch.length === 1000
        barPage++
      }
    }

    const barsByMarketId = new Map<string, any[]>()
    for (const bar of allBars) {
      if (!barsByMarketId.has(bar.market_id)) barsByMarketId.set(bar.market_id, [])
      barsByMarketId.get(bar.market_id)!.push({
        date: bar.date, open: Number(bar.open), high: Number(bar.high),
        low: Number(bar.low), close: Number(bar.close),
        atr20: bar.atr20 != null ? Number(bar.atr20) : undefined,
        atr14: bar.atr14 != null ? Number(bar.atr14) : undefined,
      })
    }
    console.log(`  Daily bars loaded: ${allBars.length} rows across ${barsByMarketId.size} markets (${barPage} pages)`)

    const { data: intradayRows } = await db.from('market_state_intraday')
      .select('market_id, current_price, current_zone, captured_at, session_high, session_low, previous_close')
      .eq('session', session).gte('captured_at', `${today}T00:00:00Z`)
      .order('captured_at', { ascending: false })

    const intradayByMarket = new Map<string, any>()
    for (const s of (intradayRows ?? [])) {
      if (!intradayByMarket.has(s.market_id)) intradayByMarket.set(s.market_id, s)
    }

    console.log(`  Markets: ${marketRows?.length ?? 0}, Intraday snapshots: ${intradayByMarket.size}`)
    if (!isDryRun && stepId1) await completeStep(db, stepId1, 'SUCCESS', { markets: marketRows?.length ?? 0 })

    // ── Step 2: Load analysts and trades ────────────────────────────────────
    console.log('\nStep 2: Loading analysts and historical trades...')
    const stepId2 = isDryRun ? '' : await createStep(db, engineRunId, 'LOAD_ANALYSTS_TRADES')

    const { data: analystRows } = await db.from('analysts')
      .select('analyst_id, display_name, active, sessions').eq('active', true)

    const sessionEligibleAnalysts = (analystRows ?? []).filter(a => {
      const sessions: string[] = a.sessions ?? []
      return sessions.includes(session as string)
    })

    const activeAnalysts: ActiveAnalyst[] = sessionEligibleAnalysts.map(a => ({
      analyst: a.analyst_id,
      active: true,
      sessionEligibility: {
        EUROPEAN: (a.sessions ?? []).includes('EUROPEAN'),
        US: (a.sessions ?? []).includes('US'),
        APAC: (a.sessions ?? []).includes('APAC'),
      },
    }))

    const { data: availabilityRows } = await db.from('analyst_availability')
      .select('analyst_id, available, workload_cap')
      .eq('date', today)
      .eq('session', session)

    const unavailableIds = new Set(
      (availabilityRows ?? []).filter(a => !a.available).map(a => a.analyst_id)
    )

    const eligibleAnalysts = activeAnalysts.filter(a => !unavailableIds.has(a.analyst))

    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString()
    const PAGE_SIZE = 1000
    const allTradeRows: any[] = []
    let page = 0
    let hasMore = true

    while (hasMore) {
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1
      const { data, error } = await db.from('actual_trades')
        .select('analyst_id, market_id, direction, entry_zone, result_r, triggered')
        .gte('published_at', twoYearsAgo)
        .not('result_r', 'is', null)
        .range(from, to)

      if (error) {
        console.error(`  Trade pagination error on page ${page}: ${error.message}`)
        break
      }
      if (!data || data.length === 0) {
        hasMore = false
      } else {
        allTradeRows.push(...data)
        hasMore = data.length === PAGE_SIZE
        page++
      }
    }

    const { data: allMarketRows } = await db.from('markets').select('market_id, symbol')
    const symbolByMarketId = new Map((allMarketRows ?? []).map(m => [m.market_id, m.symbol]))

    const tradesBySymbol = new Map<string, RecommendationInputTrade[]>()
    for (const t of allTradeRows) {
      const symbol = symbolByMarketId.get(t.market_id)
      if (!symbol) continue
      if (!tradesBySymbol.has(symbol)) tradesBySymbol.set(symbol, [])
      tradesBySymbol.get(symbol)!.push({
        market: symbol,
        direction: t.direction,
        entryZone: t.entry_zone ?? null,
        resultR: t.result_r !== null ? Number(t.result_r) : null,
        triggered: t.triggered ?? false,
        analyst: t.analyst_id,
      } as RecommendationInputTrade)
    }

    const { data: profileRows } = await db
      .from('analyst_profiles')
      .select('analyst_id, market_id, direction, zone, profile_data')
      .in('analyst_id', eligibleAnalysts.map(a => a.analyst))

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data: regimeRows } = await db
      .from('market_regime_state')
      .select('market_id, trend_state, volatility_state, regime_confidence, captured_at')
      .gte('captured_at', twoDaysAgo + 'T00:00:00Z')
      .is('session', null)
      .order('captured_at', { ascending: false })

    const regimeByMarketId = new Map<string, any>()
    for (const r of (regimeRows ?? [])) {
      if (!regimeByMarketId.has(r.market_id)) {
        regimeByMarketId.set(r.market_id, r)
      }
    }
    console.log(`  Market regimes loaded: ${regimeByMarketId.size}`)

    const profileScores = new Map<string, number>()
    for (const p of (profileRows ?? [])) {
      const regime = regimeByMarketId.get(p.market_id)
      const profileRegime = p.profile_data?.regime
      const isRegimeMatch = regime && profileRegime && profileRegime === regime.trend_state
      const avgR = (p.profile_data?.avg_r ?? 0) + (isRegimeMatch ? 0.1 : 0)
      const key = `${p.analyst_id}::${p.market_id}::${p.direction}`
      const existing = profileScores.get(key) ?? -Infinity
      if (avgR > existing) profileScores.set(key, avgR)
    }

    const preferredDirectionByMarketId = new Map<string, 'BUY' | 'SELL'>()
    for (const market of (marketRows ?? [])) {
      const regime = regimeByMarketId.get(market.market_id)
      if (!regime) continue
      let bestBuyR = -Infinity, bestSellR = -Infinity
      for (const p of (profileRows ?? [])) {
        if (p.market_id !== market.market_id) continue
        const profileRegime = p.profile_data?.regime
        if (profileRegime !== regime.trend_state) continue
        const avgR = p.profile_data?.avg_r ?? 0
        if (p.direction === 'BUY' && avgR > bestBuyR) bestBuyR = avgR
        if (p.direction === 'SELL' && avgR > bestSellR) bestSellR = avgR
      }
      if (bestBuyR > -Infinity || bestSellR > -Infinity) {
        preferredDirectionByMarketId.set(market.market_id, bestBuyR >= bestSellR ? 'BUY' : 'SELL')
      }
    }
    console.log(`  Regime-preferred directions set: ${preferredDirectionByMarketId.size} markets`)

    // Build market-level trigger rate lookup from analyst_profiles
    const marketTriggerRateByMarketId = new Map<string, number>()
    for (const p of (profileRows ?? [])) {
      if (!p.profile_data?.trigger_rate) continue
      const existing = marketTriggerRateByMarketId.get(p.market_id)
      if (existing === undefined) {
        marketTriggerRateByMarketId.set(p.market_id, p.profile_data.trigger_rate)
      } else {
        marketTriggerRateByMarketId.set(p.market_id, (existing + p.profile_data.trigger_rate) / 2)
      }
    }

    if (unavailableIds.size > 0) console.log(`  Absent today: ${unavailableIds.size} analyst(s)`)
    console.log(`  Historical trades loaded: ${allTradeRows.length} (${page} pages)`)
    console.log(`  Analyst profiles loaded: ${profileRows?.length ?? 0}`)
    if (!isDryRun && stepId2) await completeStep(db, stepId2, 'SUCCESS', {
      analysts: activeAnalysts.length, trades: allTradeRows.length,
      profiles: profileRows?.length ?? 0,
    })

    // ── Step 3: Generate recommendations ────────────────────────────────────
    console.log('\nStep 3: Generating recommendations...')
    const stepId3 = isDryRun ? '' : await createStep(db, engineRunId, 'GENERATE_RECOMMENDATIONS')

    const parameterSnapshot = {
      atrPeriod: ATR_PERIOD, zoneCount: ZONE_COUNT, minimumRr: MINIMUM_RR,
      minTriggerSample: MIN_TRIGGER_SAMPLE, staleAtrThreshold: STALE_ATR_THRESHOLD,
      fallbackTriggerProbability: FALLBACK_TRIGGER_PROBABILITY,
    }
    const parameterSnapshotHash = `${ATR_PERIOD}:${ZONE_COUNT}:${MINIMUM_RR}:${STALE_ATR_THRESHOLD}`

    const generatedItems: any[] = []

    for (const symbol of sessionMarkets) {
      const market = marketBySymbol.get(symbol)
      if (!market) { console.log(`  ${symbol}: not in markets table`); continue }

      const intraday = intradayByMarket.get(market.market_id)
      if (!intraday) { console.log(`  ${symbol}: no intraday snapshot`); continue }

      const bars = barsByMarketId.get(market.market_id) ?? []
      if (bars.length < ATR_PERIOD) { console.log(`  ${symbol}: insufficient bars`); continue }

      // Pine-style band construction using session anchors from intraday snapshot.
      // previous_close: final 5-min OANDA bar before APIP session open (22:00 UTC)
      // session_high/low: max/min of 5-min bar highs/lows since session open
      // atr20: from market_state_daily Wilder RMA period 20
      const prevClose = intraday.previous_close != null ? Number(intraday.previous_close) : null
      const lastBar = bars.length > 0 ? bars[bars.length - 1] : null
      const atr20FromDaily = lastBar?.atr20 != null ? Number(lastBar.atr20) : lastBar?.atr14 != null ? Number(lastBar.atr14) : null
      const marketState = buildMarketState({
        marketId: market.market_id,
        ohlcSeries: bars,
        currentPrice: { price: Number(intraday.current_price), capturedAt: intraday.captured_at },
        parameters: { atrPeriod: ATR_PERIOD, zoneCount: ZONE_COUNT },
        sessionAnchors: prevClose != null && intraday.session_high != null && intraday.session_low != null && atr20FromDaily != null ? {
          previousClose:    prevClose,
          todayHighSoFar:   Number(intraday.session_high),
          todayLowSoFar:    Number(intraday.session_low),
          precomputedAtr20: atr20FromDaily,
        } : undefined,
      })
      const currentZone = intraday.current_zone ?? marketState.currentZone
      const marketStateWithZone = { ...marketState, currentZone }
      if (!currentZone) { console.log(`  : no zone, anchors=`); continue }
      if (!currentZone) { console.log(`  ${symbol}: no zone`); continue }

            const opportunityAssessment = assessOpportunity({ marketState: marketStateWithZone })
      if (!opportunityAssessment.hasOpportunity) {
        console.log(`  ${symbol}: no opportunity (${opportunityAssessment.noRecommendationReason})`)
        continue
      }

      const allTrades = tradesBySymbol.get(symbol) ?? []
      const rvId = randomUUID()
      const regime = regimeByMarketId.get(market.market_id)
      const marketCurrentZone = marketStateWithZone.currentZone
      // Direction: regime first, then current zone for MIXED/absent
      let preferredDirection: 'BUY' | 'SELL' | null = null
      const trendState = regime?.trend_state
      if (trendState === 'TRENDING_UP') {
        preferredDirection = 'BUY'
        console.log(`    Regime(TRENDING_UP) → direction: BUY`)
      } else if (trendState === 'TRENDING_DOWN') {
        preferredDirection = 'SELL'
        console.log(`    Regime(TRENDING_DOWN) → direction: SELL`)
      } else if (marketCurrentZone && ['ZONE_1', 'ZONE_2', 'TOO_DEEP'].includes(marketCurrentZone)) {
        preferredDirection = 'BUY'
        console.log(`    Zone(${marketCurrentZone}) → direction: BUY`)
      } else if (marketCurrentZone && ['ZONE_3', 'ZONE_4', 'TOO_HIGH'].includes(marketCurrentZone)) {
        preferredDirection = 'SELL'
        console.log(`    Zone(${marketCurrentZone}) → direction: SELL`)
      }

      const trades = allTrades

      // Profile-based trigger rate -- used as both fallback and cap
      // Backfill has triggered=true for all trades → 100% without cap
      const profileTriggerRate = marketTriggerRateByMarketId.get(market.market_id) ?? FALLBACK_TRIGGER_PROBABILITY

      try {
        const result = buildRecommendation({
          recommendationVersionId: rvId,
          generatedAt,
          market: symbol,
          session,
          marketState: marketStateWithZone,
          marketRegime: null,
          eventRisks: [],
          trades,
          activeAnalysts: eligibleAnalysts,
          minimumRr: MINIMUM_RR,
          minTriggerSample: MIN_TRIGGER_SAMPLE,
          fallbackTriggerProbability: profileTriggerRate,
          staleAtrThreshold: STALE_ATR_THRESHOLD,
          forceRecalcAtrThreshold: FORCE_RECALC_ATR_THRESHOLD,
          parameterSnapshot,
          parameterSnapshotHash,
          marketDisplayPrecision: market.display_precision ?? null,
          preferredDirection,
        })

        const { opportunity: opp, recommendationVersion: rv, hiddenExecutionLevels: hidden, diagnostics } = result

        if (!rv || rv.entryRangeLow === undefined) {
          console.log(`  ${symbol}: rv issue — entryRangeLow=${rv?.entryRangeLow}`)
          continue
        }

        // Cap trigger probability at profile rate
        // Backfill data has triggered=true for all trades → service returns 100%
        // Profile rate (20-40%) is a more accurate approximation until shadow
        // outcomes accumulate enough data for a real probability
        const cappedTriggerProbability = Math.min(opp.triggerProbability, profileTriggerRate)

        console.log(`  ${symbol}: zone=${marketStateWithZone.currentZone}, dir=${opp.direction}, action=${opp.analystAction}, entry=${rv.entryRangeLow?.toFixed(4)}-${rv.entryRangeHigh?.toFixed(4)}, R=${opp.expectedR?.toFixed(2)}, trigger=${Math.round(cappedTriggerProbability * 100)}%, template=${diagnostics.templateSource}(${diagnostics.templateTrades} trades)`)

        const ENTRY_DISTANCE_THRESHOLD_ATR = 1.5
        let validityOverride: string | null = null
        if (rv.entryRangeLow !== undefined && rv.entryRangeHigh !== undefined && marketStateWithZone.atr20) {
          const entryMid = (rv.entryRangeLow + rv.entryRangeHigh) / 2
          const currentPrice = Number(intraday.current_price)
          const distanceInAtrs = Math.abs(entryMid - currentPrice) / marketStateWithZone.atr20
          if (distanceInAtrs > ENTRY_DISTANCE_THRESHOLD_ATR) {
            validityOverride = 'ENTRY_ALREADY_PASSED'
            console.log(`    ⚠ Entry range ${distanceInAtrs.toFixed(2)} ATRs from current price -- flagging ENTRY_ALREADY_PASSED`)
          }
        }

        generatedItems.push({
          market, marketState: marketStateWithZone, opp, rv, hidden, diagnostics,
          rvId, validityOverride, cappedTriggerProbability,
        })
        recommendationsCreated++
      } catch (err) {
        console.log(`  ${symbol}: ${(err as Error).message}`)
        console.log(`  Stack: ${(err as Error).stack?.split('\n')[1]}`)
      }
    }

    console.log(`  Recommendations generated: ${recommendationsCreated}`)
    if (!isDryRun && stepId3) await completeStep(db, stepId3, 'SUCCESS', { recommendations: recommendationsCreated })

    // ── Step 4: Allocate + write to DB ──────────────────────────────────────
    if (!isDryRun) {
      console.log('\nStep 4: Allocating and writing to database...')
      const stepId4 = await createStep(db, engineRunId, 'ALLOCATE_AND_WRITE')

      const allocationInput: OpportunityForAllocation[] = generatedItems.map(item => {
        let bestAnalystId: string | null = null
        let bestScore = -Infinity
        for (const a of eligibleAnalysts) {
          const key = `${a.analyst}::${item.market.market_id}::${item.opp.direction}`
          const score = profileScores.get(key) ?? -Infinity
          if (score > bestScore) { bestScore = score; bestAnalystId = a.analyst }
        }
        return {
          opportunityId: randomUUID(),
          recommendationVersionId: item.rvId,
          expectedR: item.opp.expectedR,
          assignedAnalystId: bestAnalystId,
          eligibleAnalysts: eligibleAnalysts.map(a => a.analyst),
        }
      })

      const allocations = allocateCoverage({
        opportunities: allocationInput,
        activeAnalysts: eligibleAnalysts.map(a => a.analyst),
        generateId: randomUUID,
      })

      const allocationByRvId = new Map(allocations.map(a => [a.recommendationVersionId, a]))

      for (const item of generatedItems) {
        const { market, marketState, opp, rv, hidden, diagnostics, validityOverride, cappedTriggerProbability } = item
        const allocation = allocationByRvId.get(item.rvId)
        if (!allocation) continue

        const intraday = intradayByMarket.get(market.market_id)

        const { data: oppRow, error: oppErr } = await db.from('opportunities').upsert({
          date: today, market_id: market.market_id, session,
          publication_window_start_uk: `${String(windowStartHour).padStart(2,'0')}:00`,
          publication_window_end_uk: `${String(windowEndHour).padStart(2,'0')}:00`,
          current_zone: marketState.currentZone ?? intraday?.current_zone,
          preferred_entry_zone: opp.preferredEntryZone,
          direction: item.opp.direction,
          expected_r: opp.expectedR,
          trigger_probability: cappedTriggerProbability,
          opportunity_lifecycle_status: 'ASSIGNED',
          analyst_action: opp.analystAction,
          assigned_analyst_id: allocation.assignedAnalystId,
        }, { onConflict: 'date,market_id,session,version' }).select('opportunity_id').single()

        if (oppErr || !oppRow) { console.error(`  ${market.symbol} opp error: ${oppErr?.message}`); continue }
        opportunitiesCreated++

        const { data: rvRow, error: rvErr } = await db.from('recommendation_versions').upsert({
          recommendation_version_id: item.rvId,
          opportunity_id: oppRow.opportunity_id,
          version_number: 1, generated_at: generatedAt, shown_at: generatedAt,
          price_at_generation: marketState.currentPrice,
          zone_at_generation: rv.zoneAtGeneration,
          recommendation_validity_status: validityOverride ?? rv.recommendationValidityStatus,
          parameter_snapshot: parameterSnapshot,
          parameter_snapshot_hash: parameterSnapshotHash,
          requires_refresh: rv.requiresRefresh, is_active: true,
          entry_range_low: rv.entryRangeLow, entry_range_high: rv.entryRangeHigh,
          risk_range: rv.riskRange, target_range: rv.targetRange,
          volatility_warning: rv.volatilityWarning ?? '',
          atr_move_since_generation: rv.atrMoveSinceGeneration,
        }, { onConflict: 'recommendation_version_id' }).select('recommendation_version_id').single()

        if (rvErr || !rvRow) { console.error(`  ${market.symbol} rv error: ${rvErr?.message}`); continue }

        await db.from('opportunities')
          .update({ active_recommendation_version_id: rvRow.recommendation_version_id })
          .eq('opportunity_id', oppRow.opportunity_id)

        const { data: teamRow } = await db.from('teams').select('team_id').eq('active', true).single()
        if (teamRow) {
          await db.from('coverage_allocation').insert({
            allocation_id: allocation.allocationId,
            opportunity_id: oppRow.opportunity_id,
            assigned_analyst_id: allocation.assignedAnalystId,
            team_id: teamRow.team_id,
            allocation_status: 'ASSIGNED',
            allocation_score: allocation.allocationScore,
            eligible_analysts: allocation.eligibleAnalysts,
            assigned_by_type: 'SYSTEM',
            assigned_by_id: SYSTEM_ENGINE_ID,
            reason_summary: allocation.reasonSummary,
          })
        }

        try {
          const coachingId = randomUUID()
          const coaching = buildCoachingRecommendation({
            recommendationId: coachingId,
            activeRecommendationVersionId: rvRow.recommendation_version_id,
            opportunityId: oppRow.opportunity_id,
            analystId: allocation.assignedAnalystId,
            market: market.symbol,
            direction: item.opp.direction,
            currentZone: marketState.currentZone ?? item.marketState.currentZone,
            preferredEntryZone: rv.zoneAtGeneration!,
            analystAction: opp.analystAction,
            entryRangeLow: rv.entryRangeLow ?? 0,
            entryRangeHigh: rv.entryRangeHigh ?? 0,
            riskRange: rv.riskRange,
            targetRange: rv.targetRange,
            triggerProbability: cappedTriggerProbability,
            expectedR: opp.expectedR,
            eventWarning: '',
            recommendationValidityStatus: validityOverride ?? rv.recommendationValidityStatus,
            volatilityWarning: rv.volatilityWarning ?? '',
            shownAt: generatedAt,
          })

          await db.from('coaching_recommendations').upsert({
            recommendation_id: coaching.recommendationId,
            opportunity_id: coaching.opportunityId,
            analyst_id: coaching.analystId,
            active_recommendation_version_id: coaching.activeRecommendationVersionId,
            entry_range_low: coaching.entryRangeLow,
            entry_range_high: coaching.entryRangeHigh,
            risk_range: coaching.riskRange,
            target_range: coaching.targetRange,
            trigger_probability: coaching.triggerProbability,
            expected_r: coaching.expectedR,
            coaching_note: coaching.coachingNote,
            shown_at: generatedAt,
          }, { onConflict: 'opportunity_id,analyst_id' })
          coachingCreated++
        } catch (err) {
          console.log(`  ${market.symbol} coaching: ${(err as Error).message}`)
        }

        try {
          const shadowId = randomUUID()
          const shadowOutcomeId = randomUUID()
          const { shadowTrade, shadowTradeOutcome } = createShadowTrade({
            shadowTradeId: shadowId,
            shadowOutcomeId,
            createdAt: generatedAt,
            recommendationVersionId: rvRow.recommendation_version_id,
            opportunityId: oppRow.opportunity_id,
            entry: hidden.entryMid,
            stop: hidden.stop,
            target: hidden.target,
            rr: hidden.rr,
            templateSource: diagnostics.templateSource,
            direction: item.opp.direction,
            session,
          })

          const { data: shadowRow, error: shadowError } = await db.from('shadow_trades').insert({
            shadow_trade_id: shadowTrade.shadowTradeId,
            opportunity_id: shadowTrade.opportunityId,
            recommendation_version_id: shadowTrade.recommendationVersionId,
            entry: shadowTrade.entry,
            stop: shadowTrade.stop,
            target: shadowTrade.target,
            rr: shadowTrade.rr,
            template_source: shadowTrade.templateSource,
            confidence_label: shadowTrade.confidenceLabel,
            direction: shadowTrade.direction,
            session: shadowTrade.session,
            generated_at: generatedAt,
            entry_mode: item.opp.analystAction === 'ENTER_NOW' ? 'ENTER_NOW' : 'WAIT_FOR_PREFERRED_ZONE',
            generated_price: Number(intraday.current_price),
            expires_at: computeExpiresAt(session, market.asset_class ?? null, new Date(generatedAt)).toISOString(),
            price_provider: 'FINNHUB_OANDA',
            price_resolution: '5MIN',
          }).select('shadow_trade_id').single()

          if (!shadowError && shadowRow) {
            await db.from('shadow_trade_outcomes').insert({
              shadow_outcome_id: shadowTradeOutcome.shadowOutcomeId,
              shadow_trade_id: shadowRow.shadow_trade_id,
              trade_outcome_status: item.opp.analystAction === 'ENTER_NOW' ? 'TRIGGERED' : 'NOT_TRIGGERED',
              triggered_at:    item.opp.analystAction === 'ENTER_NOW' ? generatedAt : null,
              triggered_price: item.opp.analystAction === 'ENTER_NOW' ? Number(intraday.current_price) : null,
              trigger_source:  item.opp.analystAction === 'ENTER_NOW' ? 'ENTER_NOW_AT_GENERATION' : null,
            })
            shadowTradesCreated++
          } else if (shadowError) {
            console.log(`  ${market.symbol} shadow: ${shadowError.message}`)
          }
        } catch (err) {
          console.log(`  ${market.symbol} shadow: ${(err as Error).message}`)
        }
      }

      await completeStep(db, stepId4, 'SUCCESS', {
        opportunities: opportunitiesCreated, recommendations: recommendationsCreated,
        coaching: coachingCreated, shadow_trades: shadowTradesCreated,
      })

      await db.from('engine_runs').update({
        status: 'SUCCESS', finished_at: new Date().toISOString(),
      }).eq('engine_run_id', engineRunId)
    }

    console.log('\n=== SUMMARY ===')
    if (isDryRun) {
      console.log(`Would generate: ${generatedItems.length} recommendations`)
      console.log('DRY RUN -- nothing written.')
    } else {
      console.log(`Opportunities:   ${opportunitiesCreated}`)
      console.log(`Recommendations: ${recommendationsCreated}`)
      console.log(`Coaching recs:   ${coachingCreated}`)
      console.log(`Shadow trades:   ${shadowTradesCreated}`)
    }

  } catch (err) {
    console.error('\nFatal error:', (err as Error).message)
    console.error((err as Error).stack)
    if (!isDryRun) {
      await db.from('engine_runs').update({
        status: 'FAILED', finished_at: new Date().toISOString(),
        error_summary: (err as Error).message,
      }).eq('engine_run_id', engineRunId)
    }
    process.exit(1)
  }
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}









