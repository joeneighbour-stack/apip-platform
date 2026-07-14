// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Shadow Outcome Lifecycle Service
// ============================================================================
// Monitors shadow trades and updates outcomes when:
//   - Session low/high reaches entry range → TRIGGERED
//   - Session high/low hits target → TARGET_HIT
//   - Session low/high hits stop → STOP_HIT
//   - Expiry time passed without trigger/resolution → EXPIRY
//
// Uses market_state_intraday session_high/session_low for all price checks.
// Snapshots are matched by BOTH market_id AND session -- a US shadow trade
// only uses US session snapshot data, never European. This ensures band
// calculations are reset correctly at each session open.
//
// BUY  entries are limit orders BELOW current price -- triggered when low falls to entry
// SELL entries are limit orders ABOVE current price -- triggered when high rises to entry
//
// Session expiry windows (UTC):
//   European: 20:00 UTC same day
//   US:       20:00 UTC same day
//   APAC:     15:00 UTC following day
//   CRYPTO:   11:00 UTC following day (12:00 UK BST)
//
// Expiry applies to both NOT_TRIGGERED and TRIGGERED trades.
// Stop is checked before target -- if both hit in same session, stop wins.
//
// Run via cron every 30 mins Mon-Fri 05:00-20:00 UTC:
//   npx tsx src/scripts/runShadowOutcomeLifecycle.ts
//   npx tsx src/scripts/runShadowOutcomeLifecycle.ts --dry-run
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

function getExpiryUtc(opportunityDate: string, session: string, assetClass: string | null): Date {
  const date = new Date(opportunityDate + 'T00:00:00Z')
  if (assetClass === 'CRYPTO') {
    return new Date(date.getTime() + 35 * 60 * 60 * 1000) // next day 11:00 UTC
  }
  if (session === 'APAC') {
    return new Date(date.getTime() + 39 * 60 * 60 * 1000) // next day 15:00 UTC
  }
  return new Date(date.getTime() + 20 * 60 * 60 * 1000) // same day 20:00 UTC
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

  // Load active shadow trades (NOT_TRIGGERED and TRIGGERED)
  const { data: activeTrades } = await db
    .from('shadow_trade_outcomes')
    .select(`
      shadow_outcome_id,
      shadow_trade_id,
      trade_outcome_status,
      result_r,
      shadow_trade:shadow_trade_id (
        entry, stop, target, rr, direction, session,
        opportunity:opportunity_id (
          opportunity_id, date, session,
          market:market_id (
            market_id, symbol, display_precision, asset_class
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

  // Load intraday snapshots -- index by market_id + session (most recent per combination)
  const { data: snapshots } = await db
    .from('market_state_intraday')
    .select('market_id, session, session_high, session_low, current_price, captured_at')
    .gte('captured_at', new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
    .order('captured_at', { ascending: false })

  // Index: `${market_id}::${session}` → most recent snapshot
  const snapshotByMarketSession = new Map<string, any>()
  for (const snap of (snapshots ?? [])) {
    const key = `${snap.market_id}::${snap.session}`
    if (!snapshotByMarketSession.has(key)) {
      snapshotByMarketSession.set(key, snap)
    }
  }

  const summary = { triggered: 0, targetHit: 0, stopHit: 0, expired: 0, unchanged: 0, errors: 0 }

  for (const outcome of activeTrades) {
    const st = outcome.shadow_trade as any
    const opp = st?.opportunity as any
    const market = opp?.market as any

    if (!st || !opp || !market) { summary.errors++; continue }

    const session = st.session ?? opp.session ?? 'EUROPEAN'
    const assetClass = market.asset_class ?? null
    const expiryUtc = getExpiryUtc(opp.date, session, assetClass)

    // ── Expiry check -- applies to BOTH NOT_TRIGGERED and TRIGGERED ─────────
    if (now > expiryUtc) {
      const resultR = outcome.trade_outcome_status === 'TRIGGERED'
        ? (Number(outcome.result_r) ?? 0)
        : 0
      console.log(`  ${market.symbol} (${session}): ${outcome.trade_outcome_status} → EXPIRY (expired ${expiryUtc.toISOString()})`)
      if (!isDryRun) {
        await db.from('shadow_trade_outcomes').update({
          trade_outcome_status: 'EXPIRY',
          outcome_timestamp: expiryUtc.toISOString(),
          result_r: resultR,
        }).eq('shadow_outcome_id', outcome.shadow_outcome_id)
      }
      summary.expired++
      continue
    }

    // ── Get session-matched snapshot ────────────────────────────────────────
    // Critical: only use snapshot data from the SAME session as the trade.
    // A US trade must not use European session high/low data.
    const snapKey = `${market.market_id}::${session}`
    const snap = snapshotByMarketSession.get(snapKey)

    if (!snap?.session_high || !snap?.session_low) {
      // No snapshot for this session yet -- session may not have started
      summary.unchanged++
      continue
    }

    const entry  = Number(st.entry)
    const stop   = Number(st.stop)
    const target = Number(st.target)
    const rr     = Number(st.rr)

    const direction = st.direction ?? (target > entry ? 'BUY' : 'SELL')
    const isBuy = direction === 'BUY'

    const sessionHigh = Number(snap.session_high)
    const sessionLow  = Number(snap.session_low)

    // ── Trigger check ───────────────────────────────────────────────────────
    // BUY:  triggered when session_low <= entry (price dropped to buy zone)
    // SELL: triggered when session_high >= entry (price rallied to sell zone)
    const priceReachedEntry = isBuy
      ? sessionLow <= entry
      : sessionHigh >= entry

    if (!priceReachedEntry && outcome.trade_outcome_status === 'NOT_TRIGGERED') {
      summary.unchanged++
      continue
    }

    // ── Outcome determination ───────────────────────────────────────────────
    // Stop checked BEFORE target -- if both breached in same session, stop wins.
    let newStatus: string
    let resultR: number

    if (isBuy) {
      if (sessionLow <= stop) {
        newStatus = 'STOP_HIT'; resultR = -1
      } else if (sessionHigh >= target) {
        newStatus = 'TARGET_HIT'; resultR = rr
      } else {
        const currentPrice = Number(snap.current_price)
        newStatus = 'TRIGGERED'
        resultR = (currentPrice - entry) / Math.abs(entry - stop)
      }
    } else {
      if (sessionHigh >= stop) {
        newStatus = 'STOP_HIT'; resultR = -1
      } else if (sessionLow <= target) {
        newStatus = 'TARGET_HIT'; resultR = rr
      } else {
        const currentPrice = Number(snap.current_price)
        newStatus = 'TRIGGERED'
        resultR = (entry - currentPrice) / Math.abs(entry - stop)
      }
    }

    // Skip if already TRIGGERED and still TRIGGERED (no meaningful update)
    if (newStatus === 'TRIGGERED' && outcome.trade_outcome_status === 'TRIGGERED') {
      summary.unchanged++
      continue
    }

    const precision = market.display_precision ?? 4
    console.log(`  ${market.symbol} ${direction} (${session}): ${outcome.trade_outcome_status} → ${newStatus}`)
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
