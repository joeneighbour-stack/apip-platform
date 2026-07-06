// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Analyst Profile Generation Script
// ============================================================================
// Reads all actual_trades for each active analyst, computes profiles per
// market/direction/entry_zone combination, and writes to analyst_profiles.
//
// Trigger rate approximation (backfill only contains triggered trades):
//   trigger_rate = trade_count / estimated_publication_days
//
//   publication_days = working days (Mon-Fri) between first and last
//   trade date for that analyst/market combination.
//   APAC markets: Fridays excluded (APAC does not run Friday afternoons).
//
// Going forwards when live API data includes non-triggered opportunities:
//   trigger_rate = count(triggered=true) / count(all) -- no approximation needed.
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

function profileQuality(trades: number): ProfileQuality {
  if (trades >= HIGH_CONFIDENCE_MIN_TRADES) return 'HIGH'
  if (trades >= MEDIUM_CONFIDENCE_MIN_TRADES) return 'MEDIUM'
  return 'LOW'
}

// Fixed session-market mapping from coverage sheet
// APAC markets have Fridays excluded from publication day count
const APAC_MARKETS = new Set([
  'CHINA A50', 'ASX200', 'GBPAUD', 'NZDJPY',
  'NZDUSD', 'HS50', 'NIKKEI', 'EURAUD', 'GBPNZD',
])

// Count working days between two dates (inclusive)
// excludeFridays: true for APAC markets
function countPublicationDays(first: string, last: string, excludeFridays: boolean): number {
  const start = new Date(first + 'T12:00:00Z')
  const end = new Date(last + 'T12:00:00Z')
  if (start > end) return 0

  let count = 0
  const current = new Date(start)
  while (current <= end) {
    const day = current.getUTCDay()
    const isMon = day === 1
    const isTue = day === 2
    const isWed = day === 3
    const isThu = day === 4
    const isFri = day === 5
    if (excludeFridays) {
      if (isMon || isTue || isWed || isThu) count++
    } else {
      if (isMon || isTue || isWed || isThu || isFri) count++
    }
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
    .from('analysts')
    .select('analyst_id, display_name')
    .eq('active', true)

  if (!analysts?.length) { console.error('No active analysts found'); process.exit(1) }

  // Market id -> symbol lookup
  const { data: markets } = await db.from('markets').select('market_id, symbol')
  const symbolByMarketId = new Map((markets ?? []).map(m => [m.market_id, m.symbol]))

  // Paginate all trades -- include published_at for date range calculation
  const PAGE_SIZE = 1000
  const allTrades: TradeSummary[] = []
  let page = 0, hasMore = true

  process.stdout.write('Loading trades')
  while (hasMore) {
    const from = page * PAGE_SIZE
    const { data, error } = await db
      .from('actual_trades')
      .select('analyst_id, market_id, direction, entry_zone, result_r, triggered, published_at')
      .gte('published_at', windowStart)
      .not('result_r', 'is', null)
      .range(from, from + PAGE_SIZE - 1)

    if (error) { console.error(`\nPagination error: ${error.message}`); break }
    if (!data?.length) {
      hasMore = false
    } else {
      for (const t of data) {
        const symbol = symbolByMarketId.get(t.market_id)
        if (!symbol) continue
        allTrades.push({
          analyst_id: t.analyst_id,
          symbol,
          market_id: t.market_id,
          direction: t.direction,
          entry_zone: t.entry_zone ?? null,
          result_r: Number(t.result_r),
          triggered: t.triggered ?? false,
          published_at: t.published_at.slice(0, 10),
        })
      }
      hasMore = data.length === PAGE_SIZE
      page++
      process.stdout.write('.')
    }
  }
  console.log(`\nLoaded ${allTrades.length} trades (${page} pages)\n`)

  const allProfileRows: any[] = []
  let totalProfiles = 0

  for (const analyst of analysts) {
    const analystTrades = allTrades.filter(t => t.analyst_id === analyst.analyst_id)
    if (!analystTrades.length) {
      console.log(`  ${analyst.display_name}: no trades, skipping`)
      continue
    }

    // Group by market_id + direction + entry_zone (zone-specific profiles)
    const zoneGroups = new Map<string, TradeSummary[]>()
    const marketDirGroups = new Map<string, TradeSummary[]>()
    const marketGroups = new Map<string, TradeSummary[]>() // all trades per market regardless of direction/zone

    for (const t of analystTrades) {
      const zoneKey = `${t.market_id}::${t.direction}::${t.entry_zone ?? 'NULL'}`
      if (!zoneGroups.has(zoneKey)) zoneGroups.set(zoneKey, [])
      zoneGroups.get(zoneKey)!.push(t)

      const mdKey = `${t.market_id}::${t.direction}`
      if (!marketDirGroups.has(mdKey)) marketDirGroups.set(mdKey, [])
      marketDirGroups.get(mdKey)!.push(t)

      if (!marketGroups.has(t.market_id)) marketGroups.set(t.market_id, [])
      marketGroups.get(t.market_id)!.push(t)
    }

    // Compute trigger rate at MARKET level -- trigger rate is per market not per direction/zone
    // trigger_rate = total trades on market / publication days for that market
    const marketTriggerRates = new Map<string, number>()
    for (const [market_id, trades] of marketGroups) {
      const hasNonTriggered = trades.some(t => t.triggered === false)
      if (hasNonTriggered) {
        // Live data: direct calculation
        marketTriggerRates.set(market_id, trades.filter(t => t.triggered).length / trades.length)
      } else {
        // Backfill: trades / publication_days
        const dates = trades.map(t => t.published_at).sort()
        const first = dates[0]!
        const last = dates[dates.length - 1]!
        const isApac = APAC_MARKETS.has(trades[0]!.symbol)
        const pubDays = countPublicationDays(first, last, isApac)
        marketTriggerRates.set(market_id, pubDays > 0 ? Math.min(trades.length / pubDays, 1.0) : 0.5)
      }
    }

    const analystProfiles: any[] = []

    // Zone-specific profiles
    for (const [key, trades] of zoneGroups) {
      if (trades.length < MIN_PROFILE_TRADES) continue
      const [market_id, direction, zoneKey] = key.split('::')
      const zone = zoneKey === 'NULL' ? null : zoneKey

      const wins = trades.filter(t => t.result_r > 0).length
      const avgR = trades.reduce((s, t) => s + t.result_r, 0) / trades.length
      const winRate = wins / trades.length
      const triggerRate = marketTriggerRates.get(market_id!) ?? 0.5
      const quality = profileQuality(trades.length)

      analystProfiles.push({
        analyst_id: analyst.analyst_id,
        market_id,
        direction,
        zone,
        includes_historical_backfill: true,
        profile_data: {
          trade_count: trades.length,
          avg_r: avgR,
          win_rate: winRate,
          trigger_rate: triggerRate,
          profile_quality: quality,
          best_avg_r: avgR,
          has_zone_data: zone !== null,
          date_range: {
            first: trades.map(t => t.published_at).sort()[0],
            last: trades.map(t => t.published_at).sort().slice(-1)[0],
          },
        },
        generated_at: generatedAt,
      })
    }

    // Market+direction fallback profiles (zone=null)
    for (const [key, trades] of marketDirGroups) {
      if (trades.length < MIN_PROFILE_TRADES) continue
      const [market_id, direction] = key.split('::')

      const alreadyExists = analystProfiles.find(
        p => p.market_id === market_id && p.direction === direction && p.zone === null
      )
      if (alreadyExists) continue

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
          best_avg_r: avgR,
          has_zone_data: false,
        },
        generated_at: generatedAt,
      })
    }

    // Show trigger rates for key markets
    const keyMarkets = ['EURUSD', 'GBPUSD', 'Gold', 'NASDAQ', 'Oil']
    const keyRates = keyMarkets
      .map(sym => {
        const mid = [...marketGroups.keys()].find(id => {
          const trades = marketGroups.get(id)
          return trades?.[0]?.symbol === sym
        })
        if (!mid) return null
        const rate = marketTriggerRates.get(mid)
        return rate !== undefined ? `${sym}:${(rate * 100).toFixed(0)}%` : null
      })
      .filter(Boolean)
      .join(' ')

    console.log(`  ${analyst.display_name}: ${analystProfiles.length} profiles from ${analystTrades.length} trades | ${keyRates}`)

    allProfileRows.push(...analystProfiles)
    totalProfiles += analystProfiles.length
  }

  console.log(`\nTotal profiles generated: ${totalProfiles}`)

  if (isDryRun) {
    // Show trigger rate distribution
    const rates = allProfileRows.map(p => p.profile_data.trigger_rate)
    const avg = rates.reduce((s, r) => s + r, 0) / rates.length
    const below50 = rates.filter(r => r < 0.5).length
    const above80 = rates.filter(r => r >= 0.8).length
    console.log(`\nTrigger rate distribution:`)
    console.log(`  Average: ${(avg * 100).toFixed(1)}%`)
    console.log(`  Below 50%: ${below50} profiles`)
    console.log(`  Above 80%: ${above80} profiles`)
    console.log('\nDRY RUN -- nothing written.')
    return
  }

  // Replace all profiles
  console.log('\nReplacing existing profiles...')
  const { error: deleteError } = await db
    .from('analyst_profiles')
    .delete()
    .not('profile_id', 'is', null)

  if (deleteError) { console.error('Delete error:', deleteError.message); process.exit(1) }

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

// Debug: show per-market trigger rates for one analyst
// Remove before production
