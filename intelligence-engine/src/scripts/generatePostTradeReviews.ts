// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Post-Trade Review Generator
// ============================================================================
// Generates post_trade_reviews for actual_trades that have a linked
// recommendation_version_id. Scores direction and entry alignment against
// the coaching recommendation shown before the trade.
//
// Alignment scoring:
//   Direction: 50 pts if trade direction matches coaching direction
//   Entry:     0-50 pts based on how close entry is to suggested range
//     - Within range:          50 pts
//     - Within 0.5 ATR:        35 pts
//     - Within 1.0 ATR:        20 pts
//     - Beyond 1.0 ATR:         0 pts
//
// Run:
//   npx tsx src/scripts/generatePostTradeReviews.ts --dry-run
//   npx tsx src/scripts/generatePostTradeReviews.ts
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

function scoreDirectionAlignment(tradeDir: string, coachingDir: string): {
  alignment: string
  score: number
} {
  const match = tradeDir.toUpperCase() === coachingDir.toUpperCase()
  return {
    alignment: match ? 'Aligned' : 'Different',
    score: match ? 1 : 0,
  }
}

function scoreEntryAlignment(
  tradeEntry: number,
  rangeLow: number,
  rangeHigh: number,
  atr14: number | null
): { alignment: string; score: number } {
  // Within the suggested range
  if (tradeEntry >= rangeLow && tradeEntry <= rangeHigh) {
    return { alignment: 'High', score: 1 }
  }

  if (!atr14 || atr14 === 0) {
    return { alignment: 'Low', score: 0 }
  }

  // Distance from nearest range boundary in ATR units
  const distancePts = tradeEntry < rangeLow
    ? rangeLow - tradeEntry
    : tradeEntry - rangeHigh
  const distanceAtr = distancePts / atr14

  if (distanceAtr <= 0.5) return { alignment: 'High', score: 1 }
  if (distanceAtr <= 1.0) return { alignment: 'Low', score: 0 }
  return { alignment: 'Low', score: 0 }
}

function generateReviewText(
  symbol: string,
  tradeDir: string,
  coachingDir: string,
  directionAlignment: string,
  entryAlignment: string,
  tradeEntry: number,
  rangeLow: number,
  rangeHigh: number,
  alignmentScore: number,
  triggered: boolean,
  resultR: number | null
): string {
  const lines: string[] = []

  // Direction -- factual only
  if (directionAlignment === 'Aligned') {
    lines.push(`Direction aligned with coaching: ${symbol} ${tradeDir} matches the suggested ${coachingDir} setup.`)
  } else {
    lines.push(`Direction diverged from coaching: ${symbol} ${tradeDir} taken; coaching suggested ${coachingDir}.`)
  }

  // Entry -- factual only
  const entryFmt = tradeEntry.toFixed(4)
  const rangeFmt = `${rangeLow.toFixed(4)}–${rangeHigh.toFixed(4)}`
  if (entryAlignment === 'High') {
    lines.push(`Entry ${entryFmt} was within or near the suggested range (${rangeFmt}).`)
  } else {
    lines.push(`Entry ${entryFmt} was outside the suggested range (${rangeFmt}).`)
  }

  // Outcome -- factual
  if (!triggered) {
    lines.push('Trade did not trigger.')
  } else if (resultR !== null) {
    lines.push(`Trade closed at ${resultR > 0 ? '+' : ''}${resultR.toFixed(2)}R.`)
  } else {
    lines.push('Trade triggered — outcome pending.')
  }

  // Score -- process adherence only
  lines.push(`Process alignment score: ${alignmentScore}/2 (direction + entry range adherence).`)

  return lines.join(' ')
}

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
  console.log('Generating post-trade reviews...\n')

  // Load trades with linked recommendation_versions not yet reviewed
  const { data: linkedTrades } = await db
    .from('actual_trades')
    .select(`
      trade_id, direction, entry, result_r, triggered,
      session, analyst_id, published_at,
      market:market_id ( symbol, market_id ),
      recommendation_version:recommendation_version_id (
        recommendation_version_id,
        entry_range_low,
        entry_range_high,
        zone_at_generation,
        opportunity_id
      )
    `)
    .not('recommendation_version_id', 'is', null)

  if (!linkedTrades?.length) {
    console.log('No linked trades found. Reviews require recommendation_version_id on actual_trades.')
    console.log('These are populated during import for platform-era trades.')
    return
  }

  // Find already-reviewed trade IDs
  const { data: existingReviews } = await db
    .from('post_trade_reviews')
    .select('trade_id')

  const reviewedTradeIds = new Set((existingReviews ?? []).map(r => r.trade_id))

  const unreviewed = linkedTrades.filter(t => !reviewedTradeIds.has(t.trade_id))
  console.log(`Linked trades: ${linkedTrades.length}, Already reviewed: ${reviewedTradeIds.size}, To review: ${unreviewed.length}`)

  if (unreviewed.length === 0) {
    console.log('All linked trades already reviewed.')
    return
  }

  // Load ATR14 for each market for entry alignment scoring
  const marketIds = [...new Set(unreviewed.map(t => (t.market as any)?.market_id).filter(Boolean))]
  const { data: atrRows } = await db
    .from('market_state_daily')
    .select('market_id, atr14, date')
    .in('market_id', marketIds)
    .order('date', { ascending: false })

  const atr14ByMarketId = new Map<string, number>()
  for (const row of (atrRows ?? [])) {
    if (!atr14ByMarketId.has(row.market_id)) {
      atr14ByMarketId.set(row.market_id, Number(row.atr14))
    }
  }

  // Load coaching recommendations for direction comparison
  const oppIds = unreviewed
    .map(t => (t.recommendation_version as any)?.opportunity_id)
    .filter(Boolean)

  const { data: coachingRows } = await db
    .from('coaching_recommendations')
    .select('opportunity_id, analyst_id, direction: opportunity_id')
    .in('opportunity_id', oppIds)

  // Actually load direction from opportunities
  const { data: oppRows } = await db
    .from('opportunities')
    .select('opportunity_id, direction')
    .in('opportunity_id', oppIds)

  const directionByOppId = new Map((oppRows ?? []).map(o => [o.opportunity_id, o.direction]))

  let created = 0, skipped = 0

  for (const trade of unreviewed) {
    const rv = trade.recommendation_version as any
    const market = trade.market as any

    if (!rv?.entry_range_low || !rv?.entry_range_high || !trade.entry) {
      skipped++
      continue
    }

    const coachingDirection = directionByOppId.get(rv.opportunity_id) ?? trade.direction
    const atr14 = atr14ByMarketId.get(market?.market_id) ?? null

    const { alignment: dirAlignment, score: dirScore } = scoreDirectionAlignment(
      trade.direction, coachingDirection
    )

    const { alignment: entryAlignment, score: entryScore } = scoreEntryAlignment(
      Number(trade.entry),
      Number(rv.entry_range_low),
      Number(rv.entry_range_high),
      atr14
    )

    const alignmentScore = dirScore + entryScore

    const reviewText = generateReviewText(
      market?.symbol ?? '—',
      trade.direction,
      coachingDirection,
      dirAlignment,
      entryAlignment,
      Number(trade.entry),
      Number(rv.entry_range_low),
      Number(rv.entry_range_high),
      alignmentScore,
      trade.triggered,
      trade.result_r !== null ? Number(trade.result_r) : null
    )

    console.log(`  ${market?.symbol} ${trade.direction}: dir=${dirAlignment}(${dirScore}), entry=${entryAlignment}(${entryScore}), total=${alignmentScore}/100`)
    console.log(`    ${reviewText}`)

    if (!isDryRun) {
      const { error } = await db.from('post_trade_reviews').insert({
        trade_id: trade.trade_id,
        recommendation_version_id: rv.recommendation_version_id,
        market: market?.symbol,
        session: trade.session,
        direction_alignment: dirAlignment,
        entry_alignment: entryAlignment,
        alignment_score: alignmentScore,
        analyst_facing_review: reviewText,
        review_status: 'GENERATED',
      })

      if (error) {
        console.error(`  Error on ${trade.trade_id}: ${error.message}`)
        skipped++
      } else {
        created++
      }
    } else {
      created++
    }
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`Reviews created: ${created}`)
  console.log(`Skipped:         ${skipped}`)
  if (isDryRun) console.log('DRY RUN -- nothing written.')
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
