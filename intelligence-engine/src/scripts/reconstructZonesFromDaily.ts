// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Reconstruct Historical Entry Zones from market_state_daily
// ============================================================================
// For backfill trades with null entry_zone, looks up the zone boundaries
// from market_state_daily on the trade's publication date and determines
// which zone the entry price fell in.
//
// Uses market_state_daily (available from 2024-07-20) -- cannot reconstruct
// trades before that date via this method.
//
// Run:
//   npx tsx src/scripts/reconstructZonesFromDaily.ts --dry-run
//   npx tsx src/scripts/reconstructZonesFromDaily.ts
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { AtrZone } from '../types/domain.js'

const ZONE_COUNT = 4
const DAILY_START = '2024-07-20'

function determineZone(
  entry: number,
  lowerBand: number,
  zone1Top: number,
  zone2Top: number,
  zone3Top: number,
  upperBand: number,
): AtrZone {
  if (entry < lowerBand) return 'TOO_DEEP'
  if (entry <= zone1Top) return 'ZONE_1'
  if (entry <= zone2Top) return 'ZONE_2'
  if (entry <= zone3Top) return 'ZONE_3'
  if (entry <= upperBand) return 'ZONE_4'
  return 'TOO_HIGH'
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars')
    process.exit(1)
  }

  const isDryRun = process.argv.includes('--dry-run')
  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log('Reconstructing entry zones from market_state_daily...\n')

  // ── Load trades with pagination ──────────────────────────────────────────
  console.log('Loading trades...')
  const trades: any[] = []
  let page = 0, hasMore = true
  while (hasMore) {
    const { data, error } = await db
      .from('actual_trades')
      .select('trade_id, market_id, entry, published_at')
      .eq('historical_backfill', true)
      .is('entry_zone', null)
      .not('entry', 'is', null)
      .gte('published_at', DAILY_START)
      .range(page * 1000, page * 1000 + 999)
    if (error) { console.error('Trade load error:', error.message); process.exit(1) }
    if (!data?.length) { hasMore = false } else {
      trades.push(...data)
      hasMore = data.length === 1000
      page++
      process.stdout.write(`\r  Loaded ${trades.length} trades...`)
    }
  }
  console.log(`\n  Total: ${trades.length} trades to reconstruct`)

  // ── Load market_state_daily with pagination ──────────────────────────────
  console.log('Loading market_state_daily...')
  const dailyRows: any[] = []
  page = 0; hasMore = true
  while (hasMore) {
    const { data } = await db
      .from('market_state_daily')
      .select('market_id, date, high, low, atr14')
      .gte('date', DAILY_START)
      .range(page * 1000, page * 1000 + 999)
    if (!data?.length) { hasMore = false } else {
      dailyRows.push(...data)
      hasMore = data.length === 1000
      page++
      process.stdout.write(`\r  Loaded ${dailyRows.length} daily rows...`)
    }
  }
  console.log(`\n  Total: ${dailyRows.length} daily rows`)

  // ── Index daily data by market_id + date ────────────────────────────────
  const dailyByMarketDate = new Map<string, Map<string, any>>()
  for (const row of dailyRows) {
    if (!dailyByMarketDate.has(row.market_id)) {
      dailyByMarketDate.set(row.market_id, new Map())
    }
    dailyByMarketDate.get(row.market_id)!.set(row.date, row)
  }

  // ── Reconstruct zones ────────────────────────────────────────────────────
  console.log('\nReconstructing zones...')
  const summary = { reconstructed: 0, noDaily: 0, noAtr: 0, errors: 0 }
  const updates: { trade_id: string; entry_zone: AtrZone }[] = []

  for (const trade of trades) {
    const tradeDate = trade.published_at.slice(0, 10)
    const marketDaily = dailyByMarketDate.get(trade.market_id)

    if (!marketDaily) {
      summary.noDaily++
      continue
    }

    // Try trade date, then look back up to 3 days for weekend/holiday gaps
    let dailyRow = marketDaily.get(tradeDate)
    if (!dailyRow) {
      for (let i = 1; i <= 3; i++) {
        const d = new Date(tradeDate + 'T12:00:00Z')
        d.setDate(d.getDate() - i)
        const prevDate = d.toISOString().slice(0, 10)
        dailyRow = marketDaily.get(prevDate)
        if (dailyRow) break
      }
    }

    if (!dailyRow) {
      summary.noDaily++
      continue
    }

    const atr = Number(dailyRow.atr14)
    if (!atr || atr <= 0) {
      summary.noAtr++
      continue
    }

    const high  = Number(dailyRow.high)
    const low   = Number(dailyRow.low)
    const entry = Number(trade.entry)

    // Pine Script band formula: upperBand = low + ATR, lowerBand = high - ATR
    const upperBand = low + atr
    const lowerBand = high - atr
    const bandWidth = upperBand - lowerBand
    const zoneSize  = bandWidth / ZONE_COUNT

    const zone1Top = lowerBand + zoneSize
    const zone2Top = lowerBand + 2 * zoneSize
    const zone3Top = lowerBand + 3 * zoneSize

    const zone = determineZone(entry, lowerBand, zone1Top, zone2Top, zone3Top, upperBand)
    updates.push({ trade_id: trade.trade_id, entry_zone: zone })
  }

  console.log(`\nReconstructed zones for ${updates.length} of ${trades.length} trades`)
  console.log(`No daily data: ${summary.noDaily}`)
  console.log(`No ATR: ${summary.noAtr}`)

  // Zone distribution
  const zoneCounts: Record<string, number> = {}
  for (const u of updates) {
    zoneCounts[u.entry_zone] = (zoneCounts[u.entry_zone] ?? 0) + 1
  }
  console.log('\nZone distribution:')
  for (const [zone, count] of Object.entries(zoneCounts).sort()) {
    console.log(`  ${zone}: ${count}`)
  }

  if (!isDryRun && updates.length > 0) {
    console.log('\nWriting updates...')
    const BATCH_SIZE = 500
    let written = 0
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE)
      for (const u of batch) {
        const { error } = await db
          .from('actual_trades')
          .update({ entry_zone: u.entry_zone })
          .eq('trade_id', u.trade_id)
        if (error) summary.errors++
        else summary.reconstructed++
      }
      written += batch.length
      process.stdout.write(`\r  Updated ${written}/${updates.length}`)
    }
    console.log('')
  } else {
    summary.reconstructed = updates.length
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Reconstructed: ${summary.reconstructed}`)
  console.log(`No daily data: ${summary.noDaily}`)
  console.log(`No ATR:        ${summary.noAtr}`)
  console.log(`Errors:        ${summary.errors}`)
  if (isDryRun) console.log('\nDRY RUN -- nothing written.')
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
