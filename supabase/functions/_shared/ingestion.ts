// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Phase 1.4 — Shared ingestion client helper (Deno / Supabase Edge Function)
// ============================================================================
// SECURITY GUARDRAILS (Sheet 43 -- enforced in code, not just by convention):
//   1. All credentials come from Deno.env.get() only. Never hardcoded, never
//      passed as function arguments that could end up in a log line, never
//      placed in any object that gets persisted to the database.
//   2. logSafe() exists specifically so importer code has no easy way to
//      accidentally console.log() a full request object (which could
//      contain an Authorization header). It strips headers before logging.
//   3. buildErrorPayload() builds what goes into import_errors.raw_payload --
//      response body only. It does not accept a "request" argument at all,
//      so there is no parameter an importer could mistakenly pass a request
//      object into.
// ============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set -- check Edge Function secrets configuration, not .env files.");
  }
  // service_role bypasses RLS by design -- these importers are the
  // service-principal write path described in 002_rls.sql; they are never
  // meant to go through the anon/authenticated RLS-gated path.
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

// Logs a fetch Response's status/url only -- never headers, never the
// request that produced it. Use this instead of console.log(response).
export function logSafe(label: string, response: Response): void {
  console.log(`[${label}] status=${response.status} url=${maskUrlSecrets(response.url)}`);
}

// Some providers put the API key in the URL query string (Finnhub does).
// Strip it before it ever reaches a log line.
export function maskUrlSecrets(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ["token", "apikey", "api_key", "key"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "***");
    }
    return u.toString();
  } catch {
    return "[unparseable url]";
  }
}

// Builds the payload stored in import_errors.raw_payload. Deliberately takes
// only a response body, never a request -- this is what makes "never store
// the outbound request" structurally true rather than a convention an
// importer could forget.
export function buildErrorPayload(responseBody: unknown, extra?: Record<string, unknown>): Record<string, unknown> {
  return { response_body: responseBody, ...extra };
}

export interface ImportBatchHandle {
  importBatchId: string;
  successRows: number;
  duplicateRows: number;
  errorRows: number;
}

export async function startBatch(
  db: SupabaseClient,
  sourceSystem: string,
  targetTable: string,
  batchType: "HISTORICAL_BACKFILL" | "INCREMENTAL_API_SYNC",
  servicePrincipalName: string,
  dateRangeStart?: string,
  dateRangeEnd?: string,
): Promise<ImportBatchHandle> {
  const { data: principal, error: principalError } = await db
    .from("service_principals")
    .select("service_principal_id")
    .eq("name", servicePrincipalName)
    .single();
  if (principalError || !principal) {
    throw new Error(`Could not resolve service_principal '${servicePrincipalName}': ${principalError?.message}`);
  }

  const { data: batchId, error } = await db.rpc("start_import_batch", {
    p_source_system: sourceSystem,
    p_target_table: targetTable,
    p_batch_type: batchType,
    p_triggered_by_type: "SYSTEM",
    p_triggered_by_id: principal.service_principal_id,
    p_date_range_start: dateRangeStart ?? null,
    p_date_range_end: dateRangeEnd ?? null,
  });
  if (error) throw new Error(`start_import_batch failed: ${error.message}`);

  return { importBatchId: batchId as string, successRows: 0, duplicateRows: 0, errorRows: 0 };
}

export async function recordSuccess(db: SupabaseClient, handle: ImportBatchHandle): Promise<void> {
  const { error } = await db.rpc("record_import_success", { p_import_batch_id: handle.importBatchId });
  if (error) throw new Error(`record_import_success failed: ${error.message}`);
  handle.successRows++;
}

export async function recordDuplicate(db: SupabaseClient, handle: ImportBatchHandle): Promise<void> {
  const { error } = await db.rpc("record_import_duplicate", { p_import_batch_id: handle.importBatchId });
  if (error) throw new Error(`record_import_duplicate failed: ${error.message}`);
  handle.duplicateRows++;
}

export async function recordError(
  db: SupabaseClient,
  handle: ImportBatchHandle,
  sourceRecordId: string | null,
  errorType: "VALIDATION_FAILED" | "DUPLICATE" | "SCHEMA_MISMATCH" | "MISSING_REQUIRED_FIELD" | "PROVIDER_ERROR",
  errorDetail: string,
  rawPayload: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.rpc("record_import_error", {
    p_import_batch_id: handle.importBatchId,
    p_source_record_id: sourceRecordId,
    p_error_type: errorType,
    p_error_detail: errorDetail,
    p_raw_payload: rawPayload,
  });
  if (error) throw new Error(`record_import_error failed: ${error.message}`);
  handle.errorRows++;
}

export async function finalizeBatch(db: SupabaseClient, handle: ImportBatchHandle, totalRows: number): Promise<void> {
  const { error } = await db.rpc("finalize_import_batch", {
    p_import_batch_id: handle.importBatchId,
    p_total_rows: totalRows,
  });
  if (error) throw new Error(`finalize_import_batch failed: ${error.message}`);
}
