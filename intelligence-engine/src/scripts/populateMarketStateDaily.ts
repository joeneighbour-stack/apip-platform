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
//   npx tsx src/scripts/populateMarketStateDaily.ts --history
//     Fetches from HISTORY_START (2019-01-01) to today instead of the last
//     DAYS_TO_FETCH days -- a one-off backfill for regime/analyst-profile
//     history, not part of the regular daily run. Does not change --days=N
//     or the default 60-day behaviour, which still use fetchRecentOhlc()
//     exactly as before. Requires FINNHUB_CANDLE_API_KEY specifically
//     (confirmed working back to 2019) rather than falling back to
//     FINNHUB_API_KEY, whose historical coverage isn't confirmed.
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

const isHistory = process.argv.includes('--history')
const HISTORY_START = '2019-01-01' // provides warmup bars before 2020 analyst trades

// Informational/logging only -- the actual fetch call is branched below
// (fetchHistoricalOhlc vs the untouched fetchRecentOhlc) rather than unified
// through this date, so --days=N and the default 60-day path keep their
// exact existing from/to computation (fetchRecentOhlc's own `to - days*86400`
// in seconds) instead of picking up this date-truncated equivalent.
const fromDate = isHistory
  ? HISTORY_START
  : new Date(Date.now() - DAYS_TO_FETCH * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

interface FinnhubCandleResponse {
  c: number[]; h: number[]; l: number[]; o: number[]; t: number[]; s: string
}

/**
 * Aggregates Finnhub 5-minute bars for a single date into a synthetic daily
 * OHLC candle. Used to fill gaps left by Finnhub's daily (resolution=D)
 * endpoint, which lags 1-2 days behind for forex -- the 5-minute endpoint
 * (resolution=5) is current, so today/yesterday can be backfilled from it
 * rather than left missing until the daily candle catches up.
 */
async function fetchIntradayAsDailyBar(
  finnhubSymbol: string, date: string, apiKey: string, isCrypto: boolean,
): Promise<OhlcBar | null> {
  const dayStart = Math.floor(new Date(date + 'T00:00:00Z').getTime() / 1000)
  const dayEnd   = Math.floor(new Date(date + 'T23:59:59Z').getTime() / 1000)

  const endpoint = isCrypto
    ? `https://finnhub.io/api/v1/crypto/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=5&from=${dayStart}&to=${dayEnd}&token=${apiKey}`
    : `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=5&from=${dayStart}&to=${dayEnd}&token=${apiKey}`

  const res = await fetch(endpoint)
  if (!res.ok) return null
  const data: FinnhubCandleResponse = await res.json()
  if (data.s !== 'ok' || !data.c?.length) return null

  return {
    date,
    open:  data.o[0]!,
    high:  Math.max(...data.h),
    low:   Math.min(...data.l),
    close: data.c[data.c.length - 1]!,
  }
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

/**
 * Same shape as fetchRecentOhlc(), but takes an explicit calendar `from`
 * date instead of a day-count -- used only by --history so the regular
 * --days=N / default path (fetchRecentOhlc, untouched) keeps its exact
 * existing seconds-based `to - days*86400` window.
 */
async function fetchHistoricalOhlc(
  finnhubSymbol: string, fromDateIso: string, apiKey: string, isCrypto = false,
): Promise<OhlcBar[]> {
  const from = Math.floor(new Date(fromDateIso + 'T00:00:00Z').getTime() / 1000)
  const to   = Math.floor(Date.now() / 1000)
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
  // 5-minute intraday fetch (used to synthesize today/yesterday's daily bar
  // when Finnhub's daily endpoint hasn't caught up yet) requires the
  // intraday-licenced key specifically -- FINNHUB_API_KEY alone may not have
  // resolution=5 access, so this is not allowed to fall back to it.
  const FINNHUB_CANDLE_API_KEY = process.env.FINNHUB_CANDLE_API_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FINNHUB_API_KEY) {
    console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY (or FINNHUB_CANDLE_API_KEY)')
    process.exit(1)
  }
  if (isHistory && !FINNHUB_CANDLE_API_KEY) {
    console.error('--history requires FINNHUB_CANDLE_API_KEY specifically (confirmed working back to 2019) -- FINNHUB_API_KEY alone is not confirmed to have that coverage.')
    process.exit(1)
  }
  if (!FINNHUB_CANDLE_API_KEY) {
    console.warn('FINNHUB_CANDLE_API_KEY not set -- missing today/yesterday daily candles will NOT be backfilled from 5-min data\n')
  }

  const isDryRun = process.argv.includes('--dry-run')
  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}${isHistory ? ' + HISTORY' : ''}`)
  console.log(isHistory
    ? `Fetching from ${fromDate} to today (history backfill)`
    : `Fetching last ${DAYS_TO_FETCH} days of daily OHLC`)
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
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  for (const market of markets) {
    if (!market.price_data_symbol) continue
    try {
      const isCrypto = market.price_data_provider === 'FINNHUB_CRYPTO'
      const bars = isHistory
        ? await fetchHistoricalOhlc(market.price_data_symbol, HISTORY_START, FINNHUB_CANDLE_API_KEY!, isCrypto)
        : await fetchRecentOhlc(market.price_data_symbol, DAYS_TO_FETCH, FINNHUB_API_KEY, isCrypto)

      // Finnhub's daily forex candle lags 1-2 days; fill today/yesterday from
      // 5-minute bars when the daily endpoint hasn't caught up yet. Only
      // fills genuinely missing dates -- never replaces a real daily candle.
      const syntheticDates = new Set<string>()
      if (FINNHUB_CANDLE_API_KEY) {
        const existingDates = new Set(bars.map(b => b.date))
        for (const date of [yesterday, today]) {
          if (existingDates.has(date)) continue
          const syntheticBar = await fetchIntradayAsDailyBar(
            market.price_data_symbol, date, FINNHUB_CANDLE_API_KEY, isCrypto,
          )
          if (syntheticBar) {
            bars.push(syntheticBar)
            syntheticDates.add(date)
            console.log(`  ${market.symbol}: synthetic daily bar for ${date} from 5-min data`)
          }
        }
        if (syntheticDates.size > 0) {
          bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        }
      }

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
          raw_payload:      syntheticDates.has(bar.date)
            ? { symbol: market.price_data_symbol, bar, synthetic: true, aggregatedFrom: '5min' }
            : { symbol: market.price_data_symbol, bar },
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
        `  ${market.symbol}: ${rows.length} rows (${bars[0]?.date} to ${latest.date}).` +
        ` Latest close=${latest.close}, ATR14=${latestState.atr14?.toFixed(5)}, ATR20=${latestState.atr20?.toFixed(5)}` +
        `${isDryRun ? ' [DRY RUN]' : ''}`
      )
      summary.upserted += rows.length
    } catch (err) {
      console.error(`  ${market.symbol}: ${(err as Error).message}`)
      summary.errors++
    }
    await new Promise(r => setTimeout(r, isHistory ? 200 : 150))
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
