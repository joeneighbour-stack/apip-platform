// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Market State Daily Population Script
// ============================================================================
// Fetches daily OHLC from Finnhub for all FINNHUB_OANDA/FINNHUB_CRYPTO markets,
// computes ATR14 (backward compat) and ATR20 (canonical), and upserts into
// market_state_daily.
//
// ATR20 Wilder RMA is the canonical zone input per locked methodology V1.4.
// ATR14 is retained alongside for historical continuity during transition.
//
// Run:
//   npx tsx src/scripts/populateMarketStateDaily.ts --dry-run
//   npx tsx src/scripts/populateMarketStateDaily.ts
//   npx tsx src/scripts/populateMarketStateDaily.ts --days=90
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY
//   Note: FINNHUB_API_KEY must have access to forex/candle (resolution=D).
//   Use FINNHUB_CANDLE_API_KEY if the primary key lacks candle access.
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildMarketState, type OhlcBar } from '../services/marketStateService.js'

const ATR_PERIOD_PRIMARY = 20   // canonical -- stored as atr20
const ATR_PERIOD_LEGACY  = 14   // retained for transition -- stored as atr14
const ZONE_COUNT = 4

const daysArg = process.argv.find(a => a.startsWith('--days='))?.split('=')[1]
const DAYS_TO_FETCH = Number(daysArg ?? 60)

interface FinnhubCandleResponse {
  c: number[]; h: number[]; l: number[]; o: number[]; t: number[]; s: string
}

async function fetchRecentOhlc(
  finnhubSymbol: string, days: number, apiKey: string, isCrypto = false,
): Promise<OhlcBar[]> {
  const to   = Math.floor(Date.now() / 1000)
  const from = to - days * 24 * 60 * 60
  const endpoint = isCrypto
    ? `https://finnhub.io/api/v1/crypto/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=D&from=${from}&to=${to}&token=${apiKey}`
    : `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=D&from=${from}&to=${to}&token=${apiKey}`
  const response = await fetch(endpoint)
  if (!response.ok) throw new Error(`Finnhub HTTP ${response.status}`)
  const body: FinnhubCandleResponse = await response.json()
  if (body.s !== 'ok' || !body.c?.length) throw new Error(`Finnhub status '${body.s}' for ${finnhubSymbol}`)
  const bars: OhlcBar[] = body.t.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    open: body.o[i]!, high: body.h[i]!, low: body.l[i]!, close: body.c[i]!,
  }))
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return bars
}

async function main() {
  const SUPABASE_URL              = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  // Prefer candle-enabled key; fall back to primary
  const FINNHUB_API_KEY = process.env.FINNHUB_CANDLE_API_KEY ?? process.env.FINNHUB_API_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FINNHUB_API_KEY) {
    console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY (or FINNHUB_CANDLE_API_KEY)')
    process.exit(1)
  }

  const isDryRun = process.argv.includes('--dry-run')
  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Fetching last ${DAYS_TO_FETCH} days of daily OHLC`)
  console.log(`Computing ATR${ATR_PERIOD_PRIMARY} (canonical) + ATR${ATR_PERIOD_LEGACY} (legacy)\n`)

  const { data: marketRows, error: marketError } = await db
    .from('markets')
    .select('market_id, symbol, price_data_provider, price_data_symbol')
    .eq('active', true)
    .not('price_data_symbol', 'is', null)

  if (marketError) {
    console.error('Failed to load markets:', marketError.message)
    process.exit(1)
  }

  const markets = (marketRows ?? []).filter(m =>
    m.price_data_provider === 'FINNHUB_OANDA' || m.price_data_provider === 'FINNHUB_CRYPTO'
  )
  const skippedProviders = (marketRows ?? []).filter(m =>
    m.price_data_provider !== 'FINNHUB_OANDA' && m.price_data_provider !== 'FINNHUB_CRYPTO'
  )

  console.log(`Markets to fetch: ${markets.length}`)
  if (skippedProviders.length > 0) {
    console.log(`Skipped (other provider): ${skippedProviders.map(m => `${m.symbol}(${m.price_data_provider})`).join(', ')}\n`)
  }

  const summary = { upserted: 0, skipped: 0, errors: 0 }
  const today = new Date().toISOString().slice(0, 10)

  for (const market of markets) {
    if (!market.price_data_symbol) continue
    try {
      const isCrypto = market.price_data_provider === 'FINNHUB_CRYPTO'
      const bars = await fetchRecentOhlc(market.price_data_symbol, DAYS_TO_FETCH, FINNHUB_API_KEY, isCrypto)

      if (bars.length < ATR_PERIOD_PRIMARY) {
        console.log(`  ${market.symbol}: insufficient bars (${bars.length} < ${ATR_PERIOD_PRIMARY}), skipping`)
        summary.skipped++; continue
      }

      const rows: object[] = []
      for (let i = ATR_PERIOD_PRIMARY - 1; i < bars.length; i++) {
        const bar = bars[i]!
        if (bar.date > today) continue

        const slicedBars = bars.slice(0, i + 1)

        // Compute both ATR values via buildMarketState
        // atrPeriod=20 gives us both atr20 (primary) and atr14 (computed internally)
        const state = buildMarketState({
          marketId: market.market_id,
          ohlcSeries: slicedBars,
          currentPrice: { price: bar.close, capturedAt: bar.date },
          parameters: { atrPeriod: ATR_PERIOD_LEGACY, zoneCount: ZONE_COUNT },
          // No sessionAnchors -- backward compat path, uses latest bar h/l
        })

        if (state.atr14 === null && state.atr20 === null) continue

        rows.push({
          market_id:        market.market_id,
          date:             bar.date,
          open:             bar.open,
          high:             bar.high,
          low:              bar.low,
          close:            bar.close,
          atr14:            state.atr14,
          atr20:            state.atr20,
          zone:             state.currentZone,
          source_system:    'FINNHUB',
          source_record_id: `${market.price_data_symbol}:${bar.date}`,
          imported_at:      new Date().toISOString(),
          raw_payload:      { symbol: market.price_data_symbol, bar },
        })
      }

      if (!isDryRun && rows.length > 0) {
        const { error } = await db
          .from('market_state_daily')
          .upsert(rows, { onConflict: 'market_id,date' })
        if (error) {
          console.error(`  ${market.symbol}: upsert error -- ${error.message}`)
          summary.errors++; continue
        }
      }

      const latest = bars[bars.length - 1]!
      const latestState = buildMarketState({
        marketId: market.market_id,
        ohlcSeries: bars,
        currentPrice: { price: latest.close, capturedAt: latest.date },
        parameters: { atrPeriod: ATR_PERIOD_LEGACY, zoneCount: ZONE_COUNT },
      })
      console.log(
        `  ${market.symbol}: ${rows.length} rows. Latest (${latest.date}):` +
        ` close=${latest.close}, ATR14=${latestState.atr14?.toFixed(5)}, ATR20=${latestState.atr20?.toFixed(5)}` +
        `${isDryRun ? ' [DRY RUN]' : ''}`
      )
      summary.upserted += rows.length
    } catch (err) {
      console.error(`  ${market.symbol}: ${(err as Error).message}`)
      summary.errors++
    }
    await new Promise(r => setTimeout(r, 150))
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Rows upserted: ${summary.upserted}`)
  console.log(`Markets skipped: ${summary.skipped}`)
  console.log(`Errors: ${summary.errors}`)
  if (isDryRun) console.log('\nDRY RUN -- nothing written.')
  if (!isDryRun && summary.errors > 0 && summary.upserted === 0) {
    console.error('All markets failed -- exiting with code 1')
    process.exit(1)
  }
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
