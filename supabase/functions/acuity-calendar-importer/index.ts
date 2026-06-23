// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Phase 1.4 — Acuity Calendar importer (Deno Edge Function)
// ============================================================================
// Pulls upcoming economic events. Revision tracking (forecast/actual
// changes after initial publication) is handled entirely inside
// upsert_economic_calendar_event -- this function does not need to know
// whether a given call is a first import or a revision; the SQL function
// tells it via the returned status string ('INSERTED' | 'REVISED' |
// 'DUPLICATE'), which we log but do not need to branch on here.
// ============================================================================

import {
  getServiceClient, startBatch, recordSuccess, recordError, finalizeBatch,
  buildErrorPayload, logSafe,
} from "../_shared/ingestion.ts";

interface AcuityCalendarEvent {
  event_id: string;
  event_time_utc: string;
  country: string;
  currency: string;
  event_name: string;
  impact: "LOW" | "MEDIUM" | "HIGH";
  forecast: string | null;
  previous: string | null;
  actual: string | null;
}

Deno.serve(async (_req: Request) => {
  const ACUITY_API_KEY = Deno.env.get("ACUITY_CALENDAR_API_KEY");
  if (!ACUITY_API_KEY) {
    return new Response(JSON.stringify({ error: "ACUITY_CALENDAR_API_KEY not configured" }), { status: 500 });
  }

  const db = getServiceClient();
  const handle = await startBatch(db, "ACUITY_CALENDAR_API", "economic_calendar_events", "INCREMENTAL_API_SYNC", "ACUITY_CALENDAR_IMPORTER");

  let processed = 0;

  try {
    // Per Sheet 43: the key goes server-side only, in a header, never the
    // URL -- unlike Finnhub's contract, so no maskUrlSecrets() concern here,
    // but logSafe() is still used for consistency with the other importers.
    const response = await fetch("https://api.acuity.example/v1/calendar/upcoming", {
      headers: { "Authorization": `Bearer ${ACUITY_API_KEY}` },
    });
    logSafe("acuity-calendar", response);

    if (!response.ok) {
      const body = await response.text();
      await recordError(db, handle, null, "PROVIDER_ERROR",
        `Acuity Calendar API returned HTTP ${response.status}`, buildErrorPayload(body));
      await finalizeBatch(db, handle, 1);
      return new Response(JSON.stringify({ error: "provider error", importBatchId: handle.importBatchId }), { status: 502 });
    }

    const events: AcuityCalendarEvent[] = await response.json();
    processed = events.length;

    for (const event of events) {
      try {
        if (!event.event_id || !event.event_time_utc || !event.event_name) {
          await recordError(db, handle, event.event_id ?? null, "MISSING_REQUIRED_FIELD",
            "Missing event_id, event_time_utc, or event_name", buildErrorPayload(event));
          continue;
        }

        const { data: result, error: rpcError } = await db.rpc("upsert_economic_calendar_event", {
          p_source_system: "ACUITY_CALENDAR_API",
          p_source_record_id: event.event_id,
          p_source_event_id: event.event_id,
          p_event_time_uk: event.event_time_utc,
          p_country: event.country,
          p_currency: event.currency,
          p_event_name: event.event_name,
          p_impact: event.impact,
          p_forecast: event.forecast,
          p_previous: event.previous,
          p_actual: event.actual,
          p_import_batch_id: handle.importBatchId,
          p_raw_payload: event,
        });

        if (rpcError) {
          await recordError(db, handle, event.event_id, "SCHEMA_MISMATCH", rpcError.message, buildErrorPayload(event));
          continue;
        }

        console.log(`[acuity-calendar] ${event.event_id}: ${result}`);
        // INSERTED, REVISED, and DUPLICATE are all successful reconciliation
        // outcomes from this importer's point of view -- only a thrown
        // error or an explicit rpcError above counts against the batch.
        await recordSuccess(db, handle);
      } catch (err) {
        await recordError(db, handle, event.event_id ?? null, "PROVIDER_ERROR",
          err instanceof Error ? err.message : String(err), buildErrorPayload(event));
      }
    }
  } catch (err) {
    await recordError(db, handle, null, "PROVIDER_ERROR", err instanceof Error ? err.message : String(err), buildErrorPayload(null));
    processed = Math.max(processed, 1);
  }

  await finalizeBatch(db, handle, processed);

  return new Response(JSON.stringify({
    importBatchId: handle.importBatchId,
    processed, success: handle.successRows, duplicate: handle.duplicateRows, errors: handle.errorRows,
  }), { headers: { "Content-Type": "application/json" } });
});
