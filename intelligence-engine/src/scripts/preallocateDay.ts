// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Day-Start Coverage Preallocation
// ============================================================================
// Runs once at the very start of the day (04:20 UTC -- before populate-daily
// at 04:28, before derive-regime at 04:33, before EUROPEAN's own engine run
// at 04:48) and assigns every market across all three sessions (EUROPEAN +
// US + APAC combined) to an analyst in a single pass, writing the result to
// daily_coverage_plan (migrations/049) so analysts can see a full-day
// coverage forecast first thing in the morning.
//
// Deliberately NOT a scaled-down engine run:
//   - No captureIntradaySnapshot / market_state_intraday read -- there is no
//     price data yet this early, and none is needed. Scoring here only
//     needs a trend/volatility regime reading and each analyst's historical
//     profile, neither of which depends on today's price action.
//   - No buildRecommendation() -- no entry/stop/target, no expected_r, no
//     opportunities/recommendation_versions/coaching_recommendations rows.
//   - No shadow trades.
//   - Regime comes from whatever market_regime_state already holds -- at
//     04:20 UTC that's still YESTERDAY's reading, since derive-regime hasn't
//     run yet for today. This is intentional, not a workaround: the whole
//     point of running this early is to give analysts a plan before the
//     day's real data exists, so it necessarily scores off the most recent
//     regime available rather than waiting for a fresher one.
//
// Advisory only: each session's real engine run (runEngineSession.ts) still
// does its own live analyst-first scoring against that day's actual regime
// and its own cross-session workload seeding from `opportunities` -- this
// script's plan is a forecast, not a binding assignment, and the two can
// legitimately disagree once real intraday data exists. See migration 049's
// comment for the same point from the schema side.
//
// Usage:
//   npx tsx src/scripts/preallocateDay.ts --dry-run
//   npx tsx src/scripts/preallocateDay.ts
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { scoreAnalystForMarket, type AnalystScore, type AnalystProfileRow } from '../services/analystScoringService.js'
import { allocateCoverage, type OpportunityForAllocation } from '../services/allocationService.js'

// Mirrors SESSION_MARKETS in runEngineSession.ts -- kept as a separate copy
// rather than importing from there, since that file has no exports (it's a
// standalone `main()` script, same as this one) and refactoring it to share
// this constant wasn't asked for. Keep the two in sync if session market
// lists change.
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
const SESSION_ORDER = ['EUROPEAN', 'US', 'APAC'] as const

// Matches runEngineSession.ts's own MAX/MIN_MARKETS_PER_ANALYST exactly --
// duplicated for the same reason SESSION_MARKETS is (no shared module
// between these two standalone scripts today).
const MAX_MARKETS_PER_ANALYST = 11
const MIN_MARKETS_PER_ANALYST = 8

// Whole-day equivalent of runEngineSession.ts's workloadAdjustedScore(),
// scoped to the combined day's market/analyst totals instead of one
// session's. Same shape: below target, score is untouched; between target
// and hardCap, a 15%-per-market-over-target penalty; at or above hardCap,
// excluded (-1 sentinel).
function workloadAdjustedScore(
  baseScore: number,
  currentWorkload: number,
  totalMarkets: number,
  totalAnalysts: number,
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
  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const today = new Date().toISOString().slice(0, 10)

  console.log(`\n=== APIP Day-Start Coverage Preallocation ===`)
  console.log(`Date: ${today}`)
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE'}\n`)

  // ── Load analysts + today's availability (all sessions) ──────────────────
  const { data: analystRows } = await db.from('analysts')
    .select('analyst_id, display_name, active, sessions').eq('active', true)

  const { data: availabilityRows } = await db.from('analyst_availability')
    .select('analyst_id, session, available')
    .eq('date', today)

  const unavailableBySessionAnalyst = new Set(
    (availabilityRows ?? []).filter(a => !a.available).map(a => `${a.session}::${a.analyst_id}`)
  )

  // Session-eligible analysts per session (active + sessions[] membership + not
  // marked unavailable for that specific session -- opt-out model, same as
  // runEngineSession.ts: no availability row at all means available by default).
  const eligibleBySession = new Map<string, string[]>()
  for (const session of SESSION_ORDER) {
    const eligible = (analystRows ?? [])
      .filter(a => (a.sessions ?? []).includes(session))
      .filter(a => !unavailableBySessionAnalyst.has(`${session}::${a.analyst_id}`))
      .map(a => a.analyst_id)
    eligibleBySession.set(session, eligible)
  }
  const analystNameById = new Map((analystRows ?? []).map(a => [a.analyst_id, a.display_name]))
  const allEligibleToday = new Set([...eligibleBySession.values()].flat())
  console.log(`Analysts eligible for at least one session today: ${allEligibleToday.size}`)

  // ── Load all markets across all sessions ──────────────────────────────────
  const allSymbols = SESSION_ORDER.flatMap(s => SESSION_MARKETS[s]!)
  const { data: marketRows } = await db.from('markets')
    .select('market_id, symbol, asset_class').in('symbol', allSymbols)
  const marketBySymbol = new Map((marketRows ?? []).map(m => [m.symbol, m]))
  const totalMarkets = allSymbols.length
  console.log(`Markets across all sessions: ${totalMarkets} (${marketRows?.length ?? 0} resolved)`)

  // ── Load most recent regime per market -- yesterday's, since today's ─────
  // derive-regime run (04:33) hasn't happened yet at this script's 04:20 slot.
  // Same query shape as runEngineSession.ts (no session filter -- regime rows
  // are session-agnostic, one per market per day).
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data: regimeRows } = await db
    .from('market_regime_state')
    .select('market_id, trend_state, volatility_state, captured_at')
    .gte('captured_at', twoDaysAgo + 'T00:00:00Z')
    .is('session', null)
    .order('captured_at', { ascending: false })

  const regimeByMarketId = new Map<string, any>()
  for (const r of (regimeRows ?? [])) {
    if (!regimeByMarketId.has(r.market_id)) regimeByMarketId.set(r.market_id, r)
  }
  console.log(`Regime rows available (most recent = yesterday's): ${regimeByMarketId.size}`)

  // ── Load analyst profiles (all eligible analysts, joined with asset_class) ─
  const { data: profileRows } = await db
    .from('analyst_profiles')
    .select('analyst_id, market_id, direction, zone, profile_data, market:market_id ( asset_class )')
    .in('analyst_id', [...allEligibleToday])

  const profilesByAnalyst = new Map<string, AnalystProfileRow[]>()
  for (const p of (profileRows ?? []) as any[]) {
    const assetClass = p.market?.asset_class
    if (!assetClass) continue
    if (!profilesByAnalyst.has(p.analyst_id)) profilesByAnalyst.set(p.analyst_id, [])
    profilesByAnalyst.get(p.analyst_id)!.push({
      analyst_id: p.analyst_id, market_id: p.market_id, direction: p.direction,
      zone: p.zone, asset_class: assetClass, profile_data: p.profile_data,
    })
  }
  console.log(`Analyst profiles loaded: ${profileRows?.length ?? 0}`)

  // Regime-matched avg_r per (analyst, market, direction) -- used as the
  // expectedR proxy for the allocateCoverage() fallback pass below, since
  // there's no real recommendation (and therefore no real expected_r) at
  // this point in the day. Same "best regime-matched profile row" shape
  // runEngineSession.ts's own fallback path already uses for its
  // assignedAnalystId preference (profileScores there) -- reused here as
  // the score itself too, not just the preference, since this script has
  // nothing else to offer allocateCoverage().
  const profileScores = new Map<string, number>()
  for (const p of (profileRows ?? []) as any[]) {
    const regime = regimeByMarketId.get(p.market_id)
    const profileRegime = p.profile_data?.regime
    const isRegimeMatch = regime && profileRegime && profileRegime === regime.trend_state
    const avgR = (p.profile_data?.avg_r ?? 0) + (isRegimeMatch ? 0.1 : 0)
    const key = `${p.analyst_id}::${p.market_id}::${p.direction}`
    const existing = profileScores.get(key) ?? -Infinity
    if (avgR > existing) profileScores.set(key, avgR)
  }

  // ── Score + assign every market across every session, one combined pass ──
  const workload = new Map<string, number>()
  for (const id of allEligibleToday) workload.set(id, 0)

  type Assignment = { marketId: string; symbol: string; session: string; analystId: string }
  const assignments: Assignment[] = []

  // Markets with no eligible analyst-first pick (no profile match, or every
  // matched analyst already at the whole-day hard cap) -- deferred to a
  // single allocateCoverage() pass after the main loop, same two-tier
  // structure as runEngineSession.ts.
  type FallbackCandidate = { marketId: string; symbol: string; session: string }
  const fallbackCandidates: FallbackCandidate[] = []

  for (const session of SESSION_ORDER) {
    const sessionEligible = eligibleBySession.get(session) ?? []
    for (const symbol of SESSION_MARKETS[session]!) {
      const market = marketBySymbol.get(symbol)
      if (!market) { console.log(`  ${session}/${symbol}: not in markets table`); continue }
      if (sessionEligible.length === 0) { console.log(`  ${session}/${symbol}: no eligible analysts`); continue }

      const regime = regimeByMarketId.get(market.market_id)
      const trendState = regime?.trend_state ?? null
      const volatilityState = regime?.volatility_state ?? null

      const scored = sessionEligible.map(analystId => {
        const raw = scoreAnalystForMarket(
          analystId, market.market_id, market.asset_class, trendState, volatilityState, null,
          profilesByAnalyst.get(analystId) ?? [],
        )
        const currentWorkload = workload.get(analystId) ?? 0
        // Absolute avgR, matching runEngineSession.ts: a negative-edge analyst with
        // a real REGIME-tier match still has meaningful historical data and should
        // compete fairly rather than being penalised twice (once by confidence
        // already reflecting sample size/quality, again by a negative raw score).
        const baseValue = raw.confidence * Math.abs(raw.avgR) * raw.alignmentMultiplier
        const adjustedValue = raw.profileTier === 'NONE'
          ? -1
          : workloadAdjustedScore(baseValue, currentWorkload, totalMarkets, allEligibleToday.size)
        return { score: raw, adjustedValue }
      })

      const eligible = scored.filter(s => s.adjustedValue >= 0)
      const selected = eligible.sort((a, b) => {
        if (b.adjustedValue !== a.adjustedValue) return b.adjustedValue - a.adjustedValue
        const workloadA = workload.get(a.score.analystId) ?? 0
        const workloadB = workload.get(b.score.analystId) ?? 0
        return workloadA - workloadB
      })[0]

      if (selected) {
        const analystId = selected.score.analystId
        workload.set(analystId, (workload.get(analystId) ?? 0) + 1)
        assignments.push({ marketId: market.market_id, symbol, session, analystId })
        const name = analystNameById.get(analystId) ?? analystId
        console.log(`  ${session}/${symbol}: ${name} (${selected.score.profileTier}, avgR=${selected.score.avgR.toFixed(3)})`)
      } else {
        fallbackCandidates.push({ marketId: market.market_id, symbol, session })
        console.log(`  ${session}/${symbol}: no analyst-first pick -- deferred to fallback allocation`)
      }
    }
  }

  // ── Fallback allocation for markets with no analyst-first pick ───────────
  if (fallbackCandidates.length > 0) {
    const allocationInput: OpportunityForAllocation[] = fallbackCandidates.map(c => {
      const sessionEligible = eligibleBySession.get(c.session) ?? []
      let bestAnalystId: string | null = null
      let bestScore = -Infinity
      for (const analystId of sessionEligible) {
        const buyScore = profileScores.get(`${analystId}::${c.marketId}::BUY`) ?? -Infinity
        const sellScore = profileScores.get(`${analystId}::${c.marketId}::SELL`) ?? -Infinity
        const pScore = Math.max(buyScore, sellScore)
        if (pScore > bestScore) { bestScore = pScore; bestAnalystId = analystId }
      }
      return {
        opportunityId: randomUUID(),
        recommendationVersionId: randomUUID(),
        // No real expected_r exists this early -- the best regime-matched profile
        // avgR (or 0 if nothing matched at all) stands in for it. allocateCoverage()
        // only uses this for its own internal sort/scoring, never persisted anywhere.
        expectedR: bestScore > -Infinity ? bestScore : 0,
        assignedAnalystId: bestAnalystId,
        eligibleAnalysts: sessionEligible,
      }
    })

    const fallbackAllocations = allocateCoverage({
      opportunities: allocationInput,
      activeAnalysts: [...allEligibleToday],
      generateId: randomUUID,
      initialWorkload: workload,
    })

    const byOpportunityId = new Map(fallbackAllocations.map(a => [a.opportunityId, a]))
    for (let i = 0; i < fallbackCandidates.length; i++) {
      const candidate = fallbackCandidates[i]!
      const oppId = allocationInput[i]!.opportunityId
      const allocation = byOpportunityId.get(oppId)
      if (!allocation) continue
      assignments.push({
        marketId: candidate.marketId, symbol: candidate.symbol, session: candidate.session,
        analystId: allocation.assignedAnalystId,
      })
      const name = analystNameById.get(allocation.assignedAnalystId) ?? allocation.assignedAnalystId
      console.log(`  ${candidate.session}/${candidate.symbol}: ${name} (fallback allocation)`)
    }
  }

  console.log(`\nTotal assignments: ${assignments.length}/${totalMarkets}`)

  if (isDryRun) {
    console.log('\nDRY RUN -- nothing written.')
    return
  }

  const rows = assignments.map(a => ({
    date: today,
    analyst_id: a.analystId,
    market_id: a.marketId,
    session: a.session,
  }))

  const { error } = await db.from('daily_coverage_plan')
    .upsert(rows, { onConflict: 'date,market_id,session' })

  if (error) {
    console.error(`Write error: ${error.message}`)
    process.exit(1)
  }

  console.log(`\nDone. ${rows.length} coverage plan rows written for ${today}.`)
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
