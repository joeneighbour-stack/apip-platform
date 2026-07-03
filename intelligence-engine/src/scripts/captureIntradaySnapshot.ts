// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Intraday Market State Snapshot Script
// ============================================================================
// Captures current price from Finnhub and computes current zone against the
// latest daily state. Writes to market_state_intraday.
// Symbol mappings read from markets.price_data_symbol -- not hardcoded.
//
// Run:
//   npx tsx src/scripts/captureIntradaySnapshot.ts --session=EUROPEAN
//   npx tsx src/scripts/captureIntradaySnapshot.ts --session=US
//   npx tsx src/scripts/captureIntradaySnapshot.ts --session=APAC
//   npx tsx src/scripts/captureIntradaySnapshot.ts --dry-run --session=EUROPEAN
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildMarketState, type OhlcBar } from '../services/marketStateService.js'

const ATR_PERIOD = 14
const ZONE_COUNT = 4

// Markets covered per session -- matches analyst coverage sheet
// These are the market symbols as they appear in the markets table
const SESSION_MARKETS: Record<string, string[]> = {
  EUROPEAN: [
    // Tibor
    'EURNZD', 'EURGBP', 'Natural Gas', 'AUDCAD',
    // Mona
    'FTSE', 'GBPCHF', 'Silver', 'Brent', 'GBPUSD',
    // Maged
    'USDMXN', 'AUDJPY', 'USDTRY', 'USDCAD', 'EURJPY',
    // Ian
    'Oil', 'USDJPY', 'CAC', 'Palladium', 'Gold', 'EURSEK',
    // Khaled
    'AUDUSD', 'GBPJPY', 'EURCHF', 'Platinum', 'Copper', 'EURUSD', 'USDCHF', 'DAX',
  ],
  US: [
    // Tibor
    'DOW', 'SP500', 'DOW Futures', 'SP500 Futures', 'Litecoin',
    // Mona
    'Russell2000', 'Russell2000 Futures', 'XRP', 'Solana',
    // Ian
    'NASDAQ', 'NASDAQ Futures', 'Ethereum', 'Bitcoin',
  ],
  APAC: [
    // Tibor
    'CHINA A50', 'ASX200', 'GBPAUD', 'NZDJPY',
    // Maged
    'NZDUSD', 'HS50', 'NIKKEI', 'EURAUD', 'GBPNZD',
  ],
}

interface FinnhubQuote { c: number; h: number; l: number; o: number; t: number }

async function fetchCurrentPrice(finnhubSymbol: string, apiKey: string, isCrypto: boolean): Promise<number> {
  // Crypto uses a different Finnhub endpoint
  const url = isCrypto
    ? `https://finnhub.io/api/v1/crypto/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=1&count=1&token=${apiKey}`
    : `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${apiKey}`

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Finnhub HTTP ${response.status}`)

  if (isCrypto) {
    const body = await response.json()
    if (!body.c?.length) throw new Error(`No crypto price for ${finnhubSymbol}`)
    return body.c[body.c.length - 1]
  }

  const quote: FinnhubQuote = await response.json()
  if (!quote.c || quote.c === 0) throw new Error(`No current price for ${finnhubSymbol}`)
  return quote.c
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FINNHUB_API_KEY) {
    console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY')
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

  // Load market data from DB for this session's markets
  const { data: marketRows } = await db
    .from('markets')
    .select('market_id, symbol, price_data_provider, price_data_symbol')
    .in('symbol', sessionSymbols)

  const marketBySymbol = new Map(
    (marketRows ?? []).map(m => [m.symbol, m])
  )

  // Load recent daily bars for zone recalculation with live price
  const { data: recentBars } = await db
    .from('market_state_daily')
    .select('market_id, date, open, high, low, close')
    .gte('date', new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
    .order('date', { ascending: true })

  const barsByMarketId = new Map<string, OhlcBar[]>()
  for (const bar of (recentBars ?? [])) {
    if (!barsByMarketId.has(bar.market_id)) barsByMarketId.set(bar.market_id, [])
    barsByMarketId.get(bar.market_id)!.push({
      date: bar.date,
      open: Number(bar.open), high: Number(bar.high),
      low: Number(bar.low), close: Number(bar.close),
    })
  }

  // Load today's daily state for zone fallback
  const { data: dailyStates } = await db
    .from('market_state_daily')
    .select('market_id, zone')
    .eq('date', today)

  const dailyZoneByMarketId = new Map(
    (dailyStates ?? []).map(d => [d.market_id, d.zone])
  )

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
      const isCrypto = market.price_data_provider === 'FINNHUB_CRYPTO'
      const currentPrice = await fetchCurrentPrice(market.price_data_symbol, FINNHUB_API_KEY, isCrypto)

      let currentZone: string | null = dailyZoneByMarketId.get(market.market_id) ?? null
      const bars = barsByMarketId.get(market.market_id) ?? []

      if (bars.length >= ATR_PERIOD) {
        const state = buildMarketState({
          marketId: market.market_id,
          ohlcSeries: bars,
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

      const row = {
        market_id: market.market_id,
        session,
        captured_at: capturedAt,
        current_price: currentPrice,
        current_zone: currentZone,
      }

      if (!isDryRun) {
        const { error } = await db.from('market_state_intraday').insert(row)
        if (error) {
          console.error(`  ${symbol}: insert error — ${error.message}`)
          summary.errors++
          continue
        }
      }

      console.log(`  ${symbol}: price=${currentPrice}, zone=${currentZone}${isDryRun ? ' [DRY RUN]' : ''}`)
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
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
