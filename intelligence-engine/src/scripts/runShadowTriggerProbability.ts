// ============================================================================
// APIP Shadow Trade Trigger Probability Calculator
// ============================================================================
// Reads accumulated shadow_trade_outcomes and computes real trigger
// probabilities per market/direction. Updates analyst_profiles.profile_data
// so the engine uses real shadow-based rates instead of the publication-day
// approximation.
//
// Minimum sample: 20 resolved outcomes per market/direction before the
// shadow rate replaces the profile approximation.
//
// Run weekly via GitHub Actions once outcomes accumulate.
// Add to engine-daily.yml: Monday 05:45 UTC after generate-profiles.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const MIN_SHADOW_SAMPLE = 20

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars'); process.exit(1)
  }

  const isDryRun = process.argv.includes('--dry-run')
  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log('Computing shadow-based trigger probabilities...\n')

  // Load all resolved shadow outcomes with market/direction context
  const { data: outcomes, error } = await db
    .from('shadow_trade_outcomes')
    .select(`
      trade_outcome_status,
      shadow_trade:shadow_trade_id (
        opportunity:opportunity_id (
          market_id,
          direction
        )
      )
    `)
    .in('trade_outcome_status', ['TRIGGERED', 'TARGET_HIT', 'STOP_HIT', 'EXPIRY'])

  if (error) { console.error('Failed to load outcomes:', error.message); process.exit(1) }
  if (!outcomes?.length) {
    console.log('No resolved shadow outcomes yet. Run again once more outcomes accumulate.')
    console.log(`Current minimum sample required: ${MIN_SHADOW_SAMPLE} per market/direction`)
    return
  }

  console.log(`Resolved outcomes loaded: ${outcomes.length}`)

  // Group by market_id + direction
  const groups = new Map<string, { triggered: number; total: number; market_id: string; direction: string }>()

  for (const o of outcomes) {
    const st = o.shadow_trade as any
    const opp = st?.opportunity as any
    if (!opp?.market_id || !opp?.direction) continue

    const key = `${opp.market_id}::${opp.direction}`
    const existing = groups.get(key) ?? { triggered: 0, total: 0, market_id: opp.market_id, direction: opp.direction }
    const wasTriggered = ['TRIGGERED', 'TARGET_HIT', 'STOP_HIT'].includes(o.trade_outcome_status)
    groups.set(key, {
      ...existing,
      triggered: existing.triggered + (wasTriggered ? 1 : 0),
      total: existing.total + 1,
    })
  }

  console.log(`\nMarket/direction groups found: ${groups.size}`)
  console.log(`Groups with >= ${MIN_SHADOW_SAMPLE} outcomes:`)

  const qualifyingGroups = [...groups.values()].filter(g => g.total >= MIN_SHADOW_SAMPLE)

  if (qualifyingGroups.length === 0) {
    console.log(`  None yet — need at least ${MIN_SHADOW_SAMPLE} outcomes per group.`)
    console.log('\nCurrent counts:')
    for (const g of [...groups.values()].sort((a, b) => b.total - a.total).slice(0, 10)) {
      console.log(`  ${g.market_id} ${g.direction}: ${g.total} outcomes`)
    }
    return
  }

  let updated = 0

  for (const g of qualifyingGroups) {
    const triggerRate = g.triggered / g.total
    console.log(`  ${g.market_id} ${g.direction}: ${g.triggered}/${g.total} = ${Math.round(triggerRate * 100)}% triggered`)

    if (isDryRun) continue

    // Load all analyst_profiles for this market/direction
    const { data: profiles } = await db
      .from('analyst_profiles')
      .select('profile_id, profile_data')
      .eq('market_id', g.market_id)
      .eq('direction', g.direction)

    if (!profiles?.length) continue

    // Update each profile's trigger_rate with the shadow-based rate
    for (const profile of profiles) {
      const updatedProfileData = {
        ...profile.profile_data,
        trigger_rate: triggerRate,
        trigger_rate_source: 'shadow_outcomes',
        trigger_rate_sample: g.total,
      }

      await db.from('analyst_profiles')
        .update({ profile_data: updatedProfileData })
        .eq('profile_id', profile.profile_id)

      updated++
    }
  }

  console.log(`\nProfiles updated: ${updated}`)
  if (isDryRun) console.log('DRY RUN -- nothing written.')
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
