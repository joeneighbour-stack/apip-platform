// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Phase 1.4 — Acuity Performance importer (Deno Edge Function)
// REBUILT against the real n8n webhook contract (confirmed via live Postman
// sample + auth screenshot), replacing the earlier placeholder version.
// ============================================================================
// Real contract:
//   POST https://n8n.srv1104653.hstgr.cloud/webhook/8c614cce-75ce-448d-9fb4-8c7f234dfedd
//   Auth: Basic (username/password, base64-encoded into the Authorization header)
//   Body: { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "reportType": "analyst" }
//   Response: array of records, each with ReportType "Pattern" or "Analyst".
//   This importer ONLY processes ReportType === "Analyst" -- "Pattern" is
//   Acuity's separate automated signal product, explicitly out of scope for
//   actual_trades/analyst_publications per Joe's confirmation.
//
// IMPORTANT DESIGN DECISION (confirmed with Joe before building):
//   - INCREMENTAL mode (today forward): writes to BOTH actual_trades
//     (triggered rows only) AND analyst_publications (every row). There is
//     no other source of truth for "today forward", so this importer owns it.
//   - BACKFILL mode (historical pull, ~2022 onward): writes ONLY to
//     analyst_publications. It NEVER writes to actual_trades, because the
//     manual spreadsheet backfill (already completed, 30,825 rows,
//     2017-2026) is the confirmed "most correct" source for historical
//     realized trades. Letting a historical webhook pull also write
//     actual_trades would create duplicate/competing rows for the same
//     real-world trade under a different source_record_id scheme (webhook
//     ReportId GUID vs spreadsheet's plain numeric ID), silently
//     double-counting history. BACKFILL mode here exists ONLY to recover
//     the untriggered-recommendation denominator that the spreadsheet
//     never contained.
// ============================================================================

import {
  getServiceClient, startBatch, recordSuccess, recordDuplicate, recordError, finalizeBatch,
  buildErrorPayload, logSafe,
} from "../_shared/ingestion.ts";

// Real field names confirmed against a live sample response.
interface AcuityReportRow {
  ReportType: "Pattern" | "Analyst";
  AssetId: number | string;
  AssetClass: string;
  Symbol: string;
  ReportId: string;
  Direction: string; // observed casing varies: "BUY", "Sell", "SELL" -- normalize
  Status: string;
  PublicationDate: string;
  Entry: number;
  ExitPrice: number | null;
  ExitDate: string | null;
  TakeProfit: number | null;
  StopLoss: number | null;
  Expiry: string | null;
  RR: number | null;
  Analyst: string | null; // null for Pattern rows; short code (e.g. "MOH") for Analyst rows
  Triggered: boolean;
  TriggeredDateTime: string | null;
  OriginalStatus: string | null;
}

interface RequestBody {
  mode: "INCREMENTAL" | "BACKFILL";
  dateRangeStart: string; // YYYY-MM-DD, required both modes -- the webhook itself requires from/to
  dateRangeEnd: string;
}

function normalizeDirection(raw: string): "BUY" | "SELL" | null {
  const upper = raw.trim().toUpperCase();
  if (upper === "BUY") return "BUY";
  if (upper === "SELL") return "SELL";
  return null;
}

Deno.serve(async (req: Request) => {
  const username = Deno.env.get("ACUITY_PERFORMANCE_USERNAME");
  const password = Deno.env.get("ACUITY_PERFORMANCE_PASSWORD");
  if (!username || !password) {
    return new Response(JSON.stringify({ error: "ACUITY_PERFORMANCE_USERNAME / ACUITY_PERFORMANCE_PASSWORD not configured" }), { status: 500 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be JSON: { mode, dateRangeStart, dateRangeEnd }" }), { status: 400 });
  }
  if (!body.dateRangeStart || !body.dateRangeEnd) {
    return new Response(JSON.stringify({ error: "dateRangeStart and dateRangeEnd are required (webhook requires from/to)" }), { status: 400 });
  }

  const db = getServiceClient();
  const isBackfill = body.mode === "BACKFILL";

  const handle = await startBatch(
    db, "ACUITY_PERFORMANCE_API", isBackfill ? "analyst_publications" : "actual_trades",
    isBackfill ? "HISTORICAL_BACKFILL" : "INCREMENTAL_API_SYNC",
    "ACUITY_PERFORMANCE_IMPORTER",
    body.dateRangeStart, body.dateRangeEnd,
  );

  // Reference data: markets (direct + aliased) and analyst codes.
  const { data: markets } = await db.from("markets").select("market_id, symbol");
  const marketBySymbol = new Map((markets ?? []).map((m) => [m.symbol, m.market_id]));

  const { data: aliases } = await db
    .from("market_symbol_aliases")
    .select("market_id, alias_symbol")
    .eq("source_system", "ACUITY_PERFORMANCE_API");
  const marketByAlias = new Map((aliases ?? []).map((a) => [a.alias_symbol, a.market_id]));

  function resolveMarketId(symbol: string): string | undefined {
    const trimmed = symbol.trim();
    return marketByAlias.get(trimmed) ?? marketBySymbol.get(trimmed);
  }

  const { data: codes } = await db
    .from("analyst_external_codes")
    .select("analyst_id, external_code")
    .eq("source_system", "ACUITY_PERFORMANCE_API");
  const analystByCode = new Map((codes ?? []).map((c) => [c.external_code.toUpperCase(), c.analyst_id]));

  let processed = 0;

  try {
    const credentials = btoa(`${username}:${password}`);
    const response = await fetch("https://n8n.srv1104653.hstgr.cloud/webhook/8c614cce-75ce-448d-9fb4-8c7f234dfedd", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: body.dateRangeStart, to: body.dateRangeEnd, reportType: "analyst" }),
    });
    logSafe("acuity-performance", response);

    if (!response.ok) {
      const responseBody = await response.text();
      await recordError(db, handle, null, "PROVIDER_ERROR",
        `Acuity Performance webhook returned HTTP ${response.status}`, buildErrorPayload(responseBody));
      await finalizeBatch(db, handle, 1);
      return new Response(JSON.stringify({ error: "provider error", importBatchId: handle.importBatchId }), { status: 502 });
    }

    const rows: AcuityReportRow[] = await response.json();
    // Pattern rows are Acuity's separate automated signal product -- out of
    // scope for both actual_trades and analyst_publications per Joe's
    // confirmation. Filter them out before processing, not silently ignore
    // them mid-loop.
    const analystRows = rows.filter((r) => r.ReportType === "Analyst");

    // Known symbols that are deliberately excluded -- per-customer pricing
    // duplicates or similar artifacts from Acuity's side that are not real,
    // independently-tradable markets. These are skipped cleanly (counted as
    // success for batch reconciliation purposes, since the row WAS handled
    // correctly by deliberately not storing it) rather than landing in
    // import_errors looking like an unresolved problem that needs fixing.
    // If more of these turn up, add them here rather than building a
    // separate admin-managed table for what has so far been a single case.
    const EXCLUDED_SYMBOLS = new Set(["Natural Gas.1"]);

    processed = analystRows.length;

    for (const row of analystRows) {
      if (EXCLUDED_SYMBOLS.has(row.Symbol)) {
        console.log(`[acuity-performance:excluded] ${row.ReportId}: symbol '${row.Symbol}' is a known non-tradable duplicate, skipping by design.`);
        await recordSuccess(db, handle);
        continue;
      }
      try {
        const marketId = resolveMarketId(row.Symbol);
        const analystId = row.Analyst ? analystByCode.get(row.Analyst.trim().toUpperCase()) : undefined;
        const direction = normalizeDirection(row.Direction);

        if (!marketId || !analystId || !direction) {
          await recordError(db, handle, row.ReportId, "VALIDATION_FAILED",
            `Could not resolve symbol='${row.Symbol}' (market: ${!!marketId}), analyst='${row.Analyst}' (resolved: ${!!analystId}), or direction='${row.Direction}'`,
            buildErrorPayload(row));
          continue;
        }

        // analyst_publications: written in BOTH modes -- this is the
        // denominator table and every recommendation belongs here
        // regardless of whether it triggered.
        const { data: pubResult, error: pubError } = await db.rpc("upsert_analyst_publication", {
          p_source_system: "ACUITY_PERFORMANCE_API",
          p_source_record_id: row.ReportId,
          p_analyst_id: analystId,
          p_market_id: marketId,
          p_published_at: row.PublicationDate,
          p_direction: direction,
          p_entry: row.Entry,
          p_stop: row.StopLoss,
          p_target: row.TakeProfit,
          p_original_triggered: row.Triggered,
          p_import_batch_id: handle.importBatchId,
          p_raw_payload: row,
        });

        if (pubError) {
          await recordError(db, handle, row.ReportId, "SCHEMA_MISMATCH", pubError.message, buildErrorPayload(row));
          continue;
        }
        console.log(`[acuity-performance:publication] ${row.ReportId}: ${pubResult}`);

        // actual_trades: ONLY in INCREMENTAL mode, and only when triggered.
        // See the file-header note for why BACKFILL mode never touches
        // actual_trades -- the manual spreadsheet already owns that history.
        if (!isBackfill && row.Triggered) {
          const { data: tradeResult, error: tradeError } = await db.rpc("upsert_actual_trade", {
            p_source_system: "ACUITY_PERFORMANCE_API",
            p_source_record_id: row.ReportId,
            p_historical_backfill: false,
            p_import_batch_id: handle.importBatchId,
            p_opportunity_id: null,
            p_recommendation_version_id: null,
            p_published_at: row.PublicationDate,
            p_analyst_id: analystId,
            p_market_id: marketId,
            p_session: null, // see Phase 1.4 note: no reliable session-hours design exists yet
            p_direction: direction,
            p_entry: row.Entry,
            p_stop: row.StopLoss,
            p_target: row.TakeProfit,
            p_expiry: row.Expiry,
            p_triggered: row.Triggered,
            p_closed_at: row.ExitDate,
            p_result_r: row.RR,
            p_raw_payload: row,
          });

          if (tradeError) {
            await recordError(db, handle, row.ReportId, "SCHEMA_MISMATCH", tradeError.message, buildErrorPayload(row));
            continue;
          }
          console.log(`[acuity-performance:trade] ${row.ReportId}: ${tradeResult}`);
          if (tradeResult === "DUPLICATE") {
            await recordDuplicate(db, handle);
          } else {
            await recordSuccess(db, handle);
          }
        } else {
          // BACKFILL mode, or an untriggered row in INCREMENTAL mode --
          // either way, the analyst_publications write above already
          // happened, and that's the only write this row needs.
          if (pubResult === "DUPLICATE") {
            await recordDuplicate(db, handle);
          } else {
            await recordSuccess(db, handle);
          }
        }
      } catch (err) {
        await recordError(db, handle, row.ReportId ?? null, "PROVIDER_ERROR",
          err instanceof Error ? err.message : String(err), buildErrorPayload(row));
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