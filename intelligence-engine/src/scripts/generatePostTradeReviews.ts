// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Post-Trade Review Generator
// ============================================================================
// Generates post_trade_reviews for actual_trades that have a linked
// recommendation_version_id. Scores direction, entry, stop, and target
// alignment against the coaching recommendation shown before the trade.
//
// Alignment scoring (0-4):
//   Direction: 1 pt if trade direction matches coaching direction
//   Entry:     1 pt if trade entry within or near suggested range (≤0.5 ATR20)
//   Stop:      1 pt if trade stop within or near suggested risk_range
//   Target:    1 pt if trade target within or near suggested target_range
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

// ── Range parsing ────────────────────────────────────────────────────────────

/**
 * Parses a range string like "1.0815–1.0835" (en-dash) into [low, high].
 * Returns null if the string cannot be parsed.
 */
function parseRange(range: string | null | undefined): [number, number] | null {
  if (!range) return null
  // Support en-dash (U+2013) and hyphen-minus
  const parts = range.split(/[\u2013\-]/)
  if (parts.length !== 2) return null
  const low  = parseFloat(parts[0]!.trim())
  const high = parseFloat(parts[1]!.trim())
  if (Number.isNaN(low) || Number.isNaN(high)) return null
  return [low, high]
}

// ── Alignment scoring ────────────────────────────────────────────────────────

function scoreDirectionAlignment(
  tradeDir: string, coachingDir: string
): { alignment: string; score: number } {
  const match = tradeDir.toUpperCase() === coachingDir.toUpperCase()
  return { alignment: match ? 'Aligned' : 'Different', score: match ? 1 : 0 }
}

function scoreRangeAlignment(
  value: number | null,
  rangeLow: number,
  rangeHigh: number,
  atr20: number | null,
  label: string,
): { alignment: string; score: number } {
  if (value === null || value === 0) return { alignment: 'Unknown', score: 0 }

  // Within the suggested range
  if (value >= rangeLow && value <= rangeHigh) {
    return { alignment: 'High', score: 1 }
  }

  if (!atr20 || atr20 === 0) {
    return { alignment: 'Low', score: 0 }
  }

  // Distance from nearest boundary in ATR20 units
  const distance = value < rangeLow ? rangeLow - value : value - rangeHigh
  const distanceAtr = distance / atr20

  if (distanceAtr <= 0.5) return { alignment: 'High', score: 1 }
  return { alignment: 'Low', score: 0 }
}

// ── Review text ───────────────────────────────────────────────────────────────

// Omitted entirely when triggered but still open (resultR null) -- nothing useful
// to say yet, and a "pending" filler line isn't worth the clutter.
function outcomeLine(triggered: boolean, resultR: number | null): string {
  if (!triggered) return `The setup didn't trigger this session.`
  if (resultR === null) return ''
  if (resultR > 0) return `The trade closed at +${resultR.toFixed(2)}R \u2014 a solid result.`
  if (resultR < 0) return `The trade closed at ${resultR.toFixed(2)}R.`
  return `The trade closed at breakeven.`
}

/**
 * Coaching-toned review text: encouraging regardless of outcome, frames the
 * recommendation as a suggestion the analyst chose to follow or not, and
 * stays to 2-3 sentences -- no bullet-point checklist. Template picked from
 * direction alignment first (a direction call is a different kind of choice
 * than a level being slightly off), then the overall 0-4 alignment score.
 */
function generateReviewText(
  symbol: string,
  tradeDir: string,
  dirAlignment: string,
  entryAlignment: string,
  stopAlignment: string,
  targetAlignment: string,
  entryRangeLow: number,
  entryRangeHigh: number,
  triggered: boolean,
  resultR: number | null,
): string {
  const score = (dirAlignment === 'Aligned' ? 1 : 0)
    + (entryAlignment === 'High' ? 1 : 0)
    + (stopAlignment === 'High' ? 1 : 0)
    + (targetAlignment === 'High' ? 1 : 0)

  const outcome = outcomeLine(triggered, resultR)
  const entryRangeFmt = `${entryRangeLow.toFixed(4)}\u2013${entryRangeHigh.toFixed(4)}`

  let intro: string
  let closing: string

  if (dirAlignment !== 'Aligned') {
    intro = `You took ${symbol} ${tradeDir} while the coaching suggested the opposite direction.`
    closing = `It's worth comparing both approaches \u2014 sometimes your read on the market will differ from the framework, and that's valuable information either way.`
  } else if (score === 4) {
    intro = `Strong process on ${symbol} ${tradeDir} \u2014 your entry, stop and target all fell within the suggested ranges.`
    closing = `This is exactly the kind of disciplined execution the framework is designed to support.`
  } else if (score === 3) {
    intro = `Good discipline on ${symbol} ${tradeDir} \u2014 you followed the coaching direction and most of the suggested levels.`
    closing = entryAlignment !== 'High'
      ? `Your entry landed outside the suggested ${entryRangeFmt} zone.`
      : stopAlignment !== 'High'
        ? `Your stop placement was outside the suggested risk range.`
        : `Your target was set outside the suggested range.`
  } else if (score === 2) {
    intro = `You took ${symbol} ${tradeDir} in line with the coaching direction.`
    closing = `Your entry/stop/target differed from the suggested ranges \u2014 worth comparing the two approaches when reviewing this trade.`
  } else {
    // score === 1: direction aligned, entry/stop/target all off
    intro = `You followed the coaching direction on ${symbol} ${tradeDir}.`
    closing = `Your entry and risk levels were outside the suggested ranges this time \u2014 the framework suggested ${entryRangeFmt} as the entry zone.`
  }

  return [intro, outcome, closing].filter(Boolean).join(' ')
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const SUPABASE_URL              = process.env.SUPABASE_URL
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
      trade_id, direction, entry, stop, target, result_r, triggered,
      session, analyst_id, published_at,
      market:market_id ( symbol, market_id ),
      recommendation_version:recommendation_version_id (
        recommendation_version_id,
        entry_range_low,
        entry_range_high,
        opportunity_id
      )
    `)
    .not('recommendation_version_id', 'is', null)

  if (!linkedTrades?.length) {
    console.log('No linked trades found.')
    return
  }

  // Find already-reviewed trade IDs
  const { data: existingReviews } = await db
    .from('post_trade_reviews')
    .select('trade_id')
  const reviewedTradeIds = new Set((existingReviews ?? []).map(r => r.trade_id))
  const unreviewed = linkedTrades.filter(t => !reviewedTradeIds.has(t.trade_id))

  console.log(`Linked: ${linkedTrades.length}, Reviewed: ${reviewedTradeIds.size}, To review: ${unreviewed.length}`)
  if (unreviewed.length === 0) { console.log('All reviewed.'); return }

  // Load ATR20 for each market
  const marketIds = [...new Set(unreviewed.map(t => (t.market as any)?.market_id).filter(Boolean))]
  const { data: atrRows } = await db
    .from('market_state_daily')
    .select('market_id, atr20, date')
    .in('market_id', marketIds)
    .order('date', { ascending: false })
  const atr20ByMarketId = new Map<string, number>()
  for (const row of (atrRows ?? [])) {
    if (!atr20ByMarketId.has(row.market_id) && row.atr20) {
      atr20ByMarketId.set(row.market_id, Number(row.atr20))
    }
  }

  // Load coaching recommendations for stop/target ranges and direction
  const oppIds = unreviewed
    .map(t => (t.recommendation_version as any)?.opportunity_id)
    .filter(Boolean)

  const { data: coachingRows } = await db
    .from('coaching_recommendations')
    .select('opportunity_id, risk_range, target_range')
    .in('opportunity_id', oppIds)
  const coachingByOppId = new Map(
    (coachingRows ?? []).map(c => [c.opportunity_id, c])
  )

  // Load direction from opportunities
  const { data: oppRows } = await db
    .from('opportunities')
    .select('opportunity_id, direction')
    .in('opportunity_id', oppIds)
  const directionByOppId = new Map((oppRows ?? []).map(o => [o.opportunity_id, o.direction]))

  let created = 0, skipped = 0

  for (const trade of unreviewed) {
    const rv      = trade.recommendation_version as any
    const market  = trade.market as any
    if (!rv?.entry_range_low || !rv?.entry_range_high || !trade.entry) { skipped++; continue }

    const coaching        = coachingByOppId.get(rv.opportunity_id)
    const coachingDir     = directionByOppId.get(rv.opportunity_id) ?? trade.direction
    const atr20           = atr20ByMarketId.get(market?.market_id) ?? null
    const riskRange       = parseRange(coaching?.risk_range)
    const targetRange     = parseRange(coaching?.target_range)

    const { alignment: dirAlignment,    score: dirScore }    = scoreDirectionAlignment(trade.direction, coachingDir)
    const { alignment: entryAlignment,  score: entryScore }  = scoreRangeAlignment(Number(trade.entry),  Number(rv.entry_range_low), Number(rv.entry_range_high), atr20, 'entry')
    const { alignment: stopAlignment,   score: stopScore }   = riskRange   ? scoreRangeAlignment(trade.stop   ? Number(trade.stop)   : null, riskRange[0],   riskRange[1],   atr20, 'stop')   : { alignment: 'Unknown', score: 0 }
    const { alignment: targetAlignment, score: targetScore } = targetRange ? scoreRangeAlignment(trade.target ? Number(trade.target) : null, targetRange[0], targetRange[1], atr20, 'target') : { alignment: 'Unknown', score: 0 }

    const alignmentScore = dirScore + entryScore + stopScore + targetScore

    const reviewText = generateReviewText(
      market?.symbol ?? '\u2014',
      trade.direction,
      dirAlignment, entryAlignment, stopAlignment, targetAlignment,
      Number(rv.entry_range_low), Number(rv.entry_range_high),
      trade.triggered,
      trade.result_r !== null ? Number(trade.result_r) : null,
    )

    console.log(`  ${market?.symbol} ${trade.direction}: dir=${dirAlignment}(${dirScore}) entry=${entryAlignment}(${entryScore}) stop=${stopAlignment}(${stopScore}) target=${targetAlignment}(${targetScore}) total=${alignmentScore}/4`)

    if (!isDryRun) {
      const { error } = await db.from('post_trade_reviews').insert({
        trade_id:               trade.trade_id,
        recommendation_version_id: rv.recommendation_version_id,
        market:                 market?.symbol,
        session:                trade.session,
        direction_alignment:    dirAlignment,
        entry_alignment:        entryAlignment,
        stop_alignment:         stopAlignment,
        target_alignment:       targetAlignment,
        alignment_score:        alignmentScore,
        analyst_facing_review:  reviewText,
        review_status:          'GENERATED',
      })
      if (error) { console.error(`  Error: ${error.message}`); skipped++ }
      else created++
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
