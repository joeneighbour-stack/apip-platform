// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Analyst ATR Profile Generation Script
// ============================================================================
// Computes per-analyst stop/target ATR distributions from actual_trades
// joined to market_state_daily (there is no FK between the two -- the join
// is done in application code on market_id + published_at's date, matching
// the pattern already used elsewhere in this codebase, e.g. runEngineSession.ts's
// own bar lookups), grouped by analyst_id + direction + entry_zone.
//
// Written to analyst_atr_profiles (migrations/046_analyst_atr_profiles.sql),
// consumed by entryOptimizerService.ts (via analystAtrProfileService.ts /
// runEngineSession.ts's preloaded map) as the analyst-specific override for
// its team-wide DEFAULT_PROFILES fallback.
//
// Run:
//   npx tsx src/scripts/generateAtrProfiles.ts --dry-run
//   npx tsx src/scripts/generateAtrProfiles.ts
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const MIN_TRADE_COUNT = 10

// market_state_daily.zone (the source of actual_trades.entry_zone via
// backfillEntryZone.ts) is a placeholder artifact before this date -- same
// floor generateAnalystProfiles.ts uses (ZONE_VALID_FROM) and for the same
// reason: only from here does entry_zone show real differentiation rather
// than defaulting to ZONE_2 on ~99.8% of rows.
const WINDOW_START = '2026-01-01'

// Outlier filters on the computed ATR multiples themselves, not the raw
// prices -- a stop/target more than a few ATRs away from entry is either a
// data error (wrong entry/stop pairing, a stale/wrong atr14 for that day) or
// a genuinely exceptional trade that would badly distort a quartile computed
// from a small per-analyst sample.
const STOP_ATR_MIN = 0.1
const STOP_ATR_MAX = 3.0
const TARGET_ATR_MIN = 0.1
const TARGET_ATR_MAX = 5.0

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

// Linear-interpolation quantile (the standard/NumPy default method) -- values
// must already be sorted ascending.
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  if (sorted.length === 1) return sorted[0]!
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const lower = sorted[base]!
  const upper = sorted[base + 1]
  return upper === undefined ? lower : lower + rest * (upper - lower)
}

interface AtrSample {
  analystId: string
  direction: string
  zone: string
  stopAtr: number
  targetAtr: number
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
  console.log('Generating analyst ATR profiles from actual_trades + market_state_daily...\n')

  const generatedAt = new Date().toISOString()

  // Load candidate trades -- entry/stop/target/entry_zone all required, published
  // from WINDOW_START onward.
  const PAGE_SIZE = 1000
  const allTrades: any[] = []
  let page = 0, hasMore = true

  process.stdout.write('Loading trades')
  while (hasMore) {
    const { data, error } = await db.from('actual_trades')
      .select('analyst_id, market_id, direction, entry, stop, target, entry_zone, published_at')
      .gte('published_at', WINDOW_START)
      .not('entry', 'is', null)
      .not('stop', 'is', null)
      .not('target', 'is', null)
      .not('entry_zone', 'is', null)
      .order('published_at', { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) { console.error(`\nPagination error: ${error.message}`); break }
    if (!data?.length) { hasMore = false } else {
      allTrades.push(...data)
      hasMore = data.length === PAGE_SIZE
      page++
      process.stdout.write('.')
    }
  }
  console.log(`\nLoaded ${allTrades.length} candidate trades (${page} pages)`)

  // Load market_state_daily rows covering the same window, for the atr14 join.
  const marketIds = [...new Set(allTrades.map(t => t.market_id))]
  const allBars: any[] = []
  page = 0
  hasMore = marketIds.length > 0

  process.stdout.write('Loading daily bars')
  while (hasMore) {
    const { data, error } = await db.from('market_state_daily')
      .select('market_id, date, atr14')
      .gte('date', WINDOW_START)
      .in('market_id', marketIds)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) { console.error(`\nPagination error: ${error.message}`); break }
    if (!data?.length) { hasMore = false } else {
      allBars.push(...data)
      hasMore = data.length === PAGE_SIZE
      page++
      process.stdout.write('.')
    }
  }
  console.log(`\nLoaded ${allBars.length} daily bars\n`)

  const atr14ByMarketDate = new Map<string, number>()
  for (const b of allBars) {
    if (b.atr14 == null) continue
    const atr14 = Number(b.atr14)
    if (atr14 > 0) atr14ByMarketDate.set(`${b.market_id}::${b.date}`, atr14)
  }

  // Join + compute ATR multiples, applying all filters from the task spec.
  const samples: AtrSample[] = []
  let noAtr = 0, outlierStop = 0, outlierTarget = 0

  for (const t of allTrades) {
    const dateKey = String(t.published_at).slice(0, 10)
    const atr14 = atr14ByMarketDate.get(`${t.market_id}::${dateKey}`)
    if (atr14 === undefined) { noAtr++; continue }

    const entry = Number(t.entry)
    const stop = Number(t.stop)
    const target = Number(t.target)
    const stopAtr = Math.abs(stop - entry) / atr14
    const targetAtr = Math.abs(target - entry) / atr14

    if (stopAtr < STOP_ATR_MIN || stopAtr > STOP_ATR_MAX) { outlierStop++; continue }
    if (targetAtr < TARGET_ATR_MIN || targetAtr > TARGET_ATR_MAX) { outlierTarget++; continue }

    samples.push({
      analystId: t.analyst_id,
      direction: t.direction,
      zone: t.entry_zone,
      stopAtr, targetAtr,
    })
  }

  console.log(`Filtered: ${noAtr} no atr14 for that market/date, ${outlierStop} stop-ATR outliers, ${outlierTarget} target-ATR outliers`)
  console.log(`${samples.length} trades passed all filters (of ${allTrades.length} candidates)\n`)

  // Group by analyst_id + direction + zone.
  const groups = new Map<string, AtrSample[]>()
  for (const s of samples) {
    const key = `${s.analystId}::${s.direction}::${s.zone}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  }

  const { data: analysts } = await db.from('analysts').select('analyst_id, display_name')
  const nameById = new Map((analysts ?? []).map(a => [a.analyst_id, a.display_name]))

  const rows: any[] = []
  for (const [key, group] of groups.entries()) {
    if (group.length < MIN_TRADE_COUNT) continue
    const [analystId, direction, zone] = key.split('::') as [string, string, string]

    const stopSorted = group.map(g => g.stopAtr).sort((a, b) => a - b)
    const targetSorted = group.map(g => g.targetAtr).sort((a, b) => a - b)

    rows.push({
      analyst_id: analystId,
      direction,
      zone,
      trade_count: group.length,
      stop_atr_q25: round3(quantile(stopSorted, 0.25)),
      stop_atr_median: round3(quantile(stopSorted, 0.5)),
      stop_atr_q75: round3(quantile(stopSorted, 0.75)),
      target_atr_q25: round3(quantile(targetSorted, 0.25)),
      target_atr_median: round3(quantile(targetSorted, 0.5)),
      target_atr_q75: round3(quantile(targetSorted, 0.75)),
      generated_at: generatedAt,
    })

    console.log(`  ${nameById.get(analystId) ?? analystId} / ${direction} / ${zone}: ${group.length} trades, stop_median=${round3(quantile(stopSorted, 0.5))}, target_median=${round3(quantile(targetSorted, 0.5))}`)
  }

  console.log(`\nTotal profiles generated: ${rows.length} (of ${groups.size} groups seen, ${groups.size - rows.length} below the ${MIN_TRADE_COUNT}-trade minimum)`)

  if (isDryRun) {
    console.log('\nDRY RUN -- nothing written.')
    return
  }

  // Full delete-and-reinsert per run, same convention as generateAnalystProfiles.ts.
  console.log('\nReplacing existing ATR profiles...')
  const { error: delError } = await db
    .from('analyst_atr_profiles').delete().not('analyst_atr_profile_id', 'is', null)
  if (delError) { console.error('Delete error:', delError.message); process.exit(1) }

  const BATCH_SIZE = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await db.from('analyst_atr_profiles').insert(batch)
    if (error) { console.error(`Insert error on batch ${i}: ${error.message}`); process.exit(1) }
    inserted += batch.length
    process.stdout.write(`\rInserted ${inserted}/${rows.length}`)
  }

  console.log(`\n\nDone. ${inserted} ATR profiles written to analyst_atr_profiles.`)
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
