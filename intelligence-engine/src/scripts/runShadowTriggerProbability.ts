// ============================================================================
// APIP Shadow Trade Trigger Probability Calculator
// ============================================================================
// Reads accumulated shadow_trade_outcomes and computes real trigger
// probabilities per market/direction/zone. Writes to analyst_profiles
// so the engine uses real rates instead of publication-day approximation.
//
// Run weekly once enough outcomes accumulate (target: 50+ per market).
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const MIN_SHADOW_SAMPLE = 20 // minimum outcomes before trusting the rate

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars'); process.exit(1)
  }

  const isDryRun = process.argv.includes('--dry-run')
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log('Computing shadow-based trigger probabilities...\n')

  // Load all resolved shadow outcomes joined to opportunity/market
  const { data: outcomes } = await db
    .from('shadow_trade_outcomes')
    .select(`
      trade_outcome_status,
      shadow_trade:shadow_trade_id (
        opportunity:opportunity_id (
          market_id, direction,
          current_zone
        )
      )
    `)
    .in('trade_outcome_status', ['TRIGGERED', 'TARGET_HIT', 'STOP_HIT', 'EXPIRY'])

  if (!outcomes?.length) {
    console.log('No resolved shadow outcomes yet. Need more accumulation.')
    return
  }

  console.log(`Resolved outcomes: ${outcomes.length}`)

  // Group by market_id + direction + zone
  const groups = new Map<string, { triggered: number; total: number }>()
  for (const o of outcomes) {
    const st = o.shadow_trade as any
    const opp = st?.opportunity as any
    if (!opp?.market_id) continue
    const key = `${opp.market_id}::${opp.direction}::${opp.current_zone ?? 'NULL'}`
    const existing = groups.get(key) ?? { triggered: 0, total: 0 }
    const wasTriggered = ['TRIGGERED', 'TARGET_HIT', 'STOP_HIT'].includes(o.trade_outcome_status)
    groups.set(key, {
      triggered: existing.triggered + (wasTriggered ? 1 : 0),
      total: existing.total + 1,
    })
  }

  let updated = 0
  for (const [key, { triggered, total }] of groups) {
    if (total < MIN_SHADOW_SAMPLE) continue
    const [market_id, direction] = key.split('::')
    const triggerRate = triggered / total

    console.log(`  ${market_id} ${direction}: ${triggered}/${total} = ${Math.round(triggerRate * 100)}%`)

    if (!isDryRun) {
      // Update matching analyst_profiles rows for this market/direction
      await db.from('analyst_profiles')
        .update({
          profile_data: db.rpc('jsonb_set_trigger_rate', {
            p_market_id: market_id,
            p_direction: direction,
            p_trigger_rate: triggerRate,
          })
        })
        .eq('market_id', market_id!)
        .eq('direction', direction!)
      updated++
    }
  }

  console.log(`\nMarket/direction pairs updated: ${updated}`)
  if (isDryRun) console.log('DRY RUN -- nothing written.')
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
