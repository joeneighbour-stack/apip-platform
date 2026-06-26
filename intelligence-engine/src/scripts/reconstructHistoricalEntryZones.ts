// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Phase 1.5 Step 2a — Historical Entry Zone Reconstruction
// ============================================================================
// Per APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md Section 1.5 (Amendment 2),
// bounded to the pilot's confirmed scope: the 15 markets the coverage pilot
// verified, and ONLY for trades published on or after 2018-04-18 (the real,
// empirically-found earliest date Finnhub's OANDA feed has for ANY of these
// 15 instruments -- not assumed, found by running finnhub-coverage-pilot.js
// against the real API).
//
// CRITICAL: this script imports and calls buildMarketState() from
// marketStateService.ts UNMODIFIED. It does not reimplement the ATR/zone
// formula. The only new logic here is *slicing* the OHLC series to end at
// each historical trade's date before calling that already-tested function
// -- buildMarketState always treats "the last bar in the series it's given"
// as the reference point, so correct slicing is sufficient, no changes to
// the verified service are needed or made.
//
// This script WRITES to actual_trades, via apply_historical_entry_zone()
// (029_entry_zone_reconstruction_function.sql) -- never a raw UPDATE.
// That function is idempotent (never overwrites an existing entry_zone),
// so this script is safe to re-run.
//
// Run (dry run strongly recommended first):
//   npx tsx src/scripts/reconstructHistoricalEntryZones.ts --dry-run
//   npx tsx src/scripts/reconstructHistoricalEntryZones.ts
//
// Required environment variables:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildMarketState, type OhlcBar } from '../services/marketStateService.js';

// Confirmed by finnhub-coverage-pilot.js -- real evidence, not assumed.
const PILOT_BOUNDARY_DATE = '2018-04-18';
const ATR_PERIOD = 14;
const ZONE_COUNT = 4;

// The 15 markets the pilot confirmed working, with their resolved Finnhub symbols.
const CONFIRMED_MARKETS: { symbol: string; finnhubSymbol: string }[] = [
  { symbol: 'Oil', finnhubSymbol: 'OANDA:WTICO_USD' },
  { symbol: 'DOW', finnhubSymbol: 'OANDA:US30_USD' },
  { symbol: 'EURGBP', finnhubSymbol: 'OANDA:EUR_GBP' },
  { symbol: 'DAX', finnhubSymbol: 'OANDA:DE30_EUR' },
  { symbol: 'GBPUSD', finnhubSymbol: 'OANDA:GBP_USD' },
  { symbol: 'USDCAD', finnhubSymbol: 'OANDA:USD_CAD' },
  { symbol: 'EURUSD', finnhubSymbol: 'OANDA:EUR_USD' },
  { symbol: 'NASDAQ', finnhubSymbol: 'OANDA:NAS100_USD' },
  { symbol: 'SP500', finnhubSymbol: 'OANDA:SPX500_USD' },
  { symbol: 'USDCHF', finnhubSymbol: 'OANDA:USD_CHF' },
  { symbol: 'Gold', finnhubSymbol: 'OANDA:XAU_USD' },
  { symbol: 'CAC', finnhubSymbol: 'OANDA:FR40_EUR' },
  { symbol: 'FTSE', finnhubSymbol: 'OANDA:UK100_GBP' },
  { symbol: 'EURCHF', finnhubSymbol: 'OANDA:EUR_CHF' },
  { symbol: 'Copper', finnhubSymbol: 'OANDA:XCU_USD' },
];

// db, FINNHUB_API_KEY, and isDryRun are assigned inside main(), not at
// module load time -- so this file can be imported for unit testing (e.g.
// findLastBarIndexOnOrBefore) without requiring real credentials present.
let db: SupabaseClient;
let FINNHUB_API_KEY: string;
let isDryRun: boolean;

interface FinnhubCandleResponse { c: number[]; h: number[]; l: number[]; o: number[]; t: number[]; s: string; }

async function fetchFullHistory(finnhubSymbol: string, fromDate: string): Promise<OhlcBar[]> {
  const from = Math.floor(new Date(fromDate).getTime() / 1000);
  const to = Math.floor(Date.now() / 1000);
  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Finnhub HTTP ${response.status} for ${finnhubSymbol}`);
  const body: FinnhubCandleResponse = await response.json();
  if (body.s !== 'ok' || !body.c?.length) throw new Error(`Finnhub returned status '${body.s}' for ${finnhubSymbol}, no usable candles`);

  const bars: OhlcBar[] = body.t.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    open: body.o[i]!, high: body.h[i]!, low: body.l[i]!, close: body.c[i]!,
  }));
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return bars;
}

/**
 * Finds the index of the latest bar with date <= targetDate. Returns -1 if
 * no such bar exists (target predates the entire series).
 */
export function findLastBarIndexOnOrBefore(bars: OhlcBar[], targetDate: string): number {
  let result = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i]!.date <= targetDate) result = i;
    else break; // bars are sorted ascending -- once we pass targetDate, stop
  }
  return result;
}

interface TradeRow { trade_id: string; published_at: string; entry: number; }

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !finnhubKey) {
    console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and FINNHUB_API_KEY must all be set.');
    process.exit(1);
  }
  FINNHUB_API_KEY = finnhubKey;
  isDryRun = process.argv.includes('--dry-run');
  db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  console.log(`Mode: ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE (will write to actual_trades)'}`);
  console.log(`Boundary date: ${PILOT_BOUNDARY_DATE} (confirmed by finnhub-coverage-pilot.js, not assumed)\n`);

  const overallSummary = { reconstructed: 0, skippedInsufficientHistory: 0, skippedNullAtr: 0, skippedPreBoundary: 0 };

  for (const market of CONFIRMED_MARKETS) {
    console.log(`--- ${market.symbol} ---`);

    const { data: marketRow, error: marketError } = await db
      .from('markets').select('market_id').eq('symbol', market.symbol).single();
    if (marketError || !marketRow) {
      console.error(`  Could not resolve market_id for '${market.symbol}': ${marketError?.message}. Skipping.`);
      continue;
    }

    let ohlc: OhlcBar[];
    try {
      ohlc = await fetchFullHistory(market.finnhubSymbol, PILOT_BOUNDARY_DATE);
    } catch (err) {
      console.error(`  Failed to fetch OHLC for ${market.finnhubSymbol}: ${(err as Error).message}. Skipping.`);
      continue;
    }
    console.log(`  Fetched ${ohlc.length} daily bars (${ohlc[0]?.date} to ${ohlc[ohlc.length - 1]?.date}).`);

    const { data: trades, error: tradesError } = await db
      .from('actual_trades')
      .select('trade_id, published_at, entry')
      .eq('market_id', marketRow.market_id)
      .is('entry_zone', null) // idempotent at the query level too -- skip already-processed rows entirely
      .gte('published_at', PILOT_BOUNDARY_DATE);

    if (tradesError) {
      console.error(`  Failed to load actual_trades: ${tradesError.message}. Skipping.`);
      continue;
    }

    console.log(`  ${trades?.length ?? 0} trades with entry_zone still NULL, published on/after the boundary date.`);

    let reconstructed = 0, skippedInsufficient = 0, skippedNullAtr = 0;

    for (const trade of (trades ?? []) as TradeRow[]) {
      const tradeDate = trade.published_at.slice(0, 10);
      const barIndex = findLastBarIndexOnOrBefore(ohlc, tradeDate);

      if (barIndex < ATR_PERIOD - 1) {
        // Not enough preceding bars to compute a 14-period ATR ending at
        // this trade's date -- genuinely insufficient history, not a bug.
        skippedInsufficient++;
        continue;
      }

      const windowedSeries = ohlc.slice(0, barIndex + 1);
      const result = buildMarketState({
        marketId: marketRow.market_id,
        ohlcSeries: windowedSeries,
        currentPrice: { price: trade.entry, capturedAt: trade.published_at },
        parameters: { atrPeriod: ATR_PERIOD, zoneCount: ZONE_COUNT },
      });

      if (result.currentZone === null) {
        skippedNullAtr++;
        continue;
      }

      if (!isDryRun) {
        const { error: rpcError } = await db.rpc('apply_historical_entry_zone', {
          p_trade_id: trade.trade_id, p_entry_zone: result.currentZone,
        });
        if (rpcError) {
          console.error(`  RPC error for trade ${trade.trade_id}: ${rpcError.message}`);
          continue;
        }
      }
      reconstructed++;
    }

    console.log(`  Reconstructed: ${reconstructed}, skipped (insufficient history): ${skippedInsufficient}, skipped (null ATR): ${skippedNullAtr}\n`);
    overallSummary.reconstructed += reconstructed;
    overallSummary.skippedInsufficientHistory += skippedInsufficient;
    overallSummary.skippedNullAtr += skippedNullAtr;

    await new Promise((r) => setTimeout(r, 250)); // gentle pacing between markets' Finnhub calls
  }

  console.log('=== OVERALL SUMMARY ===');
  console.log(JSON.stringify(overallSummary, null, 2));
  if (isDryRun) console.log('\nDRY RUN -- nothing was written. Re-run without --dry-run to apply.');
}

// Only run main() when this file is executed directly (npx tsx ...), not
// when imported as a module -- e.g. by the test suite, which imports
// findLastBarIndexOnOrBefore alone and must not trigger the script's
// full execution (including its env-var validation and process.exit) as
// a side effect of that import. Uses fileURLToPath + path.resolve rather
// than naive string comparison, since import.meta.url (a file:// URL,
// forward-slashed and percent-encoded) and process.argv[1] (a plain OS
// path, backslashed on Windows) do not compare reliably as raw strings.
const thisFilePath = fileURLToPath(import.meta.url);
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(thisFilePath);
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
