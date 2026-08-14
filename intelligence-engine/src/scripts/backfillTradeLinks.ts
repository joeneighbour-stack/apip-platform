// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Backfill Trade Links — retroactively link unlinked API trades to
// opportunities/recommendation_versions
// ============================================================================
// importActualTrades.ts links new trades to recommendation_versions at import time
// by matching each trade's analyst against a coaching_recommendation shown within a
// 4-hour window before the trade's published_at, then verifying market/direction
// against that recommendation's opportunity. That window-based match can miss trades
// (e.g. shown_at drift, a trade published outside the 4-hour window) and once missed,
// those trades stay unlinked forever -- nothing re-attempts them.
//
// This script is a coarser, one-off catch-up pass for those leftovers: same-day
// matching on analyst + market alone (via the opportunity, then that opportunity's
// coaching_recommendation for the trade's analyst), no time-window requirement.
// Coarser also means less precise -- a market only ever belongs to one session per
// day (see SESSION_MARKETS in runEngineSession.ts, the three session market lists
// are disjoint), so date + market_id is already close to unique among opportunities
// without needing session in the match.
//
// Deliberately NOT matched on direction: an analyst trading the opposite direction
// to the coaching recommendation is exactly the case worth linking, not excluding --
// those are the most valuable reviews, since they show where an analyst diverged
// from coaching and how that played out. direction_alignment is scored afterwards
// in generatePostTradeReviews.ts by comparing the linked opportunity's direction
// against the trade's own, not decided here by whether a row matched at all.
//
// Scoped to trades from 2026-07-13 onwards -- opportunities/coaching_recommendations
// only exist from when the live platform pipeline started producing them; nothing
// before that date has anything real to link to.
//
// Usage:
//   npx tsx src/scripts/backfillTradeLinks.ts --dry-run
//   npx tsx src/scripts/backfillTradeLinks.ts
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const BACKFILL_START_DATE = '2026-07-13T00:00:00Z'
const PROGRESS_INTERVAL = 100

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

  console.log(`\n=== Backfill Trade Links ===`)
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(`From: ${BACKFILL_START_DATE}\n`)

  const { data: unlinkedTrades, error: fetchError } = await db
    .from('actual_trades')
    .select('trade_id, analyst_id, market_id, direction, published_at')
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .is('opportunity_id', null)
    .gte('published_at', BACKFILL_START_DATE)
    .order('published_at', { ascending: true })

  if (fetchError) {
    console.error(`Failed to load unlinked trades: ${fetchError.message}`)
    process.exit(1)
  }

  const trades = unlinkedTrades ?? []
  console.log(`Unlinked trades found: ${trades.length}\n`)

  let linked = 0
  let noOpportunity = 0
  let noCoaching = 0

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i]!
    const tradeDate = trade.published_at.slice(0, 10)

    // Find the opportunity for the same date + market (any session, any direction --
    // see the module comment on why neither is needed in this match).
    const { data: opp } = await db
      .from('opportunities')
      .select('opportunity_id')
      .eq('date', tradeDate)
      .eq('market_id', trade.market_id)
      .limit(1)
      .single()

    if (!opp) {
      noOpportunity++
    } else {
      // Find the coaching recommendation for this opportunity + analyst.
      const { data: coaching } = await db
        .from('coaching_recommendations')
        .select('recommendation_id, active_recommendation_version_id')
        .eq('opportunity_id', opp.opportunity_id)
        .eq('analyst_id', trade.analyst_id)
        .limit(1)
        .single()

      if (!coaching) {
        noCoaching++
      } else {
        if (!isDryRun) {
          const { error: updateError } = await db
            .from('actual_trades')
            .update({
              opportunity_id: opp.opportunity_id,
              recommendation_version_id: coaching.active_recommendation_version_id,
            })
            .eq('trade_id', trade.trade_id)

          if (updateError) {
            console.error(`  ${trade.trade_id}: update failed -- ${updateError.message}`)
          } else {
            linked++
          }
        } else {
          linked++
        }
      }
    }

    if ((i + 1) % PROGRESS_INTERVAL === 0) {
      console.log(`  Processed ${i + 1}/${trades.length} (${linked} linked so far)`)
    }
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`Trades checked:      ${trades.length}`)
  console.log(`Linked:              ${linked}`)
  console.log(`No matching opportunity: ${noOpportunity}`)
  console.log(`No matching coaching:    ${noCoaching}`)
  if (isDryRun) console.log('\nDRY RUN -- nothing written.')
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
