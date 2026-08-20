// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Post-Trade Review Generator
// ============================================================================
// Generates post_trade_reviews for actual_trades that have a linked
// recommendation_version_id. Scores direction, entry, stop, and target
// alignment against the recommendation shown before the trade.
//
// Alignment scoring (0-4), recalibrated for the band-boundary redesign
// (entryOptimizerService.ts): stop/target alignment is no longer checked
// against coaching text ranges -- it's checked directly against the market's
// band boundaries at generation time (persisted in
// recommendation_versions.regime_tags.lowerBand/upperBand, see
// runEngineSession.ts), the actual source of truth those levels were built
// from.
//   Direction: 1 pt if trade direction matches the recommendation's direction
//   Entry:     1 pt if trade entry falls within the recommendation's zone
//   Stop:      1 pt if trade stop sits outside the band (as designed)
//   Target:    1 pt if trade target sits within the band, beyond entry
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

// ── Zone / band alignment ────────────────────────────────────────────────────

// Recomputes a zone's [low, high] bounds from the band boundaries persisted at
// generation time (recommendation_versions.regime_tags.lowerBand/upperBand).
// Bands are always split into 4 even zones (marketStateService.ts's
// calculateAtrZones, ZONE_COUNT=4 in runEngineSession.ts), so the split can be
// reconstructed here without the individual zone1Top/zone2Top/zone3Top
// fields, which aren't persisted per-recommendation.
function zoneBoundsFromBand(lowerBand: number, upperBand: number, zone: string): [number, number] {
  const step = (upperBand - lowerBand) / 4
  switch (zone) {
    case 'TOO_DEEP':
    case 'ZONE_1': return [lowerBand, lowerBand + step]
    case 'ZONE_2': return [lowerBand + step, lowerBand + 2 * step]
    case 'ZONE_3': return [lowerBand + 2 * step, lowerBand + 3 * step]
    case 'TOO_HIGH':
    case 'ZONE_4': return [lowerBand + 3 * step, upperBand]
    default: return [NaN, NaN]
  }
}

function isWithinZone(entry: number, zone: string, lowerBand: number, upperBand: number): boolean {
  const [lo, hi] = zoneBoundsFromBand(lowerBand, upperBand, zone)
  if (Number.isNaN(lo) || Number.isNaN(hi)) return false
  return entry >= lo && entry <= hi
}

// ── Alignment scoring ────────────────────────────────────────────────────────

function scoreDirectionAlignment(
  tradeDir: string, coachingDir: string
): { alignment: string; score: number } {
  const match = tradeDir.toUpperCase() === coachingDir.toUpperCase()
  return { alignment: match ? 'Aligned' : 'Different', score: match ? 1 : 0 }
}

function scoreEntryZoneAlignment(
  entry: number | null, zone: string | null, lowerBand: number | null, upperBand: number | null,
): { alignment: string; score: number } {
  if (entry === null || !zone || lowerBand === null || upperBand === null) return { alignment: 'Unknown', score: 0 }
  return isWithinZone(entry, zone, lowerBand, upperBand)
    ? { alignment: 'High', score: 1 }
    : { alignment: 'Low', score: 0 }
}

// direction here is the ACTUAL trade's own direction, not necessarily the
// recommendation's -- this checks whether the trade's own stop is coherent
// with band-exterior placement for the direction it was actually taken in,
// independent of whether it followed the recommended direction (that's
// scored separately by scoreDirectionAlignment).
function scoreStopAlignment(
  stop: number | null, direction: string, lowerBand: number | null, upperBand: number | null,
): { alignment: string; score: number } {
  if (stop === null || lowerBand === null || upperBand === null) return { alignment: 'Unknown', score: 0 }
  const aligned = direction.toUpperCase() === 'BUY' ? stop < lowerBand : stop > upperBand
  return aligned ? { alignment: 'High', score: 1 } : { alignment: 'Low', score: 0 }
}

function scoreTargetAlignment(
  target: number | null, entry: number | null, direction: string, lowerBand: number | null, upperBand: number | null,
): { alignment: string; score: number } {
  if (target === null || entry === null || lowerBand === null || upperBand === null) return { alignment: 'Unknown', score: 0 }
  const aligned = direction.toUpperCase() === 'BUY'
    ? target <= upperBand && target > entry
    : target >= lowerBand && target < entry
  return aligned ? { alignment: 'High', score: 1 } : { alignment: 'Low', score: 0 }
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
        opportunity_id,
        regime_tags
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

  const oppIds = unreviewed
    .map(t => (t.recommendation_version as any)?.opportunity_id)
    .filter(Boolean)

  // Load direction and recommended zone from opportunities
  const { data: oppRows } = await db
    .from('opportunities')
    .select('opportunity_id, direction, preferred_entry_zone')
    .in('opportunity_id', oppIds)
  const directionByOppId = new Map((oppRows ?? []).map(o => [o.opportunity_id, o.direction]))
  const zoneByOppId = new Map((oppRows ?? []).map(o => [o.opportunity_id, o.preferred_entry_zone]))

  let created = 0, skipped = 0

  for (const trade of unreviewed) {
    const rv      = trade.recommendation_version as any
    const market  = trade.market as any
    if (!rv?.entry_range_low || !rv?.entry_range_high || !trade.entry) { skipped++; continue }

    const coachingDir     = directionByOppId.get(rv.opportunity_id) ?? trade.direction
    const recommendedZone = zoneByOppId.get(rv.opportunity_id) ?? null
    const lowerBand        = rv.regime_tags?.lowerBand != null ? Number(rv.regime_tags.lowerBand) : null
    const upperBand        = rv.regime_tags?.upperBand != null ? Number(rv.regime_tags.upperBand) : null

    // Band boundaries are only persisted on recommendations generated under the
    // band-boundary redesign (recommendation_versions.regime_tags.lowerBand/upperBand,
    // see runEngineSession.ts) -- older rows have no band data at all, and entry/stop/
    // target alignment can't be scored without it. Skip cleanly rather than persisting
    // an all-Unknown review; only trades linked to a post-redesign recommendation
    // generate a review.
    if (lowerBand === null || upperBand === null) { skipped++; continue }

    const { alignment: dirAlignment,    score: dirScore }    = scoreDirectionAlignment(trade.direction, coachingDir)
    const { alignment: entryAlignment,  score: entryScore }  = scoreEntryZoneAlignment(Number(trade.entry), recommendedZone, lowerBand, upperBand)
    const { alignment: stopAlignment,   score: stopScore }   = scoreStopAlignment(trade.stop ? Number(trade.stop) : null, trade.direction, lowerBand, upperBand)
    const { alignment: targetAlignment, score: targetScore } = scoreTargetAlignment(trade.target ? Number(trade.target) : null, Number(trade.entry), trade.direction, lowerBand, upperBand)

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
