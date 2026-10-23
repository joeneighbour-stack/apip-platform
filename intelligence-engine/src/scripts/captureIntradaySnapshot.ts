// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Intraday Market State Snapshot Script
// ============================================================================
// Captures current APIP session high/low from Azure Table Storage 5-minute
// OHLC bars (see src/lib/azurePrices.ts -- drop-in replacement for the old
// Finnhub forex/crypto candle endpoints), derives previous_close from the
// final bar before session open, loads ATR20 from market_state_daily, applies
// Pine-style band construction, and writes to market_state_intraday.
//
// APIP SESSION BOUNDARY:
//   Sessions open at 22:00 UTC (17:00 America/New_York, DST-aware).
//   Bars at/after this timestamp belong to the CURRENT session.
//   The final 5-min bar BEFORE this timestamp supplies previous_close.
//
// BAND FORMULA (Pine-style, locked):
//   bottom_anchor = min(previous_close, today_low_so_far)
//   top_anchor    = max(previous_close, today_high_so_far)
//   upper_band    = bottom_anchor + previous_atr20
//   lower_band    = top_anchor    - previous_atr20
//
// DATA SOURCES:
//   previous_close, session h/l: Azure Table Storage 5-min bars (PRICES_TABLE_CONN)
//   previous_atr20:              market_state_daily.atr20 (Wilder RMA period 20)
//   current_price:               last 5-min bar close (same Azure source)
//
// TEMPORARY FINNHUB FALLBACK (2026-10-23):
//   finnhub_to_acuity.csv has no AssetId mapping for several symbols still
//   referenced by live markets (e.g. the US session's 5 crypto markets).
//   When Azure returns `no_mapping` for a symbol, and FINNHUB_CANDLE_API_KEY /
//   FINNHUB_API_KEY are set, this script falls back to the old direct-Finnhub
//   candle/quote fetch for that symbol only, loudly logged. Remove this once
//   finnhub_to_acuity.csv has confirmed entries for every live market.
//
// Run:
//   npx tsx src/scripts/captureIntradaySnapshot.ts --session=EUROPEAN
//   npx tsx src/scripts/captureIntradaySnapshot.ts --session=US
//   npx tsx src/scripts/captureIntradaySnapshot.ts --session=APAC
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   PRICES_TABLE_CONN   Azure Table Storage connection string (see
//                       src/lib/azurePrices.ts)
// Optional env vars (temporary Finnhub fallback, see above):
//   FINNHUB_API_KEY, FINNHUB_CANDLE_API_KEY
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildMarketState } from '../services/marketStateService.js'
import { getCandles } from '../lib/azurePrices.js'

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

interface ApipSessionResult {
  previousClose: number;
  sessionHigh: number;
  sessionLow: number;
  currentPrice: number;
  barCount: number;
  provenance?: 'AZURE' | 'FINNHUB_CANDLE' | 'FINNHUB_QUOTE_FALLBACK';
}

interface FinnhubQuote { c: number; h: number; l: number; o: number; t: number }
interface FinnhubCandle { c: number[]; h: number[]; l: number[]; o: number[]; t: number[]; s: string }

/**
 * Returns the Unix timestamp (seconds) of the most recent APIP session open
 * (22:00 UTC on the current or previous calendar day).
 * If current UTC hour >= 22: session opened today at 22:00 UTC.
 * If current UTC hour < 22:  session opened yesterday at 22:00 UTC.
 */
function currentApipSessionOpenTs(): number {
  const now = new Date();
  const sessionOpen = new Date(now);
  sessionOpen.setUTCHours(22, 0, 0, 0);
  if (now.getUTCHours() < 22) {
    sessionOpen.setUTCDate(sessionOpen.getUTCDate() - 1);
  }
  return Math.floor(sessionOpen.getTime() / 1000);
}

/** Splits a candle response into previousClose/session h-l/currentPrice, shared by the Azure and Finnhub-fallback paths. */
function candlesToSessionResult(
  candles: { t: number[]; o: number[]; h: number[]; l: number[]; c: number[] },
  sessionOpenTs: number,
  provenance: ApipSessionResult['provenance'],
): ApipSessionResult {
  const preBars:  { ts: number; c: number }[] = [];
  const sessH: number[] = [];
  const sessL: number[] = [];
  let latestC = 0;

  for (let i = 0; i < candles.t.length; i++) {
    const ts = candles.t[i]!;
    const c  = candles.c[i]!;
    const h  = candles.h[i]!;
    const l  = candles.l[i]!;
    latestC = c;
    if (ts < sessionOpenTs) {
      preBars.push({ ts, c });
    } else {
      sessH.push(h);
      sessL.push(l);
    }
  }

  const previousClose = preBars.length > 0
    ? preBars[preBars.length - 1]!.c
    : (sessH.length > 0 ? candles.c[0]! : latestC); // fallback: first in-session bar open

  if (sessH.length === 0) {
    // Session hasn't started yet — treat latest bar as current
    return {
      previousClose,
      sessionHigh: candles.h[candles.h.length - 1]!,
      sessionLow:  candles.l[candles.l.length - 1]!,
      currentPrice: latestC,
      barCount: 0,
      provenance,
    };
  }

  return {
    previousClose,
    sessionHigh: Math.max(...sessH),
    sessionLow:  Math.min(...sessL),
    currentPrice: latestC,
    barCount: sessH.length,
    provenance,
  };
}

/**
 * TEMPORARY (2026-10-23): direct Finnhub candle/quote fetch, used only when
 * Azure has no asset mapping for this symbol. See the file header for why.
 * Ported from the pre-migration version of this script (git history: d87bdfa^).
 */
async function fetchFinnhubFallback(
  finnhubSymbol: string,
  isCrypto: boolean,
  candleApiKey: string | undefined,
  quoteApiKey: string,
  sessionOpenTs: number,
): Promise<ApipSessionResult> {
  const toTs = Math.floor(Date.now() / 1000);
  const fromTs = sessionOpenTs - 3600;

  if (candleApiKey) {
    const endpoint = isCrypto
      ? `https://finnhub.io/api/v1/crypto/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=5&from=${fromTs}&to=${toTs}&token=${candleApiKey}`
      : `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=5&from=${fromTs}&to=${toTs}&token=${candleApiKey}`;
    const res = await fetch(endpoint);
    if (res.ok) {
      const body: FinnhubCandle = await res.json();
      if (body.s === 'ok' && body.t?.length > 0) {
        return candlesToSessionResult(body, sessionOpenTs, 'FINNHUB_CANDLE');
      }
    }
  }

  // Fallback: quote endpoint (midnight-UTC boundary -- approximate)
  const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${quoteApiKey}`;
  const qRes = await fetch(quoteUrl);
  if (!qRes.ok) throw new Error(`Finnhub quote HTTP ${qRes.status}`);
  const q: FinnhubQuote = await qRes.json();
  if (!q.c || q.c === 0) throw new Error(`No price for ${finnhubSymbol} (Finnhub quote fallback)`);
  return {
    previousClose: q.c,
    sessionHigh: q.h > 0 ? q.h : q.c,
    sessionLow:  q.l > 0 ? q.l : q.c,
    currentPrice: q.c,
    barCount: -1, // -1 signals quote fallback
    provenance: 'FINNHUB_QUOTE_FALLBACK',
  };
}

/**
 * Fetches Azure Table Storage 5-minute bars for the current APIP session.
 * Returns previousClose (last bar before session open), session high/low,
 * and current price (last bar close). Falls back to Finnhub (see file header)
 * when Azure has no asset mapping for this symbol and Finnhub keys are set.
 */
async function fetchApipSessionBars(
  finnhubSymbol: string,
  isCrypto: boolean,
  finnhubCandleApiKey: string | undefined,
  finnhubQuoteApiKey: string | undefined,
): Promise<ApipSessionResult> {
  const sessionOpenTs = currentApipSessionOpenTs();
  const toTs = Math.floor(Date.now() / 1000);
  // Fetch from 1h before session open to capture the prev-close bar
  const fromTs = sessionOpenTs - 3600;

  const candles = await getCandles(finnhubSymbol, '5', fromTs, toTs);

  if (candles.s === 'no_mapping') {
    if (!finnhubQuoteApiKey) {
      throw new Error(`No Azure asset mapping for "${finnhubSymbol}" (finnhub_to_acuity.csv), and no FINNHUB_API_KEY set for fallback`);
    }
    console.warn(`  WARN: ${finnhubSymbol}: no Azure mapping, falling back to Finnhub (TEMPORARY -- see file header)`);
    return fetchFinnhubFallback(finnhubSymbol, isCrypto, finnhubCandleApiKey, finnhubQuoteApiKey, sessionOpenTs);
  }
  if (candles.s !== 'ok' || !candles.t.length) {
    throw new Error(`No price data for ${finnhubSymbol}`);
  }

  return candlesToSessionResult(candles, sessionOpenTs, 'AZURE');
}

async function main() {
  const SUPABASE_URL              = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  // Optional -- only used as a fallback when Azure has no mapping for a symbol (see file header).
  const FINNHUB_API_KEY           = process.env.FINNHUB_API_KEY
  const FINNHUB_CANDLE_API_KEY    = process.env.FINNHUB_CANDLE_API_KEY
  if (!FINNHUB_API_KEY) {
    console.warn('FINNHUB_API_KEY not set -- markets with no Azure mapping will fail instead of falling back to Finnhub\n')
  }

  const requiredEnvVars = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRICES_TABLE_CONN: process.env.PRICES_TABLE_CONN }
  const missingEnvVars = Object.entries(requiredEnvVars).filter(([, v]) => !v).map(([k]) => k)
  if (missingEnvVars.length > 0) {
    console.error(`Missing: ${missingEnvVars.join(', ')}`)
    process.exit(1)
  }

  const isDryRun    = process.argv.includes('--dry-run')
  const sessionArg  = process.argv.find(a => a.startsWith('--session='))?.split('=')[1]
  const session     = (sessionArg ?? 'EUROPEAN').toUpperCase() as 'EUROPEAN' | 'US' | 'APAC'

  if (!SESSION_MARKETS[session]) {
    console.error(`Unknown session: ${session}. Use EUROPEAN, US, or APAC.`)
    process.exit(1)
  }

  const db: SupabaseClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false }
  })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Session: ${session}`)
  console.log(`APIP session open: ${new Date(currentApipSessionOpenTs() * 1000).toISOString()}\n`)

  const capturedAt     = new Date().toISOString()
  const sessionSymbols = SESSION_MARKETS[session]!

  // Load market metadata
  const { data: marketRows } = await db
    .from('markets')
    .select('market_id, symbol, price_data_provider, price_data_symbol')
    .in('symbol', sessionSymbols)

  const marketBySymbol = new Map((marketRows ?? []).map(m => [m.symbol, m]))

  // Load latest ATR20 from market_state_daily for each market
  // Use a single query across all market IDs
  const marketIds = (marketRows ?? []).map(m => m.market_id)
  const { data: atrRows } = await db
    .from('market_state_daily')
    .select('market_id, date, close, atr20')
    .in('market_id', marketIds)
    .not('atr20', 'is', null)
    .order('date', { ascending: false })

  // Keep only the latest atr20 per market
  const atr20ByMarketId = new Map<string, { atr20: number; date: string; close: number }>()
  for (const row of (atrRows ?? [])) {
    if (!atr20ByMarketId.has(row.market_id)) {
      atr20ByMarketId.set(row.market_id, {
        atr20: Number(row.atr20),
        date: row.date,
        close: Number(row.close),
      })
    }
  }

  const summary = { captured: 0, skipped: 0, errors: 0 }
  const skippedDetails: { symbol: string; reason: string }[] = []

  for (const symbol of sessionSymbols) {
    const market = marketBySymbol.get(symbol)
    if (!market) {
      const reason = 'not found in markets table'
      console.log(`  ${symbol}: ${reason}, skipping`)
      skippedDetails.push({ symbol, reason }); summary.skipped++; continue
    }
    if (!market.price_data_symbol) {
      const reason = 'no price_data_symbol mapped'
      console.log(`  ${symbol}: ${reason}, skipping`)
      skippedDetails.push({ symbol, reason }); summary.skipped++; continue
    }
    if (market.price_data_provider === 'IC_MARKETS') {
      const reason = 'IC Markets provider -- manual feed required'
      console.log(`  ${symbol}: ${reason}, skipping`)
      skippedDetails.push({ symbol, reason }); summary.skipped++; continue
    }

    const dailyAtr = atr20ByMarketId.get(market.market_id)
    if (!dailyAtr?.atr20) {
      const reason = 'no atr20 in market_state_daily (run populate first)'
      console.log(`  ${symbol}: ${reason}, skipping`)
      skippedDetails.push({ symbol, reason }); summary.skipped++; continue
    }

    try {
      const isCrypto = market.price_data_provider === 'FINNHUB_CRYPTO'
      const sess = await fetchApipSessionBars(market.price_data_symbol, isCrypto, FINNHUB_CANDLE_API_KEY, FINNHUB_API_KEY)

      // Pine-style band construction
      const bottomAnchor = Math.min(sess.previousClose, sess.sessionLow)
      const topAnchor    = Math.max(sess.previousClose, sess.sessionHigh)
      const upperBand    = bottomAnchor + dailyAtr.atr20
      const lowerBand    = topAnchor    - dailyAtr.atr20

      // Use buildMarketState with sessionAnchors + precomputedAtr20
      const state = buildMarketState({
        marketId: market.market_id,
        ohlcSeries: [],   // not needed when precomputedAtr20 is supplied
        currentPrice: { price: sess.currentPrice, capturedAt },
        parameters: { atrPeriod: 20, zoneCount: ZONE_COUNT },
        sessionAnchors: {
          previousClose:   sess.previousClose,
          todayHighSoFar:  sess.sessionHigh,
          todayLowSoFar:   sess.sessionLow,
          precomputedAtr20: dailyAtr.atr20,
        },
      })

      if (!state.currentZone) {
        const reason = 'could not determine zone'
        console.log(`  ${symbol}: ${reason}, skipping`)
        skippedDetails.push({ symbol, reason }); summary.skipped++; continue
      }

      const row = {
        market_id:     market.market_id,
        session,
        captured_at:   capturedAt,
        current_price: sess.currentPrice,
        current_zone:  state.currentZone,
        session_high:  sess.sessionHigh,
        session_low:   sess.sessionLow,
        previous_close: sess.previousClose,
      }

      if (!isDryRun) {
        const { error } = await db.from('market_state_intraday').insert(row)
        if (error) {
          const reason = `insert error -- ${error.message}`
          console.error(`  ${symbol}: ${reason}`)
          skippedDetails.push({ symbol, reason }); summary.errors++; continue
        }
      }

      console.log(
        `  ${symbol}: price=${sess.currentPrice}, zone=${state.currentZone}` +
        `, h=${sess.sessionHigh}, l=${sess.sessionLow}` +
        `, prevClose=${sess.previousClose}, atr20=${dailyAtr.atr20.toFixed(5)}` +
        ` [${sess.barCount} bars]` +
        (sess.provenance && sess.provenance !== 'AZURE' ? ` (source: ${sess.provenance})` : '')
      )
      summary.captured++
    } catch (err) {
      const reason = (err as Error).message
      console.error(`  ${symbol}: ${reason}`)
      skippedDetails.push({ symbol, reason }); summary.errors++
    }

    await new Promise(r => setTimeout(r, 200))
  }

  if (skippedDetails.length > 0) {
    console.warn('\n=== SKIPPED / FAILED MARKETS ===')
    for (const { symbol, reason } of skippedDetails) {
      console.warn(`  WARN: ${symbol} -- ${reason}`)
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Captured: ${summary.captured}`)
  console.log(`Skipped:  ${summary.skipped}`)
  console.log(`Errors:   ${summary.errors}`)
  if (isDryRun) console.log('\nDRY RUN -- nothing written.')
  if (!isDryRun && summary.errors > 0 && summary.captured === 0) {
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
