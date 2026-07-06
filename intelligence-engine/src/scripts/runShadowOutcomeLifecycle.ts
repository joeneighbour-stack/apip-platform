// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Shadow Outcome Lifecycle Service
// ============================================================================
// Monitors NOT_TRIGGERED shadow trades and updates outcomes when:
//   - Price enters entry range → TRIGGERED
//   - Price hits target → TARGET_HIT
//   - Price hits stop → STOP_HIT
//   - Expiry time passed without trigger → EXPIRY
//
// Session expiry windows (UK time):
//   European: 21:00 same day
//   US:       21:00 same day
//   APAC:     16:00 following day
//
// Run after each session snapshot (e.g. every 30 mins during session):
//   npx tsx src/scripts/runShadowOutcomeLifecycle.ts
//   npx tsx src/scripts/runShadowOutcomeLifecycle.ts --dry-run
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Session expiry rules (UK time, approximate UTC)
function getExpiryUtc(opportunityDate: string, session: string): Date {
  const date = new Date(opportunityDate + 'T00:00:00Z')
  if (session === 'APAC') {
    // Expires 16:00 UK following day = 15:00 UTC (BST)
    return new Date(date.getTime() + 39 * 60 * 60 * 1000) // +39h
  } else {
    // European and US expire 21:00 UK same day = 20:00 UTC (BST)
    return new Date(date.getTime() + 20 * 60 * 60 * 1000) // +20h
  }
}

interface FinnhubQuote { c: number }

async function fetchCurrentPrice(finnhubSymbol: string, apiKey: string): Promise<number | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${apiKey}`
    const response = await fetch(url)
    if (!response.ok) return null
    const quote: FinnhubQuote = await response.json()
    return quote.c && quote.c > 0 ? quote.c : null
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

  // Load all NOT_TRIGGERED shadow trades with their opportunity and market data
  const { data: activeTrades } = await db
    .from('shadow_trade_outcomes')
    .select(`
      shadow_outcome_id,
      shadow_trade_id,
      trade_outcome_status,
      shadow_trade:shadow_trade_id (
        entry, stop, target, rr,
        opportunity:opportunity_id (
          date, session,
          market:market_id (
            market_id, symbol,
            price_data_symbol, price_data_provider
          )
        )
      )
    `)
    .eq('trade_outcome_status', 'NOT_TRIGGERED')

  if (!activeTrades?.length) {
    console.log('No active shadow trades to monitor.')
    return
  }

  console.log(`Active NOT_TRIGGERED trades: ${activeTrades.length}`)

  const summary = { triggered: 0, targetHit: 0, stopHit: 0, expired: 0, unchanged: 0, errors: 0 }

  for (const outcome of activeTrades) {
    const st = outcome.shadow_trade as any
    const opp = st?.opportunity as any
    const market = opp?.market as any

    if (!st || !opp || !market) { summary.errors++; continue }

    const expiryUtc = getExpiryUtc(opp.date, opp.session ?? 'EUROPEAN')

    // Check expiry first
    if (now > expiryUtc) {
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

    // Skip markets without price mapping
    if (!market.price_data_symbol || market.price_data_provider === 'IC_MARKETS') {
      summary.unchanged++
      continue
    }

    // Fetch current price
    const currentPrice = await fetchCurrentPrice(market.price_data_symbol, FINNHUB_API_KEY)
    if (!currentPrice) { summary.errors++; continue }

    const entry = Number(st.entry)
    const stop = Number(st.stop)
    const target = Number(st.target)

    // Derive direction from stop/target relative to entry
    const isBuy = target > entry

    // Direction-aware trigger check:
    // BUY: price must fall DOWN to entry (current price <= entry + tolerance)
    // SELL: price must rally UP to entry (current price >= entry - tolerance)
    // Without intraday history we use current price -- if price has never
    // reached the entry range, it cannot have triggered or hit target/stop.
    const entryTolerance = Math.abs(entry) * 0.001

    const priceReachedEntry = isBuy
      ? currentPrice <= entry + entryTolerance   // price fell to or below entry
      : currentPrice >= entry - entryTolerance   // price rallied to or above entry

    if (!priceReachedEntry) {
      summary.unchanged++
      continue
    }

    // Price has reached or passed the entry -- determine outcome
    let newStatus: string
    let resultR: number

    if (isBuy) {
      if (currentPrice >= target) {
        newStatus = 'TARGET_HIT'
        resultR = st.rr
      } else if (currentPrice <= stop) {
        newStatus = 'STOP_HIT'
        resultR = -1
      } else {
        newStatus = 'TRIGGERED'
        resultR = (currentPrice - entry) / Math.abs(entry - stop)
      }
    } else {
      if (currentPrice <= target) {
        newStatus = 'TARGET_HIT'
        resultR = st.rr
      } else if (currentPrice >= stop) {
        newStatus = 'STOP_HIT'
        resultR = -1
      } else {
        newStatus = 'TRIGGERED'
        resultR = (entry - currentPrice) / Math.abs(entry - stop)
      }
    }

    console.log(`  ${market.symbol}: ${newStatus} at ${currentPrice} (entry=${entry}, stop=${stop}, target=${target}, R=${resultR.toFixed(2)})`)

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

    await new Promise(r => setTimeout(r, 150))
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
