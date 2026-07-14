// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Intraday Market State Snapshot Script
// ============================================================================
// Captures current price and session-specific developing high/low.
// Computes current zone against full daily bar history.
// Writes to market_state_intraday.
//
// SESSION H/L TRACKING:
// Finnhub quote.h / quote.l are CALENDAR DAY values (midnight UTC reset),
// not session-specific. To build accurate session h/l, we track developing
// range ourselves by comparing each snapshot against the previous snapshot
// for the same market + session:
//
//   First snapshot of session:  session_high = session_low = current_price
//   Subsequent snapshots:       session_high = max(prev_high, current_price)
//                               session_low  = min(prev_low, current_price)
//
// This gives us a monotonically expanding range from session start,
// independent of Finnhub's calendar day reset.
//
// Session windows (UK time):
//   EUROPEAN: 22:00 prev day → 06:00 (snapshot at 04:45 UTC)
//   US:       22:00 prev day → 12:00 (snapshot at 10:45 UTC)
//   APAC:     10:00 → 16:00          (snapshot at 14:45 UTC)
//
// Run:
//   npx tsx src/scripts/captureIntradaySnapshot.ts --session=EUROPEAN
//   npx tsx src/scripts/captureIntradaySnapshot.ts --session=US
//   npx tsx src/scripts/captureIntradaySnapshot.ts --session=APAC
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY
//
// REVERT NOTE: to revert this change:
//   git log --oneline -10
//   git checkout <commit-before-this-change> -- intelligence-engine/src/scripts/captureIntradaySnapshot.ts
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildMarketState, type OhlcBar } from '../services/marketStateService.js'

const ATR_PERIOD = 14
const ZONE_COUNT = 4

const SESSION_MARKETS: Record<string, string[]> = {
  EUROPEAN: [
    'EURNZD', 'EURGBP', 'Natural Gas', 'AUDCAD',
    'FTSE', 'GBPCHF', 'Silver', 'Brent', 'GBPUSD',
    'USDMXN', 'AUDJPY', 'USDTRY', 'USDCAD', 'EURJPY',
    'Oil', 'USDJPY', 'CAC', 'Palladium', 'Gold', 'EURSEK',
    'AUDUSD', 'GBPJPY', 'EURCHF', 'Platinum', 'Copper', 'EURUSD', 'USDCHF', 'DAX',
  ],
  US: [
    'DOW', 'SP500', 'Litecoin',
    'US2000', 'Ripple', 'Solana',
    'NASDAQ', 'Ethereum', 'Bitcoin',
  ],
  APAC: [
    'CHINA A50', 'ASX200', 'GBPAUD', 'NZDJPY',
    'NZDUSD', 'HS50', 'NIKKEI', 'EURAUD', 'GBPNZD',
  ],
}

interface FinnhubQuote { c: number; h: number; l: number; o: number; t: number }

async function fetchQuote(finnhubSymbol: string, apiKey: string): Promise<FinnhubQuote> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${apiKey}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Finnhub HTTP ${response.status}`)
  const quote: FinnhubQuote = await response.json()
  if (!quote.c || quote.c === 0) throw new Error(`No current price for ${finnhubSymbol}`)
  return quote
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
  const sessionArg = process.argv.find(a => a.startsWith('--session='))?.split('=')[1]
  const session = (sessionArg ?? 'EUROPEAN').toUpperCase() as 'EUROPEAN' | 'US' | 'APAC'

  if (!SESSION_MARKETS[session]) {
    console.error(`Unknown session: ${session}. Use EUROPEAN, US, or APAC.`)
    process.exit(1)
  }

  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Session: ${session}\n`)

  const capturedAt = new Date().toISOString()
  const today = capturedAt.slice(0, 10)
  const sessionSymbols = SESSION_MARKETS[session]!

  // Load market data
  const { data: marketRows } = await db
    .from('markets')
    .select('market_id, symbol, price_data_provider, price_data_symbol')
    .in('symbol', sessionSymbols)

  const marketBySymbol = new Map(
    (marketRows ?? []).map(m => [m.symbol, m])
  )

  // ── Load previous session snapshots for session h/l continuity ────────────
  // For each market, find the most recent snapshot for THIS session today.
  // If found, we extend its h/l with the current price.
  // If not found, this is the first snapshot of the session -- seed with current price.
  const sessionStart = new Date(capturedAt)
  // Look back up to 24h to find previous snapshots for this session
  const lookbackStart = new Date(sessionStart.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const { data: prevSnapshots } = await db
    .from('market_state_intraday')
    .select('market_id, session_high, session_low, captured_at')
    .eq('session', session)
    .gte('captured_at', lookbackStart)
    .order('captured_at', { ascending: false })

  // Index: market_id → most recent snapshot for this session
  const prevByMarket = new Map<string, { session_high: number; session_low: number }>()
  for (const snap of (prevSnapshots ?? [])) {
    if (!prevByMarket.has(snap.market_id)) {
      prevByMarket.set(snap.market_id, {
        session_high: Number(snap.session_high),
        session_low: Number(snap.session_low),
      })
    }
  }

  // Load FULL bar history for ATR convergence
  const allBars: any[] = []
  let page = 0, hasMore = true
  while (hasMore) {
    const { data } = await db
      .from('market_state_daily')
      .select('market_id, date, open, high, low, close')
      .order('date', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (!data?.length) { hasMore = false } else {
      allBars.push(...data)
      hasMore = data.length === 1000
      page++
    }
  }

  const barsByMarketId = new Map<string, OhlcBar[]>()
  for (const bar of allBars) {
    if (!barsByMarketId.has(bar.market_id)) barsByMarketId.set(bar.market_id, [])
    barsByMarketId.get(bar.market_id)!.push({
      date: bar.date,
      open: Number(bar.open), high: Number(bar.high),
      low: Number(bar.low), close: Number(bar.close),
    })
  }

  const summary = { captured: 0, skipped: 0, errors: 0 }

  for (const symbol of sessionSymbols) {
    const market = marketBySymbol.get(symbol)
    if (!market) {
      console.log(`  ${symbol}: not found in markets table, skipping`)
      summary.skipped++
      continue
    }
    if (!market.price_data_symbol) {
      console.log(`  ${symbol}: no price_data_symbol mapped, skipping`)
      summary.skipped++
      continue
    }
    if (market.price_data_provider === 'IC_MARKETS') {
      console.log(`  ${symbol}: IC Markets provider -- manual feed required, skipping`)
      summary.skipped++
      continue
    }

    try {
      const quote = await fetchQuote(market.price_data_symbol, FINNHUB_API_KEY)
      const currentPrice = quote.c

      // ── Session h/l: track ourselves, independent of Finnhub calendar day ──
      // First snapshot of session: seed with current price
      // Subsequent snapshots: extend previous session h/l with current price
      const prev = prevByMarket.get(market.market_id)
      const sessionHigh = prev
        ? Math.max(prev.session_high, currentPrice)
        : currentPrice
      const sessionLow = prev
        ? Math.min(prev.session_low, currentPrice)
        : currentPrice

      // Build market state using full bar history for accurate ATR
      const bars = barsByMarketId.get(market.market_id) ?? []
      let currentZone: string | null = null

      if (bars.length >= ATR_PERIOD) {
        const lastBar = bars[bars.length - 1]!
        let barsForState: OhlcBar[]

        if (lastBar.date < today) {
          // Previous day's bar is latest -- add today's developing bar
          barsForState = [...bars, {
            date: today,
            open: currentPrice,
            high: sessionHigh,
            low: sessionLow,
            close: currentPrice,
          }]
        } else {
          // Today's bar exists -- update with session h/l
          barsForState = [...bars.slice(0, -1), {
            ...lastBar,
            high: Math.max(lastBar.high, sessionHigh),
            low: Math.min(lastBar.low, sessionLow),
            close: currentPrice,
          }]
        }

        const state = buildMarketState({
          marketId: market.market_id,
          ohlcSeries: barsForState,
          currentPrice: { price: currentPrice, capturedAt },
          parameters: { atrPeriod: ATR_PERIOD, zoneCount: ZONE_COUNT },
        })
        if (state.currentZone) currentZone = state.currentZone
      }

      if (!currentZone) {
        console.log(`  ${symbol}: could not determine zone, skipping`)
        summary.skipped++
        continue
      }

      const isFirstSnapshot = !prev
      const row = {
        market_id: market.market_id,
        session,
        captured_at: capturedAt,
        current_price: currentPrice,
        current_zone: currentZone,
        session_high: sessionHigh,
        session_low: sessionLow,
      }

      if (!isDryRun) {
        const { error } = await db.from('market_state_intraday').insert(row)
        if (error) {
          console.error(`  ${symbol}: insert error -- ${error.message}`)
          summary.errors++
          continue
        }
      }

      console.log(`  ${symbol}: price=${currentPrice}, zone=${currentZone}, h=${sessionHigh.toFixed(4)}, l=${sessionLow.toFixed(4)}${isFirstSnapshot ? ' [session start]' : ''}${isDryRun ? ' [DRY RUN]' : ''}`)
      summary.captured++
    } catch (err) {
      console.error(`  ${symbol}: ${(err as Error).message}`)
      summary.errors++
    }

    await new Promise(r => setTimeout(r, 150))
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Captured: ${summary.captured}`)
  console.log(`Skipped: ${summary.skipped}`)
  console.log(`Errors: ${summary.errors}`)
  if (isDryRun) console.log('\nDRY RUN -- nothing written.')

  if (!isDryRun && summary.errors > 0 && summary.captured === 0) {
    console.error('All markets failed to capture -- exiting with code 1')
    process.exit(1)
  }
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
