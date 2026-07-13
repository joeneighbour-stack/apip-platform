// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Shadow Outcome Lifecycle Service
// ============================================================================
// Monitors shadow trades and updates outcomes when:
//   - Session low/high reaches entry range → TRIGGERED
//   - Session high/low hits target → TARGET_HIT
//   - Session low/high hits stop → STOP_HIT
//   - Expiry time passed without trigger → EXPIRY
//
// Uses market_state_intraday session_high/session_low for all price checks.
// This is correct because:
//   BUY  entries are limit orders BELOW current price -- triggered when low falls to entry
//   SELL entries are limit orders ABOVE current price -- triggered when high rises to entry
//   Never use current price alone -- it cannot tell you if entry was touched intraday.
//
// Session expiry windows (UK time):
//   European: 21:00 same day
//   US:       21:00 same day
//   APAC:     16:00 following day
//
// Run after each session snapshot:
//   npx tsx src/scripts/runShadowOutcomeLifecycle.ts
//   npx tsx src/scripts/runShadowOutcomeLifecycle.ts --dry-run
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Session expiry rules (UK time, approximate UTC offset for BST)
function getExpiryUtc(opportunityDate: string, session: string): Date {
  const date = new Date(opportunityDate + 'T00:00:00Z')
  if (session === 'APAC') {
    // Expires 16:00 UK following day ≈ 15:00 UTC (BST)
    return new Date(date.getTime() + 39 * 60 * 60 * 1000)
  } else {
    // European and US expire 21:00 UK same day ≈ 20:00 UTC (BST)
    return new Date(date.getTime() + 20 * 60 * 60 * 1000)
  }
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
  console.log('Running shadow outcome lifecycle...\n')

  const now = new Date()

  // Load all active shadow trades (NOT_TRIGGERED and TRIGGERED)
  // TRIGGERED trades need re-evaluation for TARGET_HIT/STOP_HIT
  const { data: activeTrades } = await db
    .from('shadow_trade_outcomes')
    .select(`
      shadow_outcome_id,
      shadow_trade_id,
      trade_outcome_status,
      shadow_trade:shadow_trade_id (
        entry, stop, target, rr, direction, session,
        opportunity:opportunity_id (
          opportunity_id, date, session,
          market:market_id (
            market_id, symbol, display_precision
          )
        )
      )
    `)
    .in('trade_outcome_status', ['NOT_TRIGGERED', 'TRIGGERED'])

  if (!activeTrades?.length) {
    console.log('No active shadow trades to monitor.')
    return
  }

  console.log(`Active trades to evaluate: ${activeTrades.length} (NOT_TRIGGERED + TRIGGERED)`)

  // Load latest intraday snapshot for each market/session
  // We use session_high and session_low for accurate trigger detection
  const { data: snapshots } = await db
    .from('market_state_intraday')
    .select('market_id, session, session_high, session_low, current_price, captured_at')
    .gte('captured_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
    .order('captured_at', { ascending: false })

  // Index snapshots by market_id -- take most recent per market
  const snapshotByMarket = new Map<string, any>()
  for (const snap of (snapshots ?? [])) {
    if (!snapshotByMarket.has(snap.market_id)) {
      snapshotByMarket.set(snap.market_id, snap)
    }
  }

  const summary = { triggered: 0, targetHit: 0, stopHit: 0, expired: 0, unchanged: 0, errors: 0 }

  for (const outcome of activeTrades) {
    const st = outcome.shadow_trade as any
    const opp = st?.opportunity as any
    const market = opp?.market as any

    if (!st || !opp || !market) { summary.errors++; continue }

    const session = st.session ?? opp.session ?? 'EUROPEAN'
    const expiryUtc = getExpiryUtc(opp.date, session)

    // Check expiry first
    if (now > expiryUtc && outcome.trade_outcome_status === 'NOT_TRIGGERED') {
      console.log(`  ${market.symbol}: EXPIRY (expired ${expiryUtc.toISOString()})`)
      if (!isDryRun) {
        await db.from('shadow_trade_outcomes').update({
          trade_outcome_status: 'EXPIRY',
          outcome_timestamp: expiryUtc.toISOString(),
          result_r: 0,
        }).eq('shadow_outcome_id', outcome.shadow_outcome_id)
      }
      summary.expired++
      continue
    }

    // Get intraday snapshot for this market
    const snap = snapshotByMarket.get(market.market_id)
    if (!snap?.session_high || !snap?.session_low) {
      summary.unchanged++
      continue
    }

    const entry  = Number(st.entry)
    const stop   = Number(st.stop)
    const target = Number(st.target)
    const rr     = Number(st.rr)

    // Direction: use stored direction, fall back to deriving from stop/target
    const direction = st.direction ?? (target > entry ? 'BUY' : 'SELL')
    const isBuy = direction === 'BUY'

    const sessionHigh = Number(snap.session_high)
    const sessionLow  = Number(snap.session_low)

    // ── Trigger check using session high/low ────────────────────────────────
    // BUY:  price must DROP to entry → check session_low <= entry
    // SELL: price must RISE to entry → check session_high >= entry
    const priceReachedEntry = isBuy
      ? sessionLow <= entry
      : sessionHigh >= entry

    if (!priceReachedEntry && outcome.trade_outcome_status === 'NOT_TRIGGERED') {
      summary.unchanged++
      continue
    }

    // ── Outcome determination ───────────────────────────────────────────────
    // Once entry is reached, check if stop or target was also hit same candle
    // BUY:  target = high >= target; stop = low <= stop
    // SELL: target = low <= target;  stop = high >= stop
    let newStatus: string
    let resultR: number

    if (isBuy) {
      if (sessionHigh >= target) {
        newStatus = 'TARGET_HIT'
        resultR = rr
      } else if (sessionLow <= stop) {
        newStatus = 'STOP_HIT'
        resultR = -1
      } else if (priceReachedEntry) {
        // Entry reached but neither target nor stop hit yet
        const currentPrice = Number(snap.current_price)
        newStatus = 'TRIGGERED'
        resultR = (currentPrice - entry) / Math.abs(entry - stop)
      } else {
        // TRIGGERED trade: re-check target/stop with latest prices
        const currentPrice = Number(snap.current_price)
        newStatus = 'TRIGGERED'
        resultR = (currentPrice - entry) / Math.abs(entry - stop)
      }
    } else {
      if (sessionLow <= target) {
        newStatus = 'TARGET_HIT'
        resultR = rr
      } else if (sessionHigh >= stop) {
        newStatus = 'STOP_HIT'
        resultR = -1
      } else if (priceReachedEntry) {
        const currentPrice = Number(snap.current_price)
        newStatus = 'TRIGGERED'
        resultR = (entry - currentPrice) / Math.abs(entry - stop)
      } else {
        const currentPrice = Number(snap.current_price)
        newStatus = 'TRIGGERED'
        resultR = (entry - currentPrice) / Math.abs(entry - stop)
      }
    }

    // Only update if status has changed or result_r has improved
    if (newStatus === outcome.trade_outcome_status && newStatus === 'TRIGGERED') {
      summary.unchanged++
      continue
    }

    const precision = market.display_precision ?? 4
    console.log(`  ${market.symbol} ${direction}: ${outcome.trade_outcome_status} → ${newStatus}`)
    console.log(`    entry=${entry.toFixed(precision)}, low=${sessionLow.toFixed(precision)}, high=${sessionHigh.toFixed(precision)}, stop=${stop.toFixed(precision)}, target=${target.toFixed(precision)}, R=${resultR.toFixed(2)}`)

    if (!isDryRun) {
      await db.from('shadow_trade_outcomes').update({
        trade_outcome_status: newStatus,
        outcome_timestamp: now.toISOString(),
        result_r: resultR,
      }).eq('shadow_outcome_id', outcome.shadow_outcome_id)
    }

    if (newStatus === 'TRIGGERED') summary.triggered++
    else if (newStatus === 'TARGET_HIT') summary.targetHit++
    else if (newStatus === 'STOP_HIT') summary.stopHit++

    await new Promise(r => setTimeout(r, 50))
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Triggered:   ${summary.triggered}`)
  console.log(`Target hit:  ${summary.targetHit}`)
  console.log(`Stop hit:    ${summary.stopHit}`)
  console.log(`Expired:     ${summary.expired}`)
  console.log(`Unchanged:   ${summary.unchanged}`)
  console.log(`Errors:      ${summary.errors}`)
  if (isDryRun) console.log('\nDRY RUN -- nothing written.')
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
