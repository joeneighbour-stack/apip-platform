// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Market State Daily Population Script
// ============================================================================
// Fetches daily OHLC from Finnhub for all confirmed markets, computes ATR14
// and zone via buildMarketState(), and upserts into market_state_daily.
//
// Designed to run once per day before the European session open (e.g. 05:30 UK).
// Safe to re-run -- upserts on (market_id, date) unique constraint.
//
// Run:
//   npx tsx src/scripts/populateMarketStateDaily.ts --dry-run
//   npx tsx src/scripts/populateMarketStateDaily.ts
//
// Required environment variables:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildMarketState, type OhlcBar } from '../services/marketStateService.js'

const ATR_PERIOD = 14
const ZONE_COUNT = 4
const DAYS_TO_FETCH = 60 // enough history for ATR14 + recent zones

// All confirmed markets with their Finnhub OANDA symbols
// Extended from the Phase 1.5 pilot with additional markets
const MARKETS: { symbol: string; finnhubSymbol: string; resolution: string }[] = [
  // FX
  { symbol: 'EURUSD',  finnhubSymbol: 'OANDA:EUR_USD',  resolution: 'D' },
  { symbol: 'GBPUSD',  finnhubSymbol: 'OANDA:GBP_USD',  resolution: 'D' },
  { symbol: 'EURGBP',  finnhubSymbol: 'OANDA:EUR_GBP',  resolution: 'D' },
  { symbol: 'EURNZD',  finnhubSymbol: 'OANDA:EUR_NZD',  resolution: 'D' },
  { symbol: 'AUDCAD',  finnhubSymbol: 'OANDA:AUD_CAD',  resolution: 'D' },
  { symbol: 'AUDJPY',  finnhubSymbol: 'OANDA:AUD_JPY',  resolution: 'D' },
  { symbol: 'GBPCHF',  finnhubSymbol: 'OANDA:GBP_CHF',  resolution: 'D' },
  { symbol: 'USDMXN',  finnhubSymbol: 'OANDA:USD_MXN',  resolution: 'D' },
  { symbol: 'NZDJPY',  finnhubSymbol: 'OANDA:NZD_JPY',  resolution: 'D' },
  { symbol: 'USDCHF',  finnhubSymbol: 'OANDA:USD_CHF',  resolution: 'D' },
  { symbol: 'USDJPY',  finnhubSymbol: 'OANDA:USD_JPY',  resolution: 'D' },
  { symbol: 'USDCAD',  finnhubSymbol: 'OANDA:USD_CAD',  resolution: 'D' },
  { symbol: 'EURCHF',  finnhubSymbol: 'OANDA:EUR_CHF',  resolution: 'D' },
  { symbol: 'AUDUSD',  finnhubSymbol: 'OANDA:AUD_USD',  resolution: 'D' },
  { symbol: 'GBPJPY',  finnhubSymbol: 'OANDA:GBP_JPY',  resolution: 'D' },
  { symbol: 'GBPAUD',  finnhubSymbol: 'OANDA:GBP_AUD',  resolution: 'D' },
  { symbol: 'NZDUSD',  finnhubSymbol: 'OANDA:NZD_USD',  resolution: 'D' },
  { symbol: 'EURAUD',  finnhubSymbol: 'OANDA:EUR_AUD',  resolution: 'D' },
  { symbol: 'GBPNZD',  finnhubSymbol: 'OANDA:GBP_NZD',  resolution: 'D' },
  { symbol: 'USDTRY',  finnhubSymbol: 'OANDA:USD_TRY',  resolution: 'D' },
  { symbol: 'GBPCAD',  finnhubSymbol: 'OANDA:GBP_CAD',  resolution: 'D' },
  { symbol: 'EURJPY',  finnhubSymbol: 'OANDA:EUR_JPY',  resolution: 'D' },
  { symbol: 'EURSEK',  finnhubSymbol: 'OANDA:EUR_SEK',  resolution: 'D' },
  { symbol: 'USDCNH',  finnhubSymbol: 'OANDA:USD_CNH',  resolution: 'D' },
  // Indices
  { symbol: 'DOW',     finnhubSymbol: 'OANDA:US30_USD', resolution: 'D' },
  { symbol: 'NASDAQ',  finnhubSymbol: 'OANDA:NAS100_USD', resolution: 'D' },
  { symbol: 'SP500',   finnhubSymbol: 'OANDA:SPX500_USD', resolution: 'D' },
  { symbol: 'FTSE',    finnhubSymbol: 'OANDA:UK100_GBP', resolution: 'D' },
  { symbol: 'DAX',     finnhubSymbol: 'OANDA:DE30_EUR', resolution: 'D' },
  { symbol: 'CAC',     finnhubSymbol: 'OANDA:FR40_EUR', resolution: 'D' },
  { symbol: 'ASX200',  finnhubSymbol: 'OANDA:AU200_AUD', resolution: 'D' },
  // Commodities
  { symbol: 'Oil',     finnhubSymbol: 'OANDA:WTICO_USD', resolution: 'D' },
  { symbol: 'Gold',    finnhubSymbol: 'OANDA:XAU_USD',  resolution: 'D' },
  { symbol: 'Silver',  finnhubSymbol: 'OANDA:XAG_USD',  resolution: 'D' },
  { symbol: 'Copper',  finnhubSymbol: 'OANDA:XCU_USD',  resolution: 'D' },
  { symbol: 'Platinum',finnhubSymbol: 'OANDA:XPT_USD',  resolution: 'D' },
  { symbol: 'Natural Gas', finnhubSymbol: 'OANDA:NATGAS_USD', resolution: 'D' },
]

interface FinnhubCandleResponse {
  c: number[]; h: number[]; l: number[]; o: number[]; t: number[]; s: string
}

async function fetchRecentOhlc(
  finnhubSymbol: string,
  days: number,
  apiKey: string
): Promise<OhlcBar[]> {
  const to = Math.floor(Date.now() / 1000)
  const from = to - days * 24 * 60 * 60

  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=D&from=${from}&to=${to}&token=${apiKey}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Finnhub HTTP ${response.status}`)

  const body: FinnhubCandleResponse = await response.json()
  if (body.s !== 'ok' || !body.c?.length) {
    throw new Error(`Finnhub status '${body.s}' for ${finnhubSymbol}`)
  }

  const bars: OhlcBar[] = body.t.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    open: body.o[i]!,
    high: body.h[i]!,
    low: body.l[i]!,
    close: body.c[i]!,
  }))
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return bars
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
  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Fetching last ${DAYS_TO_FETCH} days of daily OHLC for ${MARKETS.length} markets\n`)

  // Load market_id lookup
  const { data: marketRows } = await db
    .from('markets')
    .select('market_id, symbol')

  const marketIdBySymbol = new Map(
    (marketRows ?? []).map(m => [m.symbol, m.market_id])
  )

  const summary = { upserted: 0, skipped: 0, errors: 0 }

  for (const market of MARKETS) {
    const marketId = marketIdBySymbol.get(market.symbol)
    if (!marketId) {
      console.log(`  ${market.symbol}: not found in markets table, skipping`)
      summary.skipped++
      continue
    }

    try {
      const bars = await fetchRecentOhlc(market.finnhubSymbol, DAYS_TO_FETCH, FINNHUB_API_KEY)

      if (bars.length < ATR_PERIOD) {
        console.log(`  ${market.symbol}: insufficient bars (${bars.length}), skipping`)
        summary.skipped++
        continue
      }

      // Process each bar -- upsert daily state
      const today = new Date().toISOString().slice(0, 10)
      const rows: object[] = []

      for (let i = ATR_PERIOD - 1; i < bars.length; i++) {
        const bar = bars[i]!
        // Only upsert bars up to and including today
        if (bar.date > today) continue

        const windowedSeries = bars.slice(0, i + 1)
        const state = buildMarketState({
          marketId,
          ohlcSeries: windowedSeries,
          currentPrice: { price: bar.close, capturedAt: bar.date },
          parameters: { atrPeriod: ATR_PERIOD, zoneCount: ZONE_COUNT },
        })

        if (state.currentZone === null || state.atr14 === null) continue

        rows.push({
          market_id: marketId,
          date: bar.date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          atr14: state.atr14,
          zone: state.currentZone,
          source_system: 'FINNHUB',
          source_record_id: `${market.finnhubSymbol}:${bar.date}`,
          imported_at: new Date().toISOString(),
          raw_payload: { symbol: market.finnhubSymbol, bar },
        })
      }

      if (!isDryRun && rows.length > 0) {
        const { error } = await db
          .from('market_state_daily')
          .upsert(rows, { onConflict: 'market_id,date' })

        if (error) {
          console.error(`  ${market.symbol}: upsert error — ${error.message}`)
          summary.errors++
          continue
        }
      }

      const latestBar = bars[bars.length - 1]!
      const latestState = buildMarketState({
        marketId,
        ohlcSeries: bars,
        currentPrice: { price: latestBar.close, capturedAt: latestBar.date },
        parameters: { atrPeriod: ATR_PERIOD, zoneCount: ZONE_COUNT },
      })

      console.log(`  ${market.symbol}: ${rows.length} rows upserted. Latest (${latestBar.date}): close=${latestBar.close}, ATR=${latestState.atr14?.toFixed(4)}, zone=${latestState.currentZone}${isDryRun ? ' [DRY RUN]' : ''}`)
      summary.upserted += rows.length

    } catch (err) {
      console.error(`  ${market.symbol}: ${(err as Error).message}`)
      summary.errors++
    }

    // Pace requests -- paid tier is generous but be polite
    await new Promise(r => setTimeout(r, 150))
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Rows upserted: ${summary.upserted}`)
  console.log(`Markets skipped: ${summary.skipped}`)
  console.log(`Errors: ${summary.errors}`)
  if (isDryRun) console.log('\nDRY RUN -- nothing written. Remove --dry-run to apply.')
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
