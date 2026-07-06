// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Analyst Profile Generation Script
// ============================================================================
// Reads all actual_trades for each active analyst, computes profiles per
// market/direction/regime combination, and writes to analyst_profiles.
//
// Each profile row represents one analyst's historical performance in a
// specific market, direction, and market regime (TRENDING_UP/DOWN/RANGE/MIXED).
// This enables the engine to:
//   1. Select the best direction for a market given current regime
//   2. Allocate the best analyst for a market given current regime
//   3. Set realistic trigger probabilities per regime
//
// Trigger rate approximation (backfill only contains triggered trades):
//   trigger_rate = trade_count / estimated_publication_days
//   APAC markets: Fridays excluded (APAC does not run Friday afternoons)
//
// Run:
//   npx tsx src/scripts/generateAnalystProfiles.ts --dry-run
//   npx tsx src/scripts/generateAnalystProfiles.ts
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HIGH_CONFIDENCE_MIN_TRADES = 50
const MEDIUM_CONFIDENCE_MIN_TRADES = 20
const MIN_PROFILE_TRADES = 5

type ProfileQuality = 'HIGH' | 'MEDIUM' | 'LOW'
type TrendState = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGE' | 'MIXED'

function profileQuality(trades: number): ProfileQuality {
  if (trades >= HIGH_CONFIDENCE_MIN_TRADES) return 'HIGH'
  if (trades >= MEDIUM_CONFIDENCE_MIN_TRADES) return 'MEDIUM'
  return 'LOW'
}

const APAC_MARKETS = new Set([
  'CHINA A50', 'ASX200', 'GBPAUD', 'NZDJPY',
  'NZDUSD', 'HS50', 'NIKKEI', 'EURAUD', 'GBPNZD',
])

function countPublicationDays(first: string, last: string, excludeFridays: boolean): number {
  const start = new Date(first + 'T12:00:00Z')
  const end = new Date(last + 'T12:00:00Z')
  if (start > end) return 0
  let count = 0
  const current = new Date(start)
  while (current <= end) {
    const day = current.getUTCDay()
    if (excludeFridays ? [1,2,3,4].includes(day) : [1,2,3,4,5].includes(day)) count++
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return count
}

interface TradeSummary {
  analyst_id: string
  symbol: string
  market_id: string
  direction: string
  entry_zone: string | null
  result_r: number
  triggered: boolean
  published_at: string
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

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log('Generating analyst profiles from actual_trades...\n')

  const generatedAt = new Date().toISOString()
  const windowStart = new Date(Date.now() - 2.5 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Load active analysts
  const { data: analysts } = await db
    .from('analysts').select('analyst_id, display_name').eq('active', true)
  if (!analysts?.length) { console.error('No active analysts found'); process.exit(1) }

  // Market id -> symbol lookup
  const { data: markets } = await db.from('markets').select('market_id, symbol')
  const symbolByMarketId = new Map((markets ?? []).map(m => [m.market_id, m.symbol]))

  // Load regime states -- one row per market per date
  // We'll look up the regime for each trade date
  process.stdout.write('Loading regime states')
  const allRegimes: any[] = []
  let rPage = 0, rHasMore = true
  while (rHasMore) {
    const { data } = await db.from('market_regime_state')
      .select('market_id, captured_at, trend_state')
      .gte('captured_at', windowStart)
      .order('captured_at', { ascending: true })
      .range(rPage * 1000, rPage * 1000 + 999)
    if (!data?.length) { rHasMore = false } else {
      allRegimes.push(...data)
      rHasMore = data.length === 1000
      rPage++
      process.stdout.write('.')
    }
  }
  console.log(` ${allRegimes.length} rows`)

  // Build regime lookup: market_id -> date -> trend_state
  const regimeByMarketDate = new Map<string, Map<string, TrendState>>()
  for (const r of allRegimes) {
    const date = r.captured_at.slice(0, 10)
    if (!regimeByMarketDate.has(r.market_id)) regimeByMarketDate.set(r.market_id, new Map())
    regimeByMarketDate.get(r.market_id)!.set(date, r.trend_state as TrendState)
  }

  // Paginate all trades
  const PAGE_SIZE = 1000
  const allTrades: TradeSummary[] = []
  let page = 0, hasMore = true

  process.stdout.write('Loading trades')
  while (hasMore) {
    const { data, error } = await db.from('actual_trades')
      .select('analyst_id, market_id, direction, entry_zone, result_r, triggered, published_at')
      .gte('published_at', windowStart)
      .not('result_r', 'is', null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) { console.error(`\nPagination error: ${error.message}`); break }
    if (!data?.length) { hasMore = false } else {
      for (const t of data) {
        const symbol = symbolByMarketId.get(t.market_id)
        if (!symbol) continue
        allTrades.push({
          analyst_id: t.analyst_id, symbol, market_id: t.market_id,
          direction: t.direction, entry_zone: t.entry_zone ?? null,
          result_r: Number(t.result_r), triggered: t.triggered ?? false,
          published_at: t.published_at.slice(0, 10),
        })
      }
      hasMore = data.length === PAGE_SIZE
      page++
      process.stdout.write('.')
    }
  }
  console.log(`\nLoaded ${allTrades.length} trades (${page} pages)\n`)

  // Enrich trades with regime
  let withRegime = 0, withoutRegime = 0
  const enrichedTrades = allTrades.map(t => {
    const regime = regimeByMarketDate.get(t.market_id)?.get(t.published_at) ?? null
    if (regime) withRegime++; else withoutRegime++
    return { ...t, regime }
  })
  console.log(`  Trades with regime: ${withRegime}, without: ${withoutRegime}`)

  const allProfileRows: any[] = []
  let totalProfiles = 0

  for (const analyst of analysts) {
    const analystTrades = enrichedTrades.filter(t => t.analyst_id === analyst.analyst_id)
    if (!analystTrades.length) {
      console.log(`  ${analyst.display_name}: no trades, skipping`)
      continue
    }

    // Compute market-level trigger rates (direction/regime agnostic denominator)
    const marketGroups = new Map<string, typeof analystTrades>()
    for (const t of analystTrades) {
      if (!marketGroups.has(t.market_id)) marketGroups.set(t.market_id, [])
      marketGroups.get(t.market_id)!.push(t)
    }

    const marketTriggerRates = new Map<string, number>()
    for (const [market_id, trades] of marketGroups) {
      const hasNonTriggered = trades.some(t => t.triggered === false)
      if (hasNonTriggered) {
        marketTriggerRates.set(market_id, trades.filter(t => t.triggered).length / trades.length)
      } else {
        const dates = trades.map(t => t.published_at).sort()
        const isApac = APAC_MARKETS.has(trades[0]!.symbol)
        const pubDays = countPublicationDays(dates[0]!, dates[dates.length - 1]!, isApac)
        marketTriggerRates.set(market_id, pubDays > 0 ? Math.min(trades.length / pubDays, 1.0) : 0.5)
      }
    }

    // Group by market + direction + regime
    const regimeGroups = new Map<string, typeof analystTrades>()
    // Also group by market + direction (regime-agnostic fallback)
    const marketDirGroups = new Map<string, typeof analystTrades>()

    for (const t of analystTrades) {
      // Only group into regime-specific profiles if we have actual regime data
      if (t.regime && t.regime !== 'UNKNOWN') {
        const regimeKey = `${t.market_id}::${t.direction}::${t.regime}`
        if (!regimeGroups.has(regimeKey)) regimeGroups.set(regimeKey, [])
        regimeGroups.get(regimeKey)!.push(t)
      }

      // Always add to fallback group
      const mdKey = `${t.market_id}::${t.direction}`
      if (!marketDirGroups.has(mdKey)) marketDirGroups.set(mdKey, [])
      marketDirGroups.get(mdKey)!.push(t)
    }

    const analystProfiles: any[] = []

    // Regime-specific profiles
    for (const [key, trades] of regimeGroups) {
      if (trades.length < MIN_PROFILE_TRADES) continue
      const [market_id, direction, regime] = key.split('::')

      const wins = trades.filter(t => t.result_r > 0).length
      const avgR = trades.reduce((s, t) => s + t.result_r, 0) / trades.length
      const winRate = wins / trades.length
      const triggerRate = marketTriggerRates.get(market_id!) ?? 0.5
      const quality = profileQuality(trades.length)

      analystProfiles.push({
        analyst_id: analyst.analyst_id,
        market_id,
        direction,
        zone: null,
        includes_historical_backfill: true,
        profile_data: {
          trade_count: trades.length,
          avg_r: avgR,
          win_rate: winRate,
          trigger_rate: triggerRate,
          profile_quality: quality,
          regime: regime === 'UNKNOWN' ? null : regime,
          has_regime_data: regime !== 'UNKNOWN',
        },
        generated_at: generatedAt,
      })
    }

    // Regime-agnostic fallback profiles (for markets with no regime data)
    for (const [key, trades] of marketDirGroups) {
      if (trades.length < MIN_PROFILE_TRADES) continue
      const [market_id, direction] = key.split('::')

      // Only add fallback if no regime-specific profiles exist for this market/direction
      const hasRegimeProfiles = analystProfiles.some(
        p => p.market_id === market_id && p.direction === direction &&
          p.profile_data.regime !== null && p.profile_data.has_regime_data === true
      )
      if (hasRegimeProfiles) continue // regime profiles exist, skip fallback

      const wins = trades.filter(t => t.result_r > 0).length
      const avgR = trades.reduce((s, t) => s + t.result_r, 0) / trades.length
      const winRate = wins / trades.length
      const triggerRate = marketTriggerRates.get(market_id!) ?? 0.5
      const quality = profileQuality(trades.length)

      analystProfiles.push({
        analyst_id: analyst.analyst_id,
        market_id,
        direction,
        zone: null,
        includes_historical_backfill: true,
        profile_data: {
          trade_count: trades.length,
          avg_r: avgR,
          win_rate: winRate,
          trigger_rate: triggerRate,
          profile_quality: quality,
          regime: null,
          has_regime_data: false,
        },
        generated_at: generatedAt,
      })
    }

    // Show regime breakdown for key markets
    const eurusdProfiles = analystProfiles.filter(p => {
      const sym = symbolByMarketId.get(p.market_id)
      return sym === 'EURUSD'
    })
    const regimeSummary = eurusdProfiles.length > 0
      ? eurusdProfiles.map(p => `${p.direction}/${p.profile_data.regime ?? 'no-regime'}(${p.profile_data.trade_count})`).join(' ')
      : 'no EURUSD'

    console.log(`  ${analyst.display_name}: ${analystProfiles.length} profiles from ${analystTrades.length} trades | EURUSD: ${regimeSummary}`)

    allProfileRows.push(...analystProfiles)
    totalProfiles += analystProfiles.length
  }

  console.log(`\nTotal profiles generated: ${totalProfiles}`)

  if (isDryRun) {
    console.log('\nDRY RUN -- nothing written.')
    return
  }

  // Replace all profiles
  console.log('\nReplacing existing profiles...')
  const { error: delError } = await db
    .from('analyst_profiles').delete().not('profile_id', 'is', null)
  if (delError) { console.error('Delete error:', delError.message); process.exit(1) }

  const BATCH_SIZE = 500
  let inserted = 0
  for (let i = 0; i < allProfileRows.length; i += BATCH_SIZE) {
    const batch = allProfileRows.slice(i, i + BATCH_SIZE)
    const { error } = await db.from('analyst_profiles').insert(batch)
    if (error) { console.error(`Insert error on batch ${i}: ${error.message}`); process.exit(1) }
    inserted += batch.length
    process.stdout.write(`\rInserted ${inserted}/${allProfileRows.length}`)
  }

  console.log(`\n\nDone. ${inserted} profiles written to analyst_profiles.`)
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
