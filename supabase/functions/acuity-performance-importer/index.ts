// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Phase 1.4 — Acuity Performance importer (Deno Edge Function)
// ============================================================================
// Two modes, both calling the same upsert_actual_trade function:
//   - INCREMENTAL: ongoing sync, runs on a schedule, no date range.
//   - BACKFILL: one-time historical dump (Sheet 39-42). historical_backfill
//     is set true and opportunity_id/recommendation_version_id are always
//     null -- the platform did not exist when this trade happened, so any
//     link would be fabricated. The DB CHECK constraint
//     (chk_backfill_no_recommendation_link, verified in
//     009_backfill_constraint_test.sql) is the actual enforcement; this
//     code simply never attempts to set those fields when backfilling, by
//     construction rather than by remembering not to.
// ============================================================================

import {
  getServiceClient, startBatch, recordSuccess, recordDuplicate, recordError, finalizeBatch,
  buildErrorPayload, logSafe,
} from "../_shared/ingestion.ts";

interface AcuityPerformanceTrade {
  trade_id: string;
  analyst_external_id: string; // resolved to analysts.analyst_id via app_users mapping
  market_symbol: string;
  session: "EUROPEAN" | "US" | "APAC" | "CRYPTO";
  direction: "BUY" | "SELL";
  entry: number;
  stop: number | null;
  target: number | null;
  expiry: string | null;
  published_at: string;
  triggered: boolean;
  closed_at: string | null;
  result_r: number | null;
}

interface RequestBody {
  mode: "INCREMENTAL" | "BACKFILL";
  dateRangeStart?: string; // required for BACKFILL
  dateRangeEnd?: string;   // required for BACKFILL
}

Deno.serve(async (req: Request) => {
  const ACUITY_API_KEY = Deno.env.get("ACUITY_PERFORMANCE_API_KEY");
  if (!ACUITY_API_KEY) {
    return new Response(JSON.stringify({ error: "ACUITY_PERFORMANCE_API_KEY not configured" }), { status: 500 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be JSON: { mode, dateRangeStart?, dateRangeEnd? }" }), { status: 400 });
  }

  if (body.mode === "BACKFILL" && (!body.dateRangeStart || !body.dateRangeEnd)) {
    return new Response(JSON.stringify({ error: "BACKFILL mode requires dateRangeStart and dateRangeEnd" }), { status: 400 });
  }

  const db = getServiceClient();
  const isBackfill = body.mode === "BACKFILL";

  const handle = await startBatch(
    db, "ACUITY_PERFORMANCE_API", "actual_trades",
    isBackfill ? "HISTORICAL_BACKFILL" : "INCREMENTAL_API_SYNC",
    "ACUITY_PERFORMANCE_IMPORTER",
    body.dateRangeStart, body.dateRangeEnd,
  );

  // Resolve market symbol -> market_id once, rather than per-row.
  const { data: markets } = await db.from("markets").select("market_id, symbol");
  const marketBySymbol = new Map((markets ?? []).map((m) => [m.symbol, m.market_id]));

  // Resolve analyst external ID -> analyst_id once, rather than per-row.
  // The exact mapping field is assumed here as analysts.display_name;
  // replace with analysts.external_id once that column/mapping is
  // confirmed against the live Acuity Performance response shape.
  const { data: analysts } = await db.from("analysts").select("analyst_id, display_name");
  const analystByExternalId = new Map((analysts ?? []).map((a) => [a.display_name, a.analyst_id]));

  let processed = 0;

  try {
    const endpoint = isBackfill
      ? `https://api.acuity.example/v1/performance/history?from=${body.dateRangeStart}&to=${body.dateRangeEnd}`
      : `https://api.acuity.example/v1/performance/recent`;

    const response = await fetch(endpoint, {
      headers: { "Authorization": `Bearer ${ACUITY_API_KEY}` },
    });
    logSafe("acuity-performance", response);

    if (!response.ok) {
      const responseBody = await response.text();
      await recordError(db, handle, null, "PROVIDER_ERROR",
        `Acuity Performance API returned HTTP ${response.status}`, buildErrorPayload(responseBody));
      await finalizeBatch(db, handle, 1);
      return new Response(JSON.stringify({ error: "provider error", importBatchId: handle.importBatchId }), { status: 502 });
    }

    const trades: AcuityPerformanceTrade[] = await response.json();
    processed = trades.length;

    for (const trade of trades) {
      try {
        const marketId = marketBySymbol.get(trade.market_symbol);
        const analystId = analystByExternalId.get(trade.analyst_external_id);

        if (!marketId || !analystId) {
          await recordError(db, handle, trade.trade_id, "VALIDATION_FAILED",
            `Could not resolve market_symbol='${trade.market_symbol}' or analyst_external_id='${trade.analyst_external_id}'`,
            buildErrorPayload(trade));
          continue;
        }

        const { data: result, error: rpcError } = await db.rpc("upsert_actual_trade", {
          p_source_system: "ACUITY_PERFORMANCE_API",
          p_source_record_id: trade.trade_id,
          p_historical_backfill: isBackfill,
          p_import_batch_id: handle.importBatchId,
          p_opportunity_id: null,
          p_recommendation_version_id: null,
          p_published_at: trade.published_at,
          p_analyst_id: analystId,
          p_market_id: marketId,
          p_session: trade.session,
          p_direction: trade.direction,
          p_entry: trade.entry,
          p_stop: trade.stop,
          p_target: trade.target,
          p_expiry: trade.expiry,
          p_triggered: trade.triggered,
          p_closed_at: trade.closed_at,
          p_result_r: trade.result_r,
          p_raw_payload: trade,
        });

        if (rpcError) {
          await recordError(db, handle, trade.trade_id, "SCHEMA_MISMATCH", rpcError.message, buildErrorPayload(trade));
          continue;
        }

        console.log(`[acuity-performance] ${trade.trade_id}: ${result}`);
        if (result === "DUPLICATE") {
          await recordDuplicate(db, handle);
        } else {
          await recordSuccess(db, handle);
        }
      } catch (err) {
        await recordError(db, handle, trade.trade_id ?? null, "PROVIDER_ERROR",
          err instanceof Error ? err.message : String(err), buildErrorPayload(trade));
      }
    }
  } catch (err) {
    await recordError(db, handle, null, "PROVIDER_ERROR", err instanceof Error ? err.message : String(err), buildErrorPayload(null));
    processed = Math.max(processed, 1);
  }

  await finalizeBatch(db, handle, processed);

  return new Response(JSON.stringify({
    mode: body.mode,
    importBatchId: handle.importBatchId,
    processed, success: handle.successRows, duplicate: handle.duplicateRows, errors: handle.errorRows,
  }), { headers: { "Content-Type": "application/json" } });
});
