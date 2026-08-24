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
import { buildRecommendation, type RecommendationInputTrade, type RegimeSnapshot } from '../services/recommendationService.js'
import { buildCoachingRecommendation } from '../services/coachingService.js'
import { allocateCoverage, type OpportunityForAllocation } from '../services/allocationService.js'
import { createShadowTrade } from '../services/shadowTradeService.js'
import type { ActiveAnalyst } from '../services/analystProfileService.js'
import { scoreAnalystForMarket, type AnalystScore, type AnalystProfileRow, type DirectionAlignment } from '../services/analystScoringService.js'
import { selectEntryZone, zoneBounds, type AtrProfile } from '../services/entryOptimizerService.js'
import { atrProfileMapKey } from '../services/analystAtrProfileService.js'
import type { SessionType } from '../types/domain.js'

const SYSTEM_ENGINE_ID = 'ab9359b6-0e78-49fc-8a0a-1cf589552280'
// Governs marketState.atr14 (entryOptimizerService.ts's stop/target distance
// input) and the minimum-bars floor below -- NOT the zone bands, which are
// always sourced from atr20FromDaily/precomputedAtr20 independently of this
// constant (see the buildMarketState() call below). Was previously 20, which
// silently made "atr14" a 20-period ATR -- entryOptimizerService.ts's
// DEFAULT_PROFILES stop/target multipliers were calibrated against genuine
// ATR14, so every live stop/target was systematically too wide.
const ATR_PERIOD = 14
const ZONE_COUNT = 4
const MINIMUM_RR = 2.0
const MIN_TRIGGER_SAMPLE = 20
// Used when an analyst has no executive_kpis triggered_rate row at all (new analyst,
// KPI batch hasn't run yet) -- not the old market-level actual_trades-derived figure.
const FALLBACK_TRIGGER_PROBABILITY = 0.35
const STALE_ATR_THRESHOLD = 0.25
// Analyst-first (Step 5) had no workload limit at all: the highest-scoring analyst per
// market wins, market by market, so a strong all-round profile (Ian, Mona) could sweep
// every market in a session while others got zero -- confirmed live, all 28 EUROPEAN
// markets going to just two analysts. MIN is a soft target the progressive penalty below
// works toward, not enforced directly; MAX is the hard stop.
const MAX_MARKETS_PER_ANALYST = 11
const MIN_MARKETS_PER_ANALYST = 8
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

// ── Shadow trade entry variants ─────────────────────────────────────────────
// Three shadow trades per recommendation, one per entry point within the same
// zone the (single, unchanged) analyst-facing recommendation already uses --
// ZONE_MID is that same entry (entryStopTarget.entryPrice in
// entryOptimizerService.ts), ZONE_BOTTOM/ZONE_TOP are the zone's own low/high
// edge. This only decides where in the zone a shadow trade enters; it does not
// touch zone SELECTION (still entryOptimizerService.ts's selectEntryZone(),
// unchanged) or the analyst-facing recommendation itself.

type EntryVariant = 'ZONE_BOTTOM' | 'ZONE_MID' | 'ZONE_TOP'
const ENTRY_VARIANTS: EntryVariant[] = ['ZONE_BOTTOM', 'ZONE_MID', 'ZONE_TOP']

function variantEntry(
  direction: 'BUY' | 'SELL',
  variant: EntryVariant,
  zoneLow: number,
  zoneHigh: number,
): number {
  const mid = (zoneLow + zoneHigh) / 2
  if (variant === 'ZONE_MID') return mid  // current behaviour
  if (direction === 'BUY') {
    // BUY: BOTTOM = zone low (cheapest), TOP = zone high (nearest current price)
    return variant === 'ZONE_BOTTOM' ? zoneLow : zoneHigh
  } else {
    // SELL: BOTTOM = zone low (nearest current price), TOP = zone high (most expensive)
    return variant === 'ZONE_BOTTOM' ? zoneHigh : zoneLow
  }
}

// Mirrors entryOptimizerService.ts's buildEntryOptimizer() stop/target/rr
// geometry exactly (rawTarget/step/stop are entry-independent -- band-boundary
// anchored, identical across all three variants; only the RR-floor check and,
// when it kicks in, the floored target depend on entryPrice) -- evaluated per
// variant entry point rather than only at the zone midpoint. Not exported from
// entryOptimizerService.ts and not refactored to share this exact block with
// it, since that service's contract is one entry (the analyst-facing
// recommendation) and changing that wasn't asked for; duplicated here instead.
function variantStopTargetRr(
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  lowerBand: number,
  upperBand: number,
  minimumRr: number,
): { stop: number; target: number; rr: number } {
  const rawTarget = direction === 'BUY' ? upperBand : lowerBand
  const step = (upperBand - lowerBand) / 4
  const stop = direction === 'BUY' ? lowerBand - step : upperBand + step

  const stopDistance = Math.abs(entryPrice - stop)
  const naturalTargetDistance = Math.abs(rawTarget - entryPrice)
  const target = naturalTargetDistance >= minimumRr * stopDistance
    ? rawTarget
    : direction === 'BUY'
      ? entryPrice + minimumRr * stopDistance
      : entryPrice - minimumRr * stopDistance

  const finalTargetDistance = Math.abs(target - entryPrice)
  const rr = stopDistance > 0 ? finalTargetDistance / stopDistance : NaN

  return { stop, target, rr }
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

// Workload-aware ranking for the analyst-first scoring loop (Step 3/5) -- targetPerAnalyst
// is an even split of this session's markets across its analysts, floored at
// MIN_MARKETS_PER_ANALYST so a session with many analysts relative to its market count
// doesn't start penalising someone before they've even reached the soft target (e.g. 28
// EUROPEAN markets / 5 analysts is an even split of 6, below the 8 floor -- without the
// floor, penalties would kick in two markets earlier than intended).
//
// hardCap is a tighter fair-share ceiling (even split + 1 buffer, capped at
// MAX_MARKETS_PER_ANALYST), not target+2 -- confirmed live: without this, a
// high-scoring analyst-first pick (e.g. Ian, Mona) could sweep most of a session's
// REGIME-tier markets before workload pressure meant anything, starving other
// analysts (Maged/Khaled/Tibor) of markets they'd otherwise qualify for. With 28
// markets / 5 analysts: ceil(28/5)=6, +1 buffer = 7 -- each analyst caps out at 7 in
// this pass, regardless of score. This is now sometimes BELOW targetPerAnalyst's
// 8-floor (as in this exact example), which makes the 15%-over-target soft-penalty
// band below unreachable for that session shape -- hardCap excludes at 7 before
// workload could ever reach the 8-floor target. That's an accepted consequence of
// deliberately prioritising the tighter fair-share ceiling over the soft-penalty
// mechanism for analyst-first allocation specifically; MAX_MARKETS_PER_ANALYST
// itself (the cross-session daily cap) is unaffected and still enforced via
// initialWorkload seeding into allocateCoverage() for the separate fallback pass.
function workloadAdjustedScore(
  baseScore: number,
  currentWorkload: number,
  totalMarkets: number,
  totalAnalysts: number
): number {
  const targetPerAnalyst = Math.max(MIN_MARKETS_PER_ANALYST, Math.ceil(totalMarkets / totalAnalysts))
  const analystFirstCap = Math.ceil(totalMarkets / totalAnalysts) + 1
  const hardCap = Math.min(MAX_MARKETS_PER_ANALYST, analystFirstCap)

  if (currentWorkload >= hardCap) return -1

  if (currentWorkload >= targetPerAnalyst) {
    const overTarget = currentWorkload - targetPerAnalyst
    const penalty = 0.15 * overTarget
    return baseScore * (1 - penalty)
  }

  return baseScore
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
  let coachingCreated = 0, shadowTradesCreated = 0, shadowTradesSkippedUnreliableBand = 0
  let optimalShadowTradesCreated = 0, optimalSkippedNoSignal = 0, optimalSkippedUnreliableBand = 0

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

    const analystNameById = new Map((analystRows ?? []).map(a => [a.analyst_id, a.display_name]))

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

    // Each analyst's 12-month rolling triggered/total_setups aggregate (executive_kpis),
    // used as the trigger probability model's baseline (see triggerProbabilityService.ts).
    // Was previously just the single most recent monthly row -- volatile and misleading
    // early in a new month, since a partial month's setups haven't had time to trigger yet
    // (confirmed live: Ian's August row was 13/53 = 24.5% ten days into the month, vs a
    // stable 42.5% July and ~38% 12-month aggregate). Summing triggered/total_setups across
    // months (not averaging each month's rate) weights every setup equally regardless of
    // which month it fell in, rather than letting a slow 30-setup month count as much as a
    // busy 200-setup one. actual_trades.triggered itself is unusable for this:
    // MANUAL_BACKFILL only ever contains trades that DID trigger, so a historical
    // triggered/total calculation off that data is always ~100%, not a real rate.
    const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data: triggerKpis } = await db
      .from('executive_kpis')
      .select('analyst_id, kpi_value, period_start')
      .eq('kpi_name', 'triggered_rate')
      .gte('period_start', twelveMonthsAgo)
      .order('period_start', { ascending: false })

    const triggerAggregates = new Map<string, { triggered: number; total: number }>()
    for (const row of (triggerKpis ?? [])) {
      if (!row.analyst_id) continue
      const val = row.kpi_value as any
      const triggered = val?.triggered ?? 0
      const total = val?.total_setups ?? 0
      if (total === 0) continue
      const existing = triggerAggregates.get(row.analyst_id) ?? { triggered: 0, total: 0 }
      triggerAggregates.set(row.analyst_id, { triggered: existing.triggered + triggered, total: existing.total + total })
    }

    const analystTriggerRates = new Map<string, number>()
    for (const [analystId, agg] of triggerAggregates) {
      analystTriggerRates.set(analystId, agg.total > 0 ? agg.triggered / agg.total : FALLBACK_TRIGGER_PROBABILITY)
    }
    console.log(`  Analyst trigger-rate KPIs loaded: ${analystTriggerRates.size} (12-month rolling aggregate)`)

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

    const { data: allMarketRows } = await db.from('markets').select('market_id, symbol, asset_class')
    const symbolByMarketId = new Map((allMarketRows ?? []).map(m => [m.market_id, m.symbol]))
    const assetClassByMarketId = new Map((allMarketRows ?? []).map(m => [m.market_id, m.asset_class as string]))

    // tradesBySymbol: all analysts pooled -- still needed for markets that fall
    // through to the team-wide fallback path (Step 5) when no analyst has a
    // profile match. tradesByAnalystSymbol: same trades, additionally keyed by
    // analyst, so the analyst-first path (Step 5) can hand buildRecommendation()
    // only the assigned analyst's own history instead of the team average.
    const tradesBySymbol = new Map<string, RecommendationInputTrade[]>()
    const tradesByAnalystSymbol = new Map<string, RecommendationInputTrade[]>()
    for (const t of allTradeRows) {
      const symbol = symbolByMarketId.get(t.market_id)
      if (!symbol) continue
      const input = {
        market: symbol,
        direction: t.direction,
        entryZone: t.entry_zone ?? null,
        resultR: t.result_r !== null ? Number(t.result_r) : null,
        triggered: t.triggered ?? false,
        analyst: t.analyst_id,
      } as RecommendationInputTrade

      if (!tradesBySymbol.has(symbol)) tradesBySymbol.set(symbol, [])
      tradesBySymbol.get(symbol)!.push(input)

      const asKey = `${t.analyst_id}::${symbol}`
      if (!tradesByAnalystSymbol.has(asKey)) tradesByAnalystSymbol.set(asKey, [])
      tradesByAnalystSymbol.get(asKey)!.push(input)
    }

    const { data: profileRows } = await db
      .from('analyst_profiles')
      .select('analyst_id, market_id, direction, zone, profile_data')
      .in('analyst_id', eligibleAnalysts.map(a => a.analyst))

    // Grouped by analyst for scoreAnalystForMarket()'s per-analyst scoring pass.
    // asset_class is joined in here (analyst_profiles itself has no such column)
    // so the REGIME tier's cross-market, same-asset-class rollup can filter on it.
    const profilesByAnalyst = new Map<string, AnalystProfileRow[]>()
    for (const p of (profileRows ?? [])) {
      const assetClass = assetClassByMarketId.get(p.market_id)
      if (!assetClass) continue
      if (!profilesByAnalyst.has(p.analyst_id)) profilesByAnalyst.set(p.analyst_id, [])
      profilesByAnalyst.get(p.analyst_id)!.push({ ...p, asset_class: assetClass } as unknown as AnalystProfileRow)
    }

    // Load all analyst ATR profiles once (analyst_atr_profiles, migrations/046) so
    // buildRecommendation() can look up whether this analyst has a profile for this
    // market/direction/zone without a DB round trip per market -- no longer feeds
    // stop/target geometry (band-boundary logic replaced the ATR-multiplier profiles),
    // kept for the analystAtrProfileUsed diagnostics/adoption-tracking field. Keyed the
    // same way analystAtrProfileService.ts's getAnalystAtrProfile() would look one up
    // individually, via atrProfileMapKey().
    const { data: atrProfileRows } = await db.from('analyst_atr_profiles').select('*')
    const atrProfileMap = new Map<string, AtrProfile>()
    for (const row of (atrProfileRows ?? [])) {
      atrProfileMap.set(atrProfileMapKey(row.analyst_id, row.direction, row.zone), {
        stopAtrQ25: Number(row.stop_atr_q25),
        stopAtrMedian: Number(row.stop_atr_median),
        stopAtrQ75: Number(row.stop_atr_q75),
        targetAtrQ25: Number(row.target_atr_q25),
        targetAtrMedian: Number(row.target_atr_median),
        targetAtrQ75: Number(row.target_atr_q75),
      })
    }
    console.log(`  Analyst ATR profiles loaded: ${atrProfileMap.size}`)

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data: regimeRows } = await db
      .from('market_regime_state')
      .select('market_id, trend_state, volatility_state, regime_confidence, regime_tags, captured_at')
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

    // Tracks analyst-first assignments across this whole markets loop (not per-market) so
    // workloadAdjustedScore() can see how loaded an analyst already is before handing them
    // another market. Also seeded into allocateCoverage() in Step 4 below (as
    // initialWorkload) so fallback assignments see this same running total instead of
    // starting fresh from 0 -- without that, an analyst already at 10 analyst-first
    // markets could still be freely handed fallback markets on top.
    const analystWorkload = new Map<string, number>()
    for (const a of eligibleAnalysts) {
      analystWorkload.set(a.analyst, 0)
    }

    // Seed with today's assignments from sessions that have already run (e.g. EUROPEAN
    // at 04:50 before US runs at 09:50) -- without this, analystWorkload resets to 0
    // every session, so MAX_MARKETS_PER_ANALYST only ever capped a single session's
    // worth of assignments rather than the intended full-day total: confirmed live,
    // Ian getting 10 EUROPEAN markets then another 8 on US, 18 total against an
    // intended cap of 11. Excludes this session's own rows so a resumed (retried) run
    // of the SAME session doesn't self-penalise against its own prior, about-to-be-
    // overwritten partial attempt -- the markets loop below re-decides every market in
    // sessionMarkets from scratch on every run, resume or not.
    const { data: todayAllocations } = await db
      .from('opportunities')
      .select('assigned_analyst_id')
      .eq('date', today)
      .neq('session', session)
      .not('assigned_analyst_id', 'is', null)

    for (const row of todayAllocations ?? []) {
      if (row.assigned_analyst_id) {
        const current = analystWorkload.get(row.assigned_analyst_id) ?? 0
        analystWorkload.set(row.assigned_analyst_id, current + 1)
      }
    }
    console.log(`  Cross-session workload seeded: ${(todayAllocations ?? []).length} existing assignment(s) today from other sessions`)

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
      // atr20: from market_state_daily Wilder RMA period 20 -- zone bands only.
      // atr14: from market_state_daily Wilder RMA period 14 -- stop/target
      // distances only (entryOptimizerService.ts), read directly rather than
      // falling back to atr20 the way atr20FromDaily falls back to atr14 below --
      // that fallback exists to keep the ZONE calc alive when atr20 is missing;
      // reusing it here would silently reintroduce the exact atr20-standing-in-
      // for-atr14 bug this fix removes.
      const prevClose = intraday.previous_close != null ? Number(intraday.previous_close) : null
      const lastBar = bars.length > 0 ? bars[bars.length - 1] : null
      const atr20FromDaily = lastBar?.atr20 != null ? Number(lastBar.atr20) : lastBar?.atr14 != null ? Number(lastBar.atr14) : null
      const atr14FromDaily = lastBar?.atr14 != null ? Number(lastBar.atr14) : null
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
          precomputedAtr14: atr14FromDaily ?? undefined,
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

      const rvId = randomUUID()
      const regime = regimeByMarketId.get(market.market_id)
      const marketCurrentZone = marketStateWithZone.currentZone
      const trendState = regime?.trend_state ?? null
      const volatilityState = regime?.volatility_state ?? null

      // ── Analyst-first scoring (Step 5): score every eligible analyst
      // against this market's regime + zone, and let the best-scoring one
      // (confidence x avgR) both supply the direction and receive the
      // assignment -- no separate team-wide direction pass, no separate
      // workload-balanced allocation pass, for markets where at least one
      // analyst has a real profile match. Wrapped in try/catch per the
      // "never crash the session" requirement -- a scoring failure here
      // degrades to the pre-Step-5 team-wide behaviour, exactly like a
      // market with no analyst profile match at all.
      let bestScore: AnalystScore | null = null
      let scoringFailed = false
      try {
        // For each market, score all analysts. Direction-aware: a counter-trend pick
        // (alignmentMultiplier 0.7) needs a meaningfully stronger edge than a trend-aligned
        // one (1.0) to win. profileTier==='NONE' is excluded before the workload adjustment
        // even runs -- an analyst with no real match for this market shouldn't win just
        // because everyone else happens to be near their workload cap.
        const scored = eligibleAnalysts.map(a => {
          const raw = scoreAnalystForMarket(
            a.analyst, market.market_id, market.asset_class, trendState, volatilityState, marketCurrentZone,
            profilesByAnalyst.get(a.analyst) ?? [],
          )
          const workload = analystWorkload.get(a.analyst) ?? 0
          // Use absolute avgR for competition -- a negative edge analyst with REGIME-tier
          // match still has meaningful historical data and should compete fairly.
          // Real avgR is preserved on raw.avgR for display and template selection.
          const baseValue = raw.confidence * Math.abs(raw.avgR) * raw.alignmentMultiplier
          const adjustedValue = raw.profileTier === 'NONE'
            ? -1
            : workloadAdjustedScore(baseValue, workload, sessionMarkets.length, eligibleAnalysts.length)
          return { score: raw, adjustedValue }
        })

        // Filter out capped (or NONE-tier) analysts and pick the highest adjusted score.
        // NONE-tier candidates all score exactly 0 (analystScoringService.ts scores them
        // 0, not an overall-avgR figure, specifically so this workload tiebreak -- not raw
        // historical edge -- decides between them): 0 * (1 - penalty) is still 0 regardless
        // of workload, so without an explicit tiebreak here, Array.sort's stability would
        // just resolve every NONE-tier market to whichever analyst happened to load first
        // from the DB, not the one with the lowest current workload. Ties elsewhere (a real
        // score, not just NONE-tier) also fall back to this, which is a reasonable fairness
        // rule in general, not just a NONE-tier special case.
        const eligible = scored.filter(s => s.adjustedValue >= 0)
        const selected = eligible.sort((a, b) => {
          if (b.adjustedValue !== a.adjustedValue) return b.adjustedValue - a.adjustedValue
          const workloadA = analystWorkload.get(a.score.analystId) ?? 0
          const workloadB = analystWorkload.get(b.score.analystId) ?? 0
          return workloadA - workloadB
        })[0]

        if (selected) {
          bestScore = selected.score
          analystWorkload.set(selected.score.analystId, (analystWorkload.get(selected.score.analystId) ?? 0) + 1)
        }
      } catch (err) {
        console.log(`    ${symbol}: analyst scoring failed (${(err as Error).message}) -- falling back to team-wide behaviour`)
        scoringFailed = true
      }

      let assignedAnalystId: string | null = null
      let preferredDirection: 'BUY' | 'SELL' | null = null

      if (bestScore && !scoringFailed) {
        assignedAnalystId = bestScore.analystId
        preferredDirection = bestScore.preferredDirection
        const name = analystNameById.get(bestScore.analystId) ?? bestScore.analystId
        console.log(`    ${symbol}: ${name} (${bestScore.profileTier} / ${bestScore.directionAlignment} / avgR=${bestScore.avgR.toFixed(3)}) dir=${preferredDirection ?? 'none'} confidence=${bestScore.confidence.toFixed(2)}`)
      } else {
        // Fallback: no analyst has any profile match for this market (all NONE tier), every
        // matched analyst is already at their workload hard cap, or scoring threw -- team-wide
        // direction cascade, exactly as before Step 5. Analyst assignment is deferred to the
        // workload-balanced allocateCoverage() pass in Step 4.
        const regimeMatchedDirection = preferredDirectionByMarketId.get(market.market_id)
        if (regimeMatchedDirection) {
          preferredDirection = regimeMatchedDirection
          console.log(`    Fallback: Profile(regime=${trendState ?? 'none'}) → direction: ${preferredDirection}`)
        } else if (trendState === 'TRENDING_UP') {
          preferredDirection = 'BUY'
          console.log(`    Fallback: Regime(TRENDING_UP) → direction: BUY`)
        } else if (trendState === 'TRENDING_DOWN') {
          preferredDirection = 'SELL'
          console.log(`    Fallback: Regime(TRENDING_DOWN) → direction: SELL`)
        } else if (marketCurrentZone && ['ZONE_1', 'ZONE_2', 'TOO_DEEP'].includes(marketCurrentZone)) {
          preferredDirection = 'BUY'
          console.log(`    Fallback: Zone(${marketCurrentZone}) → direction: BUY`)
        } else if (marketCurrentZone && ['ZONE_3', 'ZONE_4', 'TOO_HIGH'].includes(marketCurrentZone)) {
          preferredDirection = 'SELL'
          console.log(`    Fallback: Zone(${marketCurrentZone}) → direction: SELL`)
        }
        console.log(`    Fallback: no eligible analyst-first pick for ${symbol} (no profile match or all matched analysts at workload cap) -- assignment deferred to workload-balanced allocation`)
      }

      const regimeSnapshot: RegimeSnapshot | null = regime ? {
        trendState: regime.trend_state ?? null,
        regimeConfidence: regime.regime_confidence ?? null,
        regimeTags: regime.regime_tags ?? [],
        volatilityState: regime.volatility_state ?? null,
      } : null

      // Step 5 Step C: the assigned analyst's own trades when we already know
      // who that is; team-wide pooled trades when assignment is deferred to
      // the fallback's workload-balanced allocation pass (we don't yet know
      // who that'll be).
      const trades = assignedAnalystId
        ? (tradesByAnalystSymbol.get(`${assignedAnalystId}::${symbol}`) ?? [])
        : (tradesBySymbol.get(symbol) ?? [])

      try {
        const result = buildRecommendation({
          recommendationVersionId: rvId,
          generatedAt,
          market: symbol,
          session,
          marketState: marketStateWithZone,
          marketRegime: regimeSnapshot,
          sessionHigh: intraday.session_high != null ? Number(intraday.session_high) : null,
          sessionLow: intraday.session_low != null ? Number(intraday.session_low) : null,
          eventRisks: [],
          trades,
          activeAnalysts: eligibleAnalysts,
          minimumRr: MINIMUM_RR,
          minTriggerSample: MIN_TRIGGER_SAMPLE,
          fallbackTriggerProbability: FALLBACK_TRIGGER_PROBABILITY,
          staleAtrThreshold: STALE_ATR_THRESHOLD,
          forceRecalcAtrThreshold: FORCE_RECALC_ATR_THRESHOLD,
          parameterSnapshot,
          parameterSnapshotHash,
          marketDisplayPrecision: market.display_precision ?? null,
          preferredDirection,
          atrProfileMap,
          analystTriggerRateMap: analystTriggerRates,
        })

        const { opportunity: opp, recommendationVersion: rv, hiddenExecutionLevels: hidden, diagnostics } = result

        if (!rv || rv.entryRangeLow === undefined) {
          console.log(`  ${symbol}: rv issue — entryRangeLow=${rv?.entryRangeLow}`)
          continue
        }

        const triggerProbability = opp.triggerProbability

        console.log(`  ${symbol}: zone=${marketStateWithZone.currentZone}, dir=${opp.direction}, action=${opp.analystAction}, entry=${rv.entryRangeLow?.toFixed(4)}-${rv.entryRangeHigh?.toFixed(4)}, R=${opp.expectedR?.toFixed(2)}, trigger=${Math.round(triggerProbability * 100)}%, template=${diagnostics.templateSource}(${diagnostics.templateTrades} trades)`)

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
          rvId, validityOverride, triggerProbability, trendState,
          preAssignedAnalystId: assignedAnalystId, // null => deferred to fallback allocation (Step 4)
          analystScore: bestScore, // null when the fallback path was used
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

      // Step 5 Step D: analyst-first items already carry their assignment from
      // Step 3's scoring pass -- the highest-scoring analyst per market IS the
      // allocation, no separate scoring/workload pass needed for these.
      // Fallback items (no analyst had a profile match) still go through the
      // pre-Step-5 workload-balanced allocateCoverage() pass, seeded with
      // analystWorkload (see initialWorkload below) so it knows about analyst-first
      // and cross-session load already on the books rather than starting from 0.
      type ResolvedAllocation = {
        allocationId: string; assignedAnalystId: string; eligibleAnalysts: string[]
        allocationScore: number; reasonSummary: string
      }
      const allocationByRvId = new Map<string, ResolvedAllocation>()

      const analystFirstItems = generatedItems.filter(item => item.preAssignedAnalystId)
      const fallbackItems = generatedItems.filter(item => !item.preAssignedAnalystId)

      // Captured below as each opportunity is successfully written -- feeds the
      // OPTIMAL shadow trade pass after this loop. Independent of whether the
      // ANALYST_MIRROR shadow trade itself succeeds/is band-reliable for that
      // market; the OPTIMAL pass re-checks band reliability on its own.
      const optimalPassCandidates: Array<{
        market: any; marketState: any; trendState: string | null; intraday: any
        opportunityId: string; recommendationVersionId: string
        opportunityDirection: 'BUY' | 'SELL'
      }> = []

      for (const item of analystFirstItems) {
        const score = item.analystScore as AnalystScore
        allocationByRvId.set(item.rvId, {
          allocationId: randomUUID(),
          assignedAnalystId: score.analystId,
          eligibleAnalysts: eligibleAnalysts.map(a => a.analyst),
          // Matches the value actually used to rank/select this analyst in Step 3.
          allocationScore: score.confidence * score.avgR * score.alignmentMultiplier,
          reasonSummary: `Assigned via analyst-first profile scoring (tier: ${score.profileTier}, alignment: ${score.directionAlignment}, avgR: ${score.avgR.toFixed(3)}, confidence: ${score.confidence.toFixed(2)}).`,
        })
      }

      if (fallbackItems.length > 0) {
        const allocationInput: OpportunityForAllocation[] = fallbackItems.map(item => {
          let bestAnalystId: string | null = null
          let bestPScore = -Infinity
          for (const a of eligibleAnalysts) {
            const key = `${a.analyst}::${item.market.market_id}::${item.opp.direction}`
            const pScore = profileScores.get(key) ?? -Infinity
            if (pScore > bestPScore) { bestPScore = pScore; bestAnalystId = a.analyst }
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
          initialWorkload: analystWorkload,
        })

        for (const a of allocations) {
          allocationByRvId.set(a.recommendationVersionId, {
            allocationId: a.allocationId, assignedAnalystId: a.assignedAnalystId,
            eligibleAnalysts: a.eligibleAnalysts, allocationScore: a.allocationScore,
            reasonSummary: a.reasonSummary,
          })
        }
      }

      // EUROPEAN only: the real, final per-market assignment (post analyst-first +
      // fallback allocation) overwrites daily_coverage_plan for session='EUROPEAN'
      // once this loop finishes, superseding preallocateDay.ts's earlier forecast
      // for this session -- see that script's header comment, which no longer
      // pre-allocates EUROPEAN at all for this exact reason. US/APAC still rely on
      // preallocateDay.ts's forecast; only EUROPEAN's plan is overwritten with reality.
      const europeanCoveragePlanRows: { market_id: string; analyst_id: string }[] = []

      for (const item of generatedItems) {
        const { market, marketState, opp, rv, hidden, diagnostics, validityOverride, triggerProbability, trendState } = item
        const allocation = allocationByRvId.get(item.rvId)
        if (!allocation) {
          console.log(`  ⚠ ${market.symbol}: no analyst could be assigned -- skipping recommendation`)
          continue
        }

        // directionAlignment for regime_tags/coaching must reflect the recommendation
        // itself (opp.direction, what the engine is actually telling the analyst to
        // do today) vs today's trend -- not item.analystScore.directionAlignment,
        // which is the analyst's historical PROFILE direction vs trend (still correct
        // and unchanged as the analyst-first scoring/ranking signal in
        // analystScoringService.ts, just the wrong thing to show an analyst as "is
        // this recommendation with or against the trend"). Computed unconditionally
        // (not gated on item.analystScore existing) since the recommendation
        // direction and trend are always known regardless of which path -- analyst-
        // first or fallback -- assigned the analyst; the fallback path previously
        // wrote no directionAlignment into regime_tags at all.
        const recDirection = opp.direction
        const trendBullish = trendState === 'TRENDING_UP'
        const trendBearish = trendState === 'TRENDING_DOWN'
        const ranging = trendState === 'RANGE' || trendState === 'MIXED'
        const recommendationAlignment: DirectionAlignment = !trendState
          ? 'NONE'
          : ranging
            ? 'NEUTRAL'
            : (recDirection === 'BUY' && trendBullish) || (recDirection === 'SELL' && trendBearish)
              ? 'TREND_ALIGNED'
              : (recDirection === 'BUY' && trendBearish) || (recDirection === 'SELL' && trendBullish)
                ? 'COUNTER_TREND'
                : 'NEUTRAL'

        const intraday = intradayByMarket.get(market.market_id)

        const { data: oppRow, error: oppErr } = await db.from('opportunities').upsert({
          date: today, market_id: market.market_id, session,
          publication_window_start_uk: `${String(windowStartHour).padStart(2,'0')}:00`,
          publication_window_end_uk: `${String(windowEndHour).padStart(2,'0')}:00`,
          current_zone: marketState.currentZone ?? intraday?.current_zone,
          preferred_entry_zone: opp.preferredEntryZone,
          direction: item.opp.direction,
          expected_r: opp.expectedR,
          trigger_probability: triggerProbability,
          opportunity_lifecycle_status: 'ASSIGNED',
          analyst_action: opp.analystAction,
          assigned_analyst_id: allocation.assignedAnalystId,
        }, { onConflict: 'date,market_id,session,version' }).select('opportunity_id').single()

        if (oppErr || !oppRow) { console.error(`  ${market.symbol} opp error: ${oppErr?.message}`); continue }
        opportunitiesCreated++
        if (session === 'EUROPEAN') {
          europeanCoveragePlanRows.push({ market_id: market.market_id, analyst_id: allocation.assignedAnalystId })
        }

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
          // recommendation_versions.regime_tags carries two things through to the
          // database, both otherwise lost when the process exits: the engine's
          // direction-alignment verdict (workspace's "Why This Is Being Recommended"
          // commentary reads this rather than re-deriving alignment from
          // trend+direction client-side) and RecommendationDiagnostics -- template/
          // profile avgR and quality, raw (pre-confidence-scaling) trigger
          // probability, and whether an analyst-specific ATR profile was used --
          // without this, there's no way to audit why a recommendation looked the
          // way it did from the database alone. directionAlignment is now always
          // present (computed above from the recommendation's own direction vs
          // today's trend, not the analyst's historical profile direction) --
          // alignmentMultiplier/profileTier remain analyst-first-path-only (no
          // AnalystScore exists for the fallback path); the diagnostics fields are
          // always present, since buildRecommendation() always returns diagnostics
          // regardless of which path assigned the analyst.
          // Was writing direction_alignment (snake_case) while every reader queries
          // regime_tags->>'directionAlignment' (camelCase) -- silently always null.
          //
          // lowerBand/upperBand: the band boundaries this recommendation's target/
          // stop were computed against. Nothing else persists these per-recommendation
          // (marketState itself is never written to a table), and generatePostTradeReviews.ts's
          // alignment scoring (Fix 5) needs them at review time to check whether the
          // trade's actual stop/target landed outside/inside the band that was live
          // at generation -- reusing this existing jsonb column avoids a new migration.
          regime_tags: {
            directionAlignment: recommendationAlignment,
            ...(item.analystScore ? {
              alignmentMultiplier: (item.analystScore as AnalystScore).alignmentMultiplier,
              profileTier: (item.analystScore as AnalystScore).profileTier,
            } : {}),
            templateAvgR: diagnostics.templateAvgR,
            profileAvgR: diagnostics.profileAvgR,
            templateQuality: diagnostics.templateQuality,
            profileSource: diagnostics.profileSource,
            rawTriggerProbability: diagnostics.rawTriggerProbability,
            analystAtrProfileUsed: diagnostics.analystAtrProfileUsed ?? false,
            lowerBand: marketState.lowerBand,
            upperBand: marketState.upperBand,
          },
        }, { onConflict: 'recommendation_version_id' }).select('recommendation_version_id').single()

        if (rvErr || !rvRow) { console.error(`  ${market.symbol} rv error: ${rvErr?.message}`); continue }

        await db.from('opportunities')
          .update({ active_recommendation_version_id: rvRow.recommendation_version_id })
          .eq('opportunity_id', oppRow.opportunity_id)

        optimalPassCandidates.push({
          market, marketState, trendState,
          intraday: intradayByMarket.get(market.market_id),
          opportunityId: oppRow.opportunity_id,
          recommendationVersionId: rvRow.recommendation_version_id,
          opportunityDirection: item.opp.direction,
        })

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
            trendState,
            analystAction: opp.analystAction,
            entryRangeLow: rv.entryRangeLow ?? 0,
            entryRangeHigh: rv.entryRangeHigh ?? 0,
            riskRange: rv.riskRange,
            targetRange: rv.targetRange,
            triggerProbability,
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

        // Band reliability guard: once the intraday session range already exceeds
        // 1.5x ATR20, price has moved more than a full ATR since session open, so the
        // zone boundaries this recommendation's stop/target were built from are stale
        // by the time the engine runs -- not a fair benchmark for a shadow trade. The
        // opportunity/recommendation/coaching row above are still written regardless
        // (still valid, analyst-facing signal); only shadow trade generation is skipped.
        const sessionRange = (intraday.session_high ?? 0) - (intraday.session_low ?? 0)
        const atr20 = marketState.atr20 ?? marketState.atr14 ?? 0
        const bandReliable = atr20 > 0 && sessionRange <= atr20 * 1.5

        if (!bandReliable) {
          console.log(`  ${market.symbol}: skipping shadow trade -- intraday range (${sessionRange.toFixed(5)}) exceeds 1.5x ATR20 (${(atr20 * 1.5).toFixed(5)})`)
          shadowTradesSkippedUnreliableBand++
          continue
        }

        try {
          // Zone bounds and band boundaries are the same for all three variants --
          // rv.entryRangeLow/High is entryStopTarget.entryRangeLow/High
          // (recommendationService.ts), i.e. the exact zone the single analyst-facing
          // recommendation already uses. Only the entry point within that zone (and
          // therefore stop/target/rr, via variantStopTargetRr()) differs per variant.
          const zoneLow   = Number(rv.entryRangeLow)
          const zoneHigh  = Number(rv.entryRangeHigh)
          const lowerBand = Number(marketState.lowerBand)
          const upperBand = Number(marketState.upperBand)
          const direction = item.opp.direction

          // APAC engine runs at 13:05 UTC, hours before APAC-session analysts actually
          // publish -- monitoring the shadow trade immediately would measure market
          // movement between generation and publication as if it were the trade itself.
          // See migrations/053_shadow_trades_monitor_from.sql. Same reasoning for US:
          // engine-us runs at 08:48 UTC, well before US-session analysts actually
          // publish -- gated until 12:00 UTC (13:00 UK) instead. Same for every variant
          // of this opportunity, so computed once outside the loop below.
          const monitorFrom = session === 'APAC'
            ? new Date(new Date(generatedAt).toISOString().slice(0, 10) + 'T15:00:00Z').toISOString()
            : session === 'US'
            ? new Date(new Date(generatedAt).toISOString().slice(0, 10) + 'T12:00:00Z').toISOString()
            : null
          const expiresAt = computeExpiresAt(session, market.asset_class ?? null, new Date(generatedAt)).toISOString()

          for (const variant of ENTRY_VARIANTS) {
            // ZONE_MID reuses hiddenExecutionLevels' already-computed entry/stop/
            // target/rr directly (not a parallel recomputation), guaranteeing this
            // variant stays byte-identical to current behaviour -- exactly what
            // variantEntry()'s own 'current behaviour' comment says for ZONE_MID.
            // ZONE_BOTTOM/ZONE_TOP compute a fresh entry via variantEntry() and
            // fresh stop/target/rr via variantStopTargetRr(), off the same band.
            const entry = variant === 'ZONE_MID'
              ? hidden.entryPrice
              : variantEntry(direction, variant, zoneLow, zoneHigh)
            const { stop, target, rr } = variant === 'ZONE_MID'
              ? { stop: hidden.stop, target: hidden.target, rr: hidden.rr }
              : variantStopTargetRr(direction, entry, lowerBand, upperBand, MINIMUM_RR)

            const shadowId = randomUUID()
            const shadowOutcomeId = randomUUID()
            const { shadowTrade, shadowTradeOutcome } = createShadowTrade({
              shadowTradeId: shadowId,
              shadowOutcomeId,
              createdAt: generatedAt,
              recommendationVersionId: rvRow.recommendation_version_id,
              opportunityId: oppRow.opportunity_id,
              entry, stop, target, rr,
              templateSource: diagnostics.templateSource,
              direction,
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
              // Every shadow trade waits for price to reach the entry range, regardless
              // of the analyst-facing analystAction (which stays ENTER_NOW/
              // WAIT_FOR_PREFERRED_ZONE on the opportunity itself -- that's still a valid
              // read on current price vs. the preferred zone for the analyst). Triggering
              // a shadow trade at the snapshot price the moment it's generated was never a
              // real "entry" -- it's not a benchmark for what a disciplined trader would
              // have actually done.
              entry_mode: 'WAIT_FOR_PREFERRED_ZONE',
              generated_price: Number(intraday.current_price),
              expires_at: expiresAt,
              price_provider: 'FINNHUB_OANDA',
              price_resolution: '5MIN',
              monitor_from: monitorFrom,
              entry_variant: variant,
              shadow_system: 'ANALYST_MIRROR',
              // Same analyst already assigned this opportunity (allocation.assignedAnalystId,
              // used above for opportunities/coverage_allocation) -- migrations/
              // 062_shadow_optimal_analyst.sql. Additive field only; the analyst
              // assignment/variant generation logic above is unchanged.
              profile_analyst_id: allocation.assignedAnalystId,
            }).select('shadow_trade_id').single()

            if (!shadowError && shadowRow) {
              await db.from('shadow_trade_outcomes').insert({
                shadow_outcome_id: shadowTradeOutcome.shadowOutcomeId,
                shadow_trade_id: shadowRow.shadow_trade_id,
                // shadow trade outcome always starts NOT_TRIGGERED -- price must reach
                // the entry range before triggering.
                trade_outcome_status: 'NOT_TRIGGERED',
                triggered_at: null,
                triggered_price: null,
                trigger_source: null,
              })
              shadowTradesCreated++
            } else if (shadowError) {
              console.log(`  ${market.symbol} shadow (${variant}): ${shadowError.message}`)
            }
          }
        } catch (err) {
          console.log(`  ${market.symbol} shadow: ${(err as Error).message}`)
        }
      }

      // ── OPTIMAL pass: unconstrained best-profile shadow trades ────────────────
      // Runs after every opportunity this session has been written -- purely
      // additive shadow trade generation, no recommendations/allocations/coaching
      // touched. For each opportunity, scores every session-eligible analyst
      // against this market/regime (same confidence x |avgR| x alignmentMultiplier
      // formula as the main engine's analyst-first scoring above), with no
      // workload cap at all -- every market gets an OPTIMAL trade regardless of
      // how many other markets that analyst already "won" here or in the main
      // pass. Skips a market only when no analyst has a real (non-NONE) tier
      // signal for it, or the band is unreliable (same 1.5x ATR20 check as the
      // ANALYST_MIRROR pass, re-evaluated independently per market).
      console.log(`\nOPTIMAL pass: scoring ${optimalPassCandidates.length} opportunit${optimalPassCandidates.length === 1 ? 'y' : 'ies'}...`)
      for (const candidate of optimalPassCandidates) {
        const { market, marketState, trendState, intraday, opportunityId, recommendationVersionId, opportunityDirection } = candidate
        try {
          const volatilityState = regimeByMarketId.get(market.market_id)?.volatility_state ?? null
          const currentZone = marketState.currentZone ?? null

          let best: AnalystScore | null = null
          let bestValue = -Infinity
          for (const a of eligibleAnalysts) {
            const score = scoreAnalystForMarket(
              a.analyst, market.market_id, market.asset_class, trendState, volatilityState, currentZone,
              profilesByAnalyst.get(a.analyst) ?? [],
            )
            if (score.profileTier === 'NONE' || !score.preferredDirection) continue
            const value = score.confidence * Math.abs(score.avgR) * score.alignmentMultiplier
            if (value > bestValue) { bestValue = value; best = score }
          }

          if (!best || !best.preferredDirection) {
            console.log(`  ${market.symbol}: OPTIMAL skipped -- no analyst has a real profile signal for this market`)
            optimalSkippedNoSignal++
            continue
          }

          const sessionRange = (intraday?.session_high ?? 0) - (intraday?.session_low ?? 0)
          const atr20 = marketState.atr20 ?? marketState.atr14 ?? 0
          const bandReliable = atr20 > 0 && sessionRange <= atr20 * 1.5
          if (!bandReliable) {
            console.log(`  ${market.symbol}: OPTIMAL skipped -- intraday range (${sessionRange.toFixed(5)}) exceeds 1.5x ATR20 (${(atr20 * 1.5).toFixed(5)})`)
            optimalSkippedUnreliableBand++
            continue
          }

          const optimalDirection = best.preferredDirection
          const zone = selectEntryZone(optimalDirection, trendState)
          const [rawZoneLow, rawZoneHigh] = zoneBounds(marketState, zone)
          const zoneLow = Math.min(rawZoneLow, rawZoneHigh)
          const zoneHigh = Math.max(rawZoneLow, rawZoneHigh)
          const lowerBand = Number(marketState.lowerBand)
          const upperBand = Number(marketState.upperBand)

          if ([zoneLow, zoneHigh, lowerBand, upperBand].some(v => Number.isNaN(v))) {
            console.log(`  ${market.symbol}: OPTIMAL skipped -- no usable band/zone geometry`)
            optimalSkippedNoSignal++
            continue
          }

          if (optimalDirection !== opportunityDirection) {
            console.log(`  ${market.symbol}: OPTIMAL direction (${optimalDirection}, ${best.profileTier}) differs from recommendation (${opportunityDirection})`)
          }

          const monitorFrom = session === 'APAC'
            ? new Date(new Date(generatedAt).toISOString().slice(0, 10) + 'T15:00:00Z').toISOString()
            : session === 'US'
            ? new Date(new Date(generatedAt).toISOString().slice(0, 10) + 'T12:00:00Z').toISOString()
            : null
          const expiresAt = computeExpiresAt(session, market.asset_class ?? null, new Date(generatedAt)).toISOString()

          for (const variant of ENTRY_VARIANTS) {
            const entry = variantEntry(optimalDirection, variant, zoneLow, zoneHigh)
            const { stop, target, rr } = variantStopTargetRr(optimalDirection, entry, lowerBand, upperBand, MINIMUM_RR)

            const shadowId = randomUUID()
            const shadowOutcomeId = randomUUID()
            const { shadowTrade, shadowTradeOutcome } = createShadowTrade({
              shadowTradeId: shadowId,
              shadowOutcomeId,
              createdAt: generatedAt,
              recommendationVersionId,
              opportunityId,
              entry, stop, target, rr,
              // Not template-selection based (no buildRecommendation() call in this
              // pass) -- 'unknown' is the honest value here, not one of the real
              // template-derived sources.
              templateSource: 'unknown',
              direction: optimalDirection,
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
              entry_mode: 'WAIT_FOR_PREFERRED_ZONE',
              generated_price: Number(intraday?.current_price),
              expires_at: expiresAt,
              price_provider: 'FINNHUB_OANDA',
              price_resolution: '5MIN',
              monitor_from: monitorFrom,
              entry_variant: variant,
              shadow_system: 'OPTIMAL',
              // migrations/062_shadow_optimal_analyst.sql -- the analyst whose profile
              // was scored highest for this market, may differ from the opportunity's
              // own assigned_analyst_id.
              profile_analyst_id: best.analystId,
            }).select('shadow_trade_id').single()

            if (!shadowError && shadowRow) {
              await db.from('shadow_trade_outcomes').insert({
                shadow_outcome_id: shadowTradeOutcome.shadowOutcomeId,
                shadow_trade_id: shadowRow.shadow_trade_id,
                trade_outcome_status: 'NOT_TRIGGERED',
                triggered_at: null,
                triggered_price: null,
                trigger_source: null,
              })
              optimalShadowTradesCreated++
            } else if (shadowError) {
              console.log(`  ${market.symbol} OPTIMAL shadow (${variant}): ${shadowError.message}`)
            }
          }
        } catch (err) {
          console.log(`  ${market.symbol} OPTIMAL shadow: ${(err as Error).message}`)
        }
      }

      // Overwrite daily_coverage_plan for session='EUROPEAN' with this run's real
      // assignments, one batch upsert after the loop above rather than per-market --
      // see europeanCoveragePlanRows' declaration comment. Only markets that got a
      // real assignment this run are touched; a EUROPEAN market that produced no
      // opportunity this run (skipped/errored above) keeps whatever row already
      // exists (preallocateDay.ts's forecast, or a previous day's engine run),
      // rather than being deleted.
      if (session === 'EUROPEAN' && europeanCoveragePlanRows.length > 0) {
        const { error: coveragePlanError } = await db.from('daily_coverage_plan').upsert(
          europeanCoveragePlanRows.map(r => ({
            date: today, market_id: r.market_id, analyst_id: r.analyst_id, session: 'EUROPEAN',
          })),
          { onConflict: 'date,market_id,session' },
        )
        if (coveragePlanError) {
          console.error(`  daily_coverage_plan overwrite failed: ${coveragePlanError.message}`)
        } else {
          console.log(`  daily_coverage_plan: ${europeanCoveragePlanRows.length} EUROPEAN row(s) overwritten with real assignments`)
        }
      }

      await completeStep(db, stepId4, 'SUCCESS', {
        opportunities: opportunitiesCreated, recommendations: recommendationsCreated,
        coaching: coachingCreated, shadow_trades: shadowTradesCreated,
        shadow_trades_skipped_unreliable_band: shadowTradesSkippedUnreliableBand,
        optimal_shadow_trades: optimalShadowTradesCreated,
        optimal_skipped_no_signal: optimalSkippedNoSignal,
        optimal_skipped_unreliable_band: optimalSkippedUnreliableBand,
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
      console.log(`  skipped (unreliable band): ${shadowTradesSkippedUnreliableBand}`)
      console.log(`OPTIMAL shadow trades: ${optimalShadowTradesCreated}`)
      console.log(`  skipped (no signal):       ${optimalSkippedNoSignal}`)
      console.log(`  skipped (unreliable band): ${optimalSkippedUnreliableBand}`)
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









