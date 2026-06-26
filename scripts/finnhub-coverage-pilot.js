// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Phase 1.5 Step 2a — Finnhub Historical Coverage Pilot
// ============================================================================
// Per APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md Section 1.5 (Amendment 2):
// this is an INVESTIGATION, not a commitment to reconstruct historical
// entry zones at scale. It tests the real top-15 markets by trade volume
// (from a live query against actual_trades, not assumed), across the asset
// classes the feasibility table flagged different confidence levels for.
//
// CRITICAL: this script distinguishes HTTP 403 (API tier/paywall restriction)
// from an empty/short response (symbol mapping or genuine coverage gap).
// These are two different problems with two different fixes, and conflating
// them would produce a misleading report. Some sources indicate Finnhub may
// restrict historical stock/index candles on lower API tiers -- this has NOT
// been confirmed against Joe's actual account/tier, hence testing rather
// than assuming.
//
// This script writes NOTHING to the database. It is read-only against
// Finnhub and produces a coverage report only.
//
// Run:
//   node scripts/finnhub-coverage-pilot.js
//
// Required environment variable:
//   FINNHUB_API_KEY
// ============================================================================

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
if (!FINNHUB_API_KEY) {
  console.error("FINNHUB_API_KEY must be set as an environment variable.");
  process.exit(1);
}

// Real top-15 markets by actual_trades volume (queried directly against
// staging, not assumed) plus candidate symbol formats to test per market.
// Multiple candidates per market reflect genuine uncertainty about Finnhub's
// correct symbol convention for indices/commodities -- this pilot's job is
// to find out which (if any) actually works, not to assert one in advance.
const PILOT_MARKETS = [
  { symbol: 'Oil', tradeCount: 900, assetClass: 'COMMODITY', candidates: [
    { format: 'oanda_commodity', finnhubSymbol: 'OANDA:WTICO_USD', endpoint: 'forex' },
  ]},
  { symbol: 'DOW', tradeCount: 879, assetClass: 'INDEX', candidates: [
    { format: 'oanda_index', finnhubSymbol: 'OANDA:US30_USD', endpoint: 'forex' },
    { format: 'etf_proxy', finnhubSymbol: 'DIA', endpoint: 'stock' },
    { format: 'caret_index', finnhubSymbol: '^DJI', endpoint: 'stock' },
  ]},
  { symbol: 'EURGBP', tradeCount: 856, assetClass: 'FX', candidates: [
    { format: 'oanda_fx', finnhubSymbol: 'OANDA:EUR_GBP', endpoint: 'forex' },
  ]},
  { symbol: 'DAX', tradeCount: 854, assetClass: 'INDEX', candidates: [
    { format: 'oanda_index', finnhubSymbol: 'OANDA:DE30_EUR', endpoint: 'forex' },
    { format: 'caret_index', finnhubSymbol: '^GDAXI', endpoint: 'stock' },
  ]},
  { symbol: 'GBPUSD', tradeCount: 835, assetClass: 'FX', candidates: [
    { format: 'oanda_fx', finnhubSymbol: 'OANDA:GBP_USD', endpoint: 'forex' },
  ]},
  { symbol: 'USDCAD', tradeCount: 830, assetClass: 'FX', candidates: [
    { format: 'oanda_fx', finnhubSymbol: 'OANDA:USD_CAD', endpoint: 'forex' },
  ]},
  { symbol: 'EURUSD', tradeCount: 817, assetClass: 'FX', candidates: [
    { format: 'oanda_fx_confirmed', finnhubSymbol: 'OANDA:EUR_USD', endpoint: 'forex' }, // already proven working
  ]},
  { symbol: 'NASDAQ', tradeCount: 810, assetClass: 'INDEX', candidates: [
    { format: 'oanda_index', finnhubSymbol: 'OANDA:NAS100_USD', endpoint: 'forex' },
    { format: 'etf_proxy', finnhubSymbol: 'QQQ', endpoint: 'stock' },
    { format: 'caret_index', finnhubSymbol: '^IXIC', endpoint: 'stock' },
  ]},
  { symbol: 'SP500', tradeCount: 800, assetClass: 'INDEX', candidates: [
    { format: 'oanda_index', finnhubSymbol: 'OANDA:SPX500_USD', endpoint: 'forex' },
    { format: 'etf_proxy', finnhubSymbol: 'SPY', endpoint: 'stock' },
    { format: 'caret_index', finnhubSymbol: '^GSPC', endpoint: 'stock' },
  ]},
  { symbol: 'USDCHF', tradeCount: 799, assetClass: 'FX', candidates: [
    { format: 'oanda_fx', finnhubSymbol: 'OANDA:USD_CHF', endpoint: 'forex' },
  ]},
  { symbol: 'Gold', tradeCount: 784, assetClass: 'COMMODITY', candidates: [
    { format: 'oanda_commodity', finnhubSymbol: 'OANDA:XAU_USD', endpoint: 'forex' },
  ]},
  { symbol: 'CAC', tradeCount: 784, assetClass: 'INDEX', candidates: [
    { format: 'oanda_index', finnhubSymbol: 'OANDA:FR40_EUR', endpoint: 'forex' },
    { format: 'caret_index', finnhubSymbol: '^FCHI', endpoint: 'stock' },
  ]},
  { symbol: 'FTSE', tradeCount: 777, assetClass: 'INDEX', candidates: [
    { format: 'oanda_index', finnhubSymbol: 'OANDA:UK100_GBP', endpoint: 'forex' },
    { format: 'caret_index', finnhubSymbol: '^FTSE', endpoint: 'stock' },
  ]},
  { symbol: 'EURCHF', tradeCount: 769, assetClass: 'FX', candidates: [
    { format: 'oanda_fx', finnhubSymbol: 'OANDA:EUR_CHF', endpoint: 'forex' },
  ]},
  { symbol: 'Copper', tradeCount: 767, assetClass: 'COMMODITY', candidates: [
    { format: 'oanda_commodity', finnhubSymbol: 'OANDA:XCU_USD', endpoint: 'forex' },
  ]},
];

// Test a 30-day-ago-to-today window first (cheap, fast signal on whether the
// symbol/endpoint resolves at all) before attempting a deep historical pull.
// A market that fails even this recent-window test has no point being tested
// further back -- that's a symbol or access problem, not a depth problem.
const RECENT_WINDOW_DAYS = 30;
// Then, ONLY for symbols that pass the recent-window test, attempt a real
// historical depth probe: how far back does data actually go.
const DEPTH_PROBE_YEARS_AGO = 9; // 2017, matching the backfill's earliest year

async function fetchCandles(finnhubSymbol, endpoint, fromUnix, toUnix) {
  const path = endpoint === 'forex' ? 'forex/candle' : 'stock/candle';
  const url = `https://finnhub.io/api/v1/${path}?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=D&from=${fromUnix}&to=${toUnix}&token=${FINNHUB_API_KEY}`;
  const response = await fetch(url);
  const status = response.status;
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status, body };
}

function summarizeResult(status, body) {
  if (status === 403) return { outcome: 'FORBIDDEN_403', detail: 'API tier/access restriction -- NOT a symbol problem' };
  if (status !== 200) return { outcome: 'HTTP_ERROR', detail: `HTTP ${status}` };
  if (!body || body.s !== 'ok' || !Array.isArray(body.c) || body.c.length === 0) {
    return { outcome: 'EMPTY_OR_NO_DATA', detail: body ? `response status field: '${body.s}'` : 'unparseable response' };
  }
  return { outcome: 'SUCCESS', detail: `${body.c.length} candles returned` };
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const recentFrom = now - RECENT_WINDOW_DAYS * 24 * 60 * 60;
  const deepFrom = now - DEPTH_PROBE_YEARS_AGO * 365 * 24 * 60 * 60;

  const report = [];

  for (const market of PILOT_MARKETS) {
    console.log(`\n--- ${market.symbol} (${market.assetClass}, ${market.tradeCount} trades) ---`);
    let workingCandidate = null;

    for (const candidate of market.candidates) {
      const { status, body } = await fetchCandles(candidate.finnhubSymbol, candidate.endpoint, recentFrom, now);
      const summary = summarizeResult(status, body);
      console.log(`  [recent-window] ${candidate.finnhubSymbol} (${candidate.endpoint}): ${summary.outcome} -- ${summary.detail}`);
      await new Promise((r) => setTimeout(r, 250)); // gentle on Finnhub's rate limit

      if (summary.outcome === 'SUCCESS') {
        workingCandidate = candidate;
        break; // first working candidate wins -- no need to test the rest
      }
    }

    if (!workingCandidate) {
      report.push({ symbol: market.symbol, assetClass: market.assetClass, tradeCount: market.tradeCount, status: 'NO_WORKING_SYMBOL_FOUND', depthYears: null, finnhubSymbol: null });
      continue;
    }

    // Recent window works -- now probe actual historical depth.
    const { status: deepStatus, body: deepBody } = await fetchCandles(workingCandidate.finnhubSymbol, workingCandidate.endpoint, deepFrom, now);
    const deepSummary = summarizeResult(deepStatus, deepBody);
    console.log(`  [depth probe, ${DEPTH_PROBE_YEARS_AGO}y] ${workingCandidate.finnhubSymbol}: ${deepSummary.outcome} -- ${deepSummary.detail}`);

    let earliestDate = null;
    if (deepSummary.outcome === 'SUCCESS' && deepBody.t && deepBody.t.length > 0) {
      earliestDate = new Date(deepBody.t[0] * 1000).toISOString().slice(0, 10);
    }

    report.push({
      symbol: market.symbol, assetClass: market.assetClass, tradeCount: market.tradeCount,
      status: deepSummary.outcome, finnhubSymbol: workingCandidate.finnhubSymbol,
      earliestDateFound: earliestDate,
    });

    await new Promise((r) => setTimeout(r, 250));
  }

  console.log('\n\n=== COVERAGE REPORT ===');
  console.log(JSON.stringify(report, null, 2));

  const summary = {
    totalMarkets: report.length,
    fullyResolved: report.filter((r) => r.status === 'SUCCESS').length,
    noWorkingSymbol: report.filter((r) => r.status === 'NO_WORKING_SYMBOL_FOUND').length,
    forbiddenAtDepth: report.filter((r) => r.status === 'FORBIDDEN_403').length,
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
