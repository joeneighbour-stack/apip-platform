// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Shadow Outcome Lifecycle Service
// ============================================================================
// Monitors shadow trades and updates outcomes based on CURRENT PRICE only.
//
// Logic:
//   Every 30 minutes, fetch current price from Finnhub for each active trade.
//   BUY:  triggered when current_price <= entry (price dropped to buy zone)
//         stop_hit when current_price <= stop
//         target_hit when current_price >= target
//   SELL: triggered when current_price >= entry (price rallied to sell zone)
//         stop_hit when current_price >= stop
//         target_hit when current_price <= target
//
//   Stop is checked BEFORE target -- if both breached, stop wins (conservative).
//   Expiry: NOT_TRIGGERED or TRIGGERED trades expire at session close.
//
// Session expiry windows (UTC):
//   European: 20:00 UTC same day
//   US:       20:00 UTC same day
//   APAC:     15:00 UTC following day
//   CRYPTO:   11:00 UTC following day
//
// Run:
//   npx tsx src/scripts/runShadowOutcomeLifecycle.ts
//   npx tsx src/scripts/runShadowOutcomeLifecycle.ts --dry-run
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

function getExpiryUtc(opportunityDate: string, session: string, assetClass: string | null): Date {
  const date = new Date(opportunityDate + 'T00:00:00Z')
  if (assetClass === 'CRYPTO') return new Date(date.getTime() + 35 * 60 * 60 * 1000)
  if (session === 'APAC') return new Date(date.getTime() + 39 * 60 * 60 * 1000)
  return new Date(date.getTime() + 20 * 60 * 60 * 1000)
}

interface FinnhubQuote { c: number }

async function fetchCurrentPrice(symbol: string, apiKey: string): Promise<number | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`
    const res = await fetch(url)
    if (!res.ok) return null
    const q: FinnhubQuote = await res.json()
    return q.c > 0 ? q.c : null
  } catch {
    return null
  }
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FINNHUB_API_KEY) {
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
          date, session,
          market:market_id (
            market_id, symbol, asset_class, display_precision,
            price_data_symbol, price_data_provider
          )
        )
      )
    `)
    .in('trade_outcome_status', ['NOT_TRIGGERED', 'TRIGGERED'])

  if (!activeTrades?.length) {
    console.log('No active shadow trades to monitor.')
    return
  }

  console.log(`Active trades to evaluate: ${activeTrades.length}`)

  const summary = { triggered: 0, targetHit: 0, stopHit: 0, expired: 0, unchanged: 0, errors: 0 }

  for (const outcome of activeTrades) {
    const st = outcome.shadow_trade as any
    const opp = st?.opportunity as any
    const market = opp?.market as any

    if (!st || !opp || !market) { summary.errors++; continue }

    const session = st.session ?? opp.session ?? 'EUROPEAN'
    const assetClass = market.asset_class ?? null
    const expiryUtc = getExpiryUtc(opp.date, session, assetClass)

    // ── Expiry check ────────────────────────────────────────────────────────
    if (now > expiryUtc) {
      const resultR = outcome.trade_outcome_status === 'TRIGGERED'
        ? (Number(outcome.result_r) ?? 0) : 0
      console.log(`  ${market.symbol} (${session}): ${outcome.trade_outcome_status} → EXPIRY`)
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

    // Skip markets without Finnhub price data
    if (!market.price_data_symbol || market.price_data_provider === 'IC_MARKETS') {
      summary.unchanged++
      continue
    }

    // ── Fetch current price from Finnhub ────────────────────────────────────
    const currentPrice = await fetchCurrentPrice(market.price_data_symbol, FINNHUB_API_KEY)
    if (!currentPrice) {
      console.log(`  ${market.symbol}: could not fetch price`)
      summary.errors++
      continue
    }

    const entry  = Number(st.entry)
    const stop   = Number(st.stop)
    const target = Number(st.target)
    const rr     = Number(st.rr)
    const direction = st.direction ?? (target > entry ? 'BUY' : 'SELL')
    const isBuy = direction === 'BUY'
    const precision = market.display_precision ?? 4

    // ── Trigger check ───────────────────────────────────────────────────────
    // BUY:  triggered when current price drops TO OR BELOW entry
    // SELL: triggered when current price rises TO OR ABOVE entry
    const priceReachedEntry = isBuy
      ? currentPrice <= entry
      : currentPrice >= entry

    if (!priceReachedEntry && outcome.trade_outcome_status === 'NOT_TRIGGERED') {
      summary.unchanged++
      continue
    }

    // ── Outcome determination ───────────────────────────────────────────────
    // Stop checked BEFORE target -- conservative/worst-case
    let newStatus: string
    let resultR: number

    if (isBuy) {
      if (currentPrice <= stop) {
        newStatus = 'STOP_HIT'; resultR = -1
      } else if (currentPrice >= target) {
        newStatus = 'TARGET_HIT'; resultR = rr
      } else {
        newStatus = 'TRIGGERED'
        resultR = (currentPrice - entry) / Math.abs(entry - stop)
      }
    } else {
      if (currentPrice >= stop) {
        newStatus = 'STOP_HIT'; resultR = -1
      } else if (currentPrice <= target) {
        newStatus = 'TARGET_HIT'; resultR = rr
      } else {
        newStatus = 'TRIGGERED'
        resultR = (entry - currentPrice) / Math.abs(entry - stop)
      }
    }

    // Skip if TRIGGERED and still TRIGGERED with no meaningful change
    if (newStatus === 'TRIGGERED' && outcome.trade_outcome_status === 'TRIGGERED') {
      summary.unchanged++
      continue
    }

    console.log(`  ${market.symbol} ${direction} (${session}): ${outcome.trade_outcome_status} → ${newStatus}`)
    console.log(`    price=${currentPrice.toFixed(precision)}, entry=${entry.toFixed(precision)}, stop=${stop.toFixed(precision)}, target=${target.toFixed(precision)}, R=${resultR.toFixed(2)}`)

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

    await new Promise(r => setTimeout(r, 200))
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
