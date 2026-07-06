// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Analyst Profile Generation Script
// ============================================================================
// Reads all actual_trades for each active analyst, computes profiles per
// market/direction/entry_zone combination, and writes to analyst_profiles.
//
// This is the authoritative source for allocation scoring -- not computed
// on the fly. Run after each new trade import or weekly via cron.
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
const MIN_PROFILE_TRADES = 5 // minimum trades to generate a profile row

type ProfileQuality = 'HIGH' | 'MEDIUM' | 'LOW'

function profileQuality(trades: number): ProfileQuality {
  if (trades >= HIGH_CONFIDENCE_MIN_TRADES) return 'HIGH'
  if (trades >= MEDIUM_CONFIDENCE_MIN_TRADES) return 'MEDIUM'
  return 'LOW'
}

interface TradeSummary {
  analyst_id: string
  symbol: string
  market_id: string
  direction: string
  entry_zone: string | null
  result_r: number
  triggered: boolean
}

interface ProfileRow {
  analyst_id: string
  market_id: string
  direction: string
  zone: string | null
  includes_historical_backfill: boolean
  profile_data: object
  generated_at: string
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
  const windowStart = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Load all active analysts
  const { data: analysts } = await db
    .from('analysts')
    .select('analyst_id, display_name')
    .eq('active', true)

  if (!analysts?.length) {
    console.error('No active analysts found')
    process.exit(1)
  }

  // Load market id -> symbol lookup
  const { data: markets } = await db
    .from('markets')
    .select('market_id, symbol')

  const symbolByMarketId = new Map((markets ?? []).map(m => [m.market_id, m.symbol]))

  // Paginate all trades
  const PAGE_SIZE = 1000
  const allTrades: TradeSummary[] = []
  let page = 0
  let hasMore = true

  process.stdout.write('Loading trades')
  while (hasMore) {
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, error } = await db
      .from('actual_trades')
      .select('analyst_id, market_id, direction, entry_zone, result_r, triggered')
      .gte('published_at', windowStart)
      .not('result_r', 'is', null)
      .range(from, to)

    if (error) { console.error(`\nPagination error: ${error.message}`); break }
    if (!data?.length) { hasMore = false } else {
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
        })
      }
      hasMore = data.length === PAGE_SIZE
      page++
      process.stdout.write('.')
    }
  }
  console.log(`\nLoaded ${allTrades.length} trades (${page} pages)\n`)

  // Build profiles per analyst
  const allProfileRows: ProfileRow[] = []
  let totalProfiles = 0

  for (const analyst of analysts) {
    const analystTrades = allTrades.filter(t => t.analyst_id === analyst.analyst_id)
    if (analystTrades.length === 0) {
      console.log(`  ${analyst.display_name}: no trades, skipping`)
      continue
    }

    // Group by market_id + direction + entry_zone
    const groups = new Map<string, TradeSummary[]>()
    for (const t of analystTrades) {
      const key = `${t.market_id}::${t.direction}::${t.entry_zone ?? 'NULL'}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(t)
    }

    // Also group by market_id + direction (zone-agnostic) for fallback profiles
    const marketDirGroups = new Map<string, TradeSummary[]>()
    for (const t of analystTrades) {
      const key = `${t.market_id}::${t.direction}`
      if (!marketDirGroups.has(key)) marketDirGroups.set(key, [])
      marketDirGroups.get(key)!.push(t)
    }

    const analystProfiles: ProfileRow[] = []

    // Zone-specific profiles
    for (const [key, trades] of groups) {
      if (trades.length < MIN_PROFILE_TRADES) continue
      const [market_id, direction, zoneKey] = key.split('::')
      const zone = zoneKey === 'NULL' ? null : zoneKey

      const wins = trades.filter(t => t.triggered && t.result_r > 0).length
      const triggered = trades.filter(t => t.triggered).length
      const avgR = trades.reduce((s, t) => s + t.result_r, 0) / trades.length
      const winRate = triggered > 0 ? wins / triggered : 0
      const triggerRate = trades.length > 0 ? triggered / trades.length : 0
      const quality = profileQuality(trades.length)

      analystProfiles.push({
        analyst_id: analyst.analyst_id,
        market_id: market_id!,
        direction: direction!,
        zone,
        includes_historical_backfill: true,
        profile_data: {
          trade_count: trades.length,
          avg_r: avgR,
          win_rate: winRate,
          trigger_rate: triggerRate,
          profile_quality: quality,
          // Per-zone breakdown for allocation scoring
          best_avg_r: avgR,
          has_zone_data: zone !== null,
        },
        generated_at: generatedAt,
      })
    }

    // Market+direction profiles (zone-agnostic, used as fallback in allocation)
    for (const [key, trades] of marketDirGroups) {
      if (trades.length < MIN_PROFILE_TRADES) continue
      const [market_id, direction] = key.split('::')

      const wins = trades.filter(t => t.triggered && t.result_r > 0).length
      const triggered = trades.filter(t => t.triggered).length
      const avgR = trades.reduce((s, t) => s + t.result_r, 0) / trades.length
      const winRate = triggered > 0 ? wins / triggered : 0
      const triggerRate = trades.length > 0 ? triggered / trades.length : 0
      const quality = profileQuality(trades.length)

      // Zone = null means this is the market-level (zone-agnostic) profile
      // Only add if we don't already have a zone=null entry for this market/direction
      const existing = analystProfiles.find(
        p => p.market_id === market_id && p.direction === direction && p.zone === null
      )
      if (!existing) {
        analystProfiles.push({
          analyst_id: analyst.analyst_id,
          market_id: market_id!,
          direction: direction!,
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
    }

    console.log(`  ${analyst.display_name}: ${analystProfiles.length} profiles from ${analystTrades.length} trades`)
    allProfileRows.push(...analystProfiles)
    totalProfiles += analystProfiles.length
  }

  console.log(`\nTotal profiles generated: ${totalProfiles}`)

  if (isDryRun) {
    console.log('\nDRY RUN -- nothing written.')
    return
  }

  // Delete existing profiles and replace with fresh set
  console.log('\nReplacing existing profiles...')
  const { error: deleteError } = await db
    .from('analyst_profiles')
    .delete()
    .not('profile_id', 'is', null) // delete all

  if (deleteError) {
    console.error('Delete error:', deleteError.message)
    process.exit(1)
  }

  // Insert in batches of 500
  const BATCH_SIZE = 500
  let inserted = 0
  for (let i = 0; i < allProfileRows.length; i += BATCH_SIZE) {
    const batch = allProfileRows.slice(i, i + BATCH_SIZE)
    const { error } = await db.from('analyst_profiles').insert(batch)
    if (error) {
      console.error(`Insert error on batch ${i}: ${error.message}`)
      process.exit(1)
    }
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
