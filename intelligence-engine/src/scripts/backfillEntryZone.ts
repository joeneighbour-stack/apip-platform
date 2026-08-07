// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Backfill Entry Zone from market_state_daily
// ============================================================================
// For actual_trades rows with entry_zone IS NULL and result_r IS NOT NULL,
// looks up the market_state_daily row for the same market_id and calendar
// date as published_at, and copies its already-computed `zone` column onto
// entry_zone. No band recomputation here -- market_state_daily now stores
// zone directly (unlike when reconstructZonesFromDaily.ts was written,
// which derived it from high/low/atr14 itself).
//
// market_state_daily only covers 2024-07-20 onward (confirmed live), so
// trades published before that date will never find a match and are logged
// as skipped -- a genuine data-availability limit, not an error, matching
// the same boundary reconstructZonesFromDaily.ts documents.
//
// Idempotent: only ever selects actual_trades rows where entry_zone IS
// NULL, so a repeat run only touches whatever is still unbackfilled.
//
// Run:
//   npx tsx src/scripts/backfillEntryZone.ts --dry-run
//   npx tsx src/scripts/backfillEntryZone.ts
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const BATCH_SIZE = 500
const PAGE_SIZE = 1000

interface TradeRow {
  trade_id: string
  market_id: string
  published_at: string
}

interface DailyRow {
  market_id: string
  date: string
  zone: string
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
  console.log('Backfilling actual_trades.entry_zone from market_state_daily...\n')

  // ── Load candidate trades (paginated) ────────────────────────────────────
  console.log('Loading trades with entry_zone IS NULL and result_r IS NOT NULL...')
  const trades: TradeRow[] = []
  let page = 0, hasMore = true
  while (hasMore) {
    const { data, error } = await db
      .from('actual_trades')
      .select('trade_id, market_id, published_at')
      .is('entry_zone', null)
      .not('result_r', 'is', null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) { console.error(`\n  Pagination error: ${error.message}`); process.exit(1) }
    if (!data?.length) { hasMore = false } else {
      trades.push(...(data as TradeRow[]))
      hasMore = data.length === PAGE_SIZE
      page++
      process.stdout.write(`\r  Loaded ${trades.length} trades...`)
    }
  }
  console.log(`\n  Total: ${trades.length} trades to backfill`)

  if (trades.length === 0) {
    console.log('\nNothing to do -- no NULL entry_zone rows with a result_r.')
    return
  }

  // ── Load market_state_daily, indexed by market_id + date (paginated) ────
  console.log('\nLoading market_state_daily...')
  const dailyByMarketDate = new Map<string, Map<string, string>>()
  let dPage = 0, dHasMore = true, dailyCount = 0
  while (dHasMore) {
    const { data, error } = await db
      .from('market_state_daily')
      .select('market_id, date, zone')
      .not('zone', 'is', null)
      .range(dPage * PAGE_SIZE, dPage * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) { console.error(`\n  Pagination error: ${error.message}`); process.exit(1) }
    if (!data?.length) { dHasMore = false } else {
      for (const row of data as DailyRow[]) {
        if (!dailyByMarketDate.has(row.market_id)) dailyByMarketDate.set(row.market_id, new Map())
        dailyByMarketDate.get(row.market_id)!.set(row.date, row.zone)
      }
      dailyCount += data.length
      dHasMore = data.length === PAGE_SIZE
      dPage++
      process.stdout.write(`\r  Loaded ${dailyCount} daily rows...`)
    }
  }
  console.log(`\n  Total: ${dailyCount} daily rows across ${dailyByMarketDate.size} markets`)

  // ── Match trades to a daily zone ─────────────────────────────────────────
  const updates: { trade_id: string; entry_zone: string }[] = []
  let skippedNoDaily = 0

  for (const trade of trades) {
    const tradeDate = trade.published_at.slice(0, 10)
    const zone = dailyByMarketDate.get(trade.market_id)?.get(tradeDate)
    if (!zone) { skippedNoDaily++; continue }
    updates.push({ trade_id: trade.trade_id, entry_zone: zone })
  }

  console.log(`\nMatched: ${updates.length}, skipped (no matching daily state): ${skippedNoDaily}`)

  if (isDryRun) {
    console.log('\nDRY RUN -- nothing written.')
    return
  }

  if (updates.length === 0) {
    console.log('\nNothing to write.')
    return
  }

  // ── Write updates in batches of 500 ──────────────────────────────────────
  // Plain per-row UPDATE, not upsert -- upsert's INSERT path re-validates
  // NOT NULL columns (e.g. source_system) that a real UPDATE never touches.
  // Batches of 500 group progress reporting, matching this repo's existing
  // reconstructZonesFromDaily.ts pattern.
  console.log('\nWriting updates...')
  let updated = 0, errors = 0
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE)
    for (const u of batch) {
      const { error } = await db
        .from('actual_trades')
        .update({ entry_zone: u.entry_zone })
        .eq('trade_id', u.trade_id)
      if (error) {
        errors++
        console.error(`\n  Update error for trade ${u.trade_id}: ${error.message}`)
      } else {
        updated++
      }
    }
    process.stdout.write(`\r  Processed ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length}`)
  }
  console.log('')

  console.log('\n=== SUMMARY ===')
  console.log(`Trades updated:                  ${updated}`)
  console.log(`Trades skipped (no daily state): ${skippedNoDaily}`)
  console.log(`Errors:                          ${errors}`)
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
