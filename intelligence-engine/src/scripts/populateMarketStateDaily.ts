// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Market State Daily Population Script
// ============================================================================
// Fetches daily OHLC from Azure Table Storage (see src/lib/azurePrices.ts --
// drop-in replacement for the old Finnhub forex/crypto/stock candle
// endpoints) for all FINNHUB_OANDA/FINNHUB_CRYPTO/IC_MARKETS markets,
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
//     exactly as before.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRICES_TABLE_CONN
//   (Azure Table Storage connection string -- see src/lib/azurePrices.ts)
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildMarketState, type OhlcBar } from '../services/marketStateService.js'
import { getCandles, type FinnhubCandleResponse } from '../lib/azurePrices.js'

const ATR_PERIOD_PRIMARY = 20   // canonical -- stored as atr20
const ATR_PERIOD_LEGACY  = 14   // retained for transition -- stored as atr14
const ZONE_COUNT = 4

const daysArg = process.argv.find(a => a.startsWith('--days='))?.split('=')[1]
const DAYS_TO_FETCH = Number(daysArg ?? 60)

const isHistory = process.argv.includes('--history')
const HISTORY_START = '2019-01-01' // provides warmup bars before 2020 analyst trades

// Mirrors runEngineSession.ts's own SESSION_MARKETS exactly (duplicated, not shared --
// same cross-file convention used elsewhere in this codebase) -- the markets that
// actually feed live opportunity generation, as opposed to the ~200 other rows in
// `markets` that are tracked but never session-active. Used only by the staleness
// guard below, to scope "is this job silently failing for a market that matters" to
// markets where it actually matters.
const SESSION_MARKET_SYMBOLS = new Set([
  'EURNZD', 'EURGBP', 'Natural Gas', 'AUDCAD', 'FTSE', 'GBPCHF', 'Silver', 'Brent', 'GBPUSD',
  'USDMXN', 'AUDJPY', 'USDTRY', 'USDCAD', 'EURJPY', 'Oil', 'USDJPY', 'CAC', 'Palladium', 'Gold',
  'EURSEK', 'AUDUSD', 'GBPJPY', 'EURCHF', 'Platinum', 'Copper', 'EURUSD', 'USDCHF', 'DAX',
  'DOW', 'SP500', 'NASDAQ', 'US2000', 'Ripple', 'Solana', 'Ethereum', 'Bitcoin', 'Litecoin',
  'CHINA A50', 'ASX200', 'GBPAUD', 'NZDJPY', 'NZDUSD', 'NIKKEI', 'EURAUD', 'GBPNZD',
])

/** `n` trading days (Mon-Fri) before `from`, as a YYYY-MM-DD string. Doesn't account for
 * market holidays -- a simple, deliberately conservative approximation so the staleness
 * guard below doesn't false-alarm every Monday on a market whose latest bar is Friday's. */
function tradingDaysAgo(n: number, from: Date = new Date()): string {
  const d = new Date(from)
  let counted = 0
  while (counted < n) {
    d.setUTCDate(d.getUTCDate() - 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) counted++
  }
  return d.toISOString().slice(0, 10)
}

// Informational/logging only -- the actual fetch call is branched below
// (fetchHistoricalOhlc vs the untouched fetchRecentOhlc) rather than unified
// through this date, so --days=N and the default 60-day path keep their
// exact existing from/to computation (fetchRecentOhlc's own `to - days*86400`
// in seconds) instead of picking up this date-truncated equivalent.
const fromDate = isHistory
  ? HISTORY_START
  : new Date(Date.now() - DAYS_TO_FETCH * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

/** Converts a getCandles() response into the sorted OhlcBar[] shape the rest of this script expects. */
function candlesToOhlcBars(candles: FinnhubCandleResponse): OhlcBar[] {
  const bars: OhlcBar[] = candles.t.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    open: candles.o[i]!, high: candles.h[i]!, low: candles.l[i]!, close: candles.c[i]!,
  }))
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return bars
}

/**
 * Aggregates Azure 5-minute bars for a single date into a synthetic daily
 * OHLC candle. Used to fill gaps left by the daily (resolution='D') table,
 * which may lag behind for forex -- the 5-minute table (resolution='5') is
 * current, so today/yesterday can be backfilled from it rather than left
 * missing until the daily bar catches up.
 */
async function fetchIntradayAsDailyBar(
  finnhubSymbol: string, date: string,
): Promise<OhlcBar | null> {
  const dayStart = Math.floor(new Date(date + 'T00:00:00Z').getTime() / 1000)
  const dayEnd   = Math.floor(new Date(date + 'T23:59:59Z').getTime() / 1000)

  const candles = await getCandles(finnhubSymbol, '5', dayStart, dayEnd)
  if (candles.s !== 'ok' || !candles.c?.length) return null

  return {
    date,
    open:  candles.o[0]!,
    high:  Math.max(...candles.h),
    low:   Math.min(...candles.l),
    close: candles.c[candles.c.length - 1]!,
  }
}

function checkCandleStatus(candles: FinnhubCandleResponse, finnhubSymbol: string): void {
  if (candles.s === 'no_mapping') {
    throw new Error(`No Azure asset mapping for "${finnhubSymbol}" (finnhub_to_acuity.csv)`)
  }
  if (candles.s !== 'ok' || !candles.c?.length) {
    throw new Error(`No price data for ${finnhubSymbol}`)
  }
}

// fix/market-state-daily: USDTRY, Solana and Litecoin's 'D'-resolution fetch started
// failing on 2026-10-21/22 (confirmed via the GitHub Actions run history: the
// 2026-10-22T21:58 populate-daily run failed outright for every market; later runs
// recovered for everything except these three, which then failed silently -- the
// per-market try/catch in main() logs a WARN but doesn't fail the job, so this went
// unnoticed for weeks) and never recovered, even after 08672f8's Azure mapping fix
// (which only touched the intraday snapshot path, not this script). Azure's 5-minute
// ('5') resolution data keeps flowing for all three throughout this window (confirmed
// directly against market_state_intraday) -- this falls back to aggregating that into
// synthetic daily candles, one day at a time, for the whole requested window, rather
// than only for today/yesterday the way the lag-fill below already does. This
// sidesteps the 'D'-resolution gap without knowing its exact Azure-side cause, which
// isn't diagnosable further without direct Azure Table Storage access (not available
// in this investigation).
async function fetchRecentOhlcWithFallback(finnhubSymbol: string, days: number): Promise<OhlcBar[]> {
  const to   = Math.floor(Date.now() / 1000)
  const from = to - days * 24 * 60 * 60
  try {
    const candles = await getCandles(finnhubSymbol, 'D', from, to)
    checkCandleStatus(candles, finnhubSymbol)
    return candlesToOhlcBars(candles)
  } catch (err) {
    console.warn(`  ${finnhubSymbol}: 'D' resolution failed (${(err as Error).message}) -- falling back to 5-min aggregation for the full window`)
    const bars: OhlcBar[] = []
    for (let d = new Date(from * 1000); d.getTime() <= to * 1000; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10)
      const bar = await fetchIntradayAsDailyBar(finnhubSymbol, dateStr)
      if (bar) bars.push(bar)
      await new Promise(r => setTimeout(r, 150))
    }
    if (bars.length === 0) throw err // nothing recovered -- surface the original error
    return bars
  }
}

/**
 * Same shape as fetchRecentOhlc(), but takes an explicit calendar `from`
 * date instead of a day-count -- used only by --history so the regular
 * --days=N / default path (fetchRecentOhlc, untouched) keeps its exact
 * existing seconds-based `to - days*86400` window.
 */
async function fetchHistoricalOhlc(finnhubSymbol: string, fromDateIso: string): Promise<OhlcBar[]> {
  const from = Math.floor(new Date(fromDateIso + 'T00:00:00Z').getTime() / 1000)
  const to   = Math.floor(Date.now() / 1000)
  const candles = await getCandles(finnhubSymbol, 'D', from, to)
  checkCandleStatus(candles, finnhubSymbol)
  return candlesToOhlcBars(candles)
}

/**
 * IC Markets-sourced instruments (currently just SA40 -- Finnhub OANDA doesn't
 * carry it, see migrations/044_markets_price_data_symbols.sql) come through
 * the same Azure daily table as everything else -- same table, same response
 * shape as fetchRecentOhlc/fetchHistoricalOhlc.
 */
async function fetchStockOhlc(finnhubSymbol: string, days: number): Promise<OhlcBar[]> {
  const to   = Math.floor(Date.now() / 1000)
  const from = to - days * 24 * 60 * 60
  const candles = await getCandles(finnhubSymbol, 'D', from, to)
  checkCandleStatus(candles, finnhubSymbol)
  return candlesToOhlcBars(candles)
}

async function main() {
  const SUPABASE_URL              = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  const requiredEnvVars = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRICES_TABLE_CONN: process.env.PRICES_TABLE_CONN }
  const missingEnvVars = Object.entries(requiredEnvVars).filter(([, v]) => !v).map(([k]) => k)
  if (missingEnvVars.length > 0) {
    console.error(`Missing required env vars: ${missingEnvVars.join(', ')}`)
    process.exit(1)
  }

  const isDryRun = process.argv.includes('--dry-run')
  const db: SupabaseClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
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
    m.price_data_provider === 'FINNHUB_OANDA' ||
    m.price_data_provider === 'FINNHUB_CRYPTO' ||
    m.price_data_provider === 'IC_MARKETS'
  )
  const skippedProviders = (marketRows ?? []).filter(m =>
    m.price_data_provider !== 'FINNHUB_OANDA' &&
    m.price_data_provider !== 'FINNHUB_CRYPTO' &&
    m.price_data_provider !== 'IC_MARKETS'
  )

  console.log(`Markets to fetch: ${markets.length}`)
  if (skippedProviders.length > 0) {
    console.log(`Skipped (other provider): ${skippedProviders.map(m => `${m.symbol}(${m.price_data_provider})`).join(', ')}\n`)
  }

  const summary = { upserted: 0, skipped: 0, errors: 0 }
  const skippedDetails: { symbol: string; reason: string }[] = []
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  for (const market of markets) {
    if (!market.price_data_symbol) {
      const reason = 'no price_data_symbol mapped'
      console.log(`  ${market.symbol}: ${reason}, skipping`)
      skippedDetails.push({ symbol: market.symbol, reason }); summary.skipped++; continue
    }
    try {
      const isICMarkets = market.price_data_provider === 'IC_MARKETS'
      const bars = isICMarkets
        ? await fetchStockOhlc(market.price_data_symbol, DAYS_TO_FETCH)
        : isHistory
          ? await fetchHistoricalOhlc(market.price_data_symbol, HISTORY_START)
          : await fetchRecentOhlcWithFallback(market.price_data_symbol, DAYS_TO_FETCH)

      // The daily table may lag 1-2 days; fill today/yesterday from 5-minute
      // bars when the daily table hasn't caught up yet. Only fills genuinely
      // missing dates -- never replaces a real daily candle. IC Markets has no
      // equivalent lag observed -- skipped entirely.
      const syntheticDates = new Set<string>()
      if (!isICMarkets) {
        const existingDates = new Set(bars.map(b => b.date))
        for (const date of [yesterday, today]) {
          if (existingDates.has(date)) continue
          const syntheticBar = await fetchIntradayAsDailyBar(market.price_data_symbol, date)
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
        const reason = `insufficient bars (${bars.length} < ${ATR_PERIOD_PRIMARY})`
        console.log(`  ${market.symbol}: ${reason}, skipping`)
        skippedDetails.push({ symbol: market.symbol, reason }); summary.skipped++; continue
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
          const reason = `upsert error -- ${error.message}`
          console.error(`  ${market.symbol}: ${reason}`)
          skippedDetails.push({ symbol: market.symbol, reason }); summary.errors++; continue
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
      const reason = (err as Error).message
      console.error(`  ${market.symbol}: ${reason}`)
      skippedDetails.push({ symbol: market.symbol, reason }); summary.errors++
    }
    await new Promise(r => setTimeout(r, isHistory ? 200 : 150))
  }

  if (skippedDetails.length > 0) {
    console.warn('\n=== SKIPPED / FAILED MARKETS ===')
    for (const { symbol, reason } of skippedDetails) {
      console.warn(`  WARN: ${symbol} -- ${reason}`)
    }
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

  // Staleness guard (fix/market-state-daily): the check above only catches a TOTAL
  // failure (every market errored). It did not catch -- and for weeks didn't notice --
  // USDTRY/Solana/Litecoin's 'D'-resolution fetch failing every single run while every
  // other market kept succeeding: the job kept exiting 0 (success) the whole time,
  // because `summary.upserted` was never zero. This checks the DB's actual current
  // state after the run, independent of what this run itself did, and fails the job if
  // any live-session market's latest row is stale -- the exact signal that would have
  // caught this incident on day 1 instead of after ~3 weeks.
  if (!isDryRun && !isHistory) {
    const cutoff = tradingDaysAgo(2)
    const sessionMarkets = markets.filter(m => SESSION_MARKET_SYMBOLS.has(m.symbol))
    const staleMarkets: { symbol: string; latest: string }[] = []
    for (const m of sessionMarkets) {
      const { data: latestRow } = await db
        .from('market_state_daily')
        .select('date')
        .eq('market_id', m.market_id)
        .order('date', { ascending: false })
        .limit(1)
      const latest = latestRow?.[0]?.date ?? 'NEVER'
      if (latest === 'NEVER' || latest < cutoff) staleMarkets.push({ symbol: m.symbol, latest })
    }
    if (staleMarkets.length > 0) {
      console.error(`\n=== STALE DATA GUARD (cutoff: ${cutoff}, 2 trading days) ===`)
      for (const m of staleMarkets) console.error(`  STALE: ${m.symbol} -- latest market_state_daily row: ${m.latest}`)
      console.error(`${staleMarkets.length} live-session market(s) have no fresh market_state_daily row -- exiting with code 1`)
      process.exit(1)
    }
  }
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
