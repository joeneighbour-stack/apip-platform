// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Phase 1.4 — Finnhub market data importer (Deno Edge Function)
// ============================================================================
// Triggered by an engine_run_step (Phase 1.3) per market, per session, via
// the engine orchestration cron. Pulls daily OHLC + computes ATR14/zone is
// NOT done here -- Finnhub gives raw candles; zone/ATR derivation belongs to
// the recommendation engine (Phase 1.5), not the importer. This function's
// only job is: fetch, dedup-safe upsert, record outcome, finalize.
// ============================================================================

import {
  getServiceClient, startBatch, recordSuccess, recordError, finalizeBatch,
  buildErrorPayload, logSafe,
} from "../_shared/ingestion.ts";

interface FinnhubCandleResponse {
  c: number[]; h: number[]; l: number[]; o: number[]; t: number[]; s: string;
}

Deno.serve(async (req: Request) => {
  const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY");
  if (!FINNHUB_API_KEY) {
    return new Response(JSON.stringify({ error: "FINNHUB_API_KEY not configured" }), { status: 500 });
  }

  const db = getServiceClient();
  const { data: markets, error: marketsError } = await db
    .from("markets")
    .select("market_id, symbol, finnhub_symbol")
    .eq("active", true)
    .eq("excluded", false);

  if (marketsError) {
    return new Response(JSON.stringify({ error: marketsError.message }), { status: 500 });
  }

  const handle = await startBatch(db, "FINNHUB", "market_state_daily", "INCREMENTAL_API_SYNC", "FINNHUB_IMPORTER");

  const today = new Date();
  const from = Math.floor((today.getTime() - 30 * 24 * 60 * 60 * 1000) / 1000); // 30-day lookback for ATR14
  const to = Math.floor(today.getTime() / 1000);

  let processed = 0;

  for (const market of markets ?? []) {
    const symbol = market.finnhub_symbol ?? market.symbol;
    processed++;

    try {
      // Key goes in the query string per Finnhub's API contract -- this is
      // exactly why maskUrlSecrets() exists, so it never reaches a log line
      // even though Finnhub's own design puts it in the URL.
      const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
      const response = await fetch(url);
      logSafe("finnhub", response);

      if (!response.ok) {
        const body = await response.text();
        await recordError(db, handle, symbol, "PROVIDER_ERROR",
          `Finnhub returned HTTP ${response.status}`, buildErrorPayload(body));
        continue;
      }

      const candles: FinnhubCandleResponse = await response.json();
      if (candles.s !== "ok" || !candles.c?.length) {
        await recordError(db, handle, symbol, "PROVIDER_ERROR",
          `Finnhub response status field was '${candles.s}', no usable candle data`, buildErrorPayload(candles));
        continue;
      }

      // Most recent closed daily candle.
      const lastIdx = candles.c.length - 1;
      const dateStr = new Date(candles.t[lastIdx] * 1000).toISOString().slice(0, 10);

      const { data: upsertResult, error: rpcError } = await db.rpc("upsert_market_state_daily", {
        p_market_id: market.market_id,
        p_date: dateStr,
        p_open: candles.o[lastIdx],
        p_high: candles.h[lastIdx],
        p_low: candles.l[lastIdx],
        p_close: candles.c[lastIdx],
        // ATR14/zone are placeholders here -- Phase 1.5 (recommendation
        // engine) owns that derivation and will update this row via its
        // own engine step. The importer's job stops at raw OHLC.
        p_atr14: null,
        p_zone: null,
        p_source_system: "FINNHUB",
        p_source_record_id: `${symbol}:${dateStr}`,
        p_import_batch_id: handle.importBatchId,
        p_raw_payload: { symbol, candle_index: lastIdx, raw: candles },
      });

      if (rpcError) {
        await recordError(db, handle, symbol, "SCHEMA_MISMATCH", rpcError.message, buildErrorPayload(candles));
        continue;
      }

      console.log(`[finnhub] ${symbol} ${dateStr}: ${upsertResult}`);
      await recordSuccess(db, handle);
    } catch (err) {
      await recordError(db, handle, symbol, "PROVIDER_ERROR",
        err instanceof Error ? err.message : String(err), buildErrorPayload(null));
    }
  }

  await finalizeBatch(db, handle, processed);

  return new Response(JSON.stringify({
    importBatchId: handle.importBatchId,
    processed, success: handle.successRows, duplicate: handle.duplicateRows, errors: handle.errorRows,
  }), { headers: { "Content-Type": "application/json" } });
});
