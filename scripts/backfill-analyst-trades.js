// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Phase 1.4 — One-time historical backfill script
// ============================================================================
// Reads perf_backfill.xlsx (columns: ID, DATE, SYMBOL, MULTIPLIER, ANALYST,
// TRADE, ENTRY, STOP, TARGET, EXIT, STOP %, STOP (P), TARGET %, TARGET (P),
// POINTS, RET, R/R) and imports every row into actual_trades via
// upsert_actual_trade, with historical_backfill = true and
// opportunity_id/recommendation_version_id always null.
//
// This is a ONE-TIME LOCAL SCRIPT, not an Edge Function -- it's meant to be
// run once from your machine against staging (and later production), not
// deployed or scheduled. That's why it uses Node directly rather than Deno:
// no need to deploy anything for a single run.
//
// Run:
//   node scripts/backfill-analyst-trades.js path\to\perf_backfill.xlsx
//
// Required environment variables (set in your shell, NEVER in a committed
// file):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Dry run first (recommended): pass --dry-run to validate every row's
// market/analyst mapping and date parsing WITHOUT writing anything to the
// database. This surfaces unmapped symbols/analysts up front, against the
// real 30,825 rows, rather than discovering them mid-import.
//
//   node scripts/backfill-analyst-trades.js path\to\perf_backfill.xlsx --dry-run
// ============================================================================

const { createClient } = require("@supabase/supabase-js");
const xlsx = require("xlsx");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const filePath = process.argv[2];
const isDryRun = process.argv.includes("--dry-run");

if (!filePath) {
  console.error("Usage: node backfill-analyst-trades.js <path-to-xlsx> [--dry-run]");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as environment variables.");
  console.error("Never hardcode these or put them in a committed file.");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Expected header row, in order. If the real file's headers differ even
// slightly, this script stops immediately rather than silently mis-mapping
// columns by position.
const EXPECTED_HEADERS = [
  "ID", "DATE", "SYMBOL", "MULTIPLIER", "ANALYST", "TRADE", "ENTRY", "STOP",
  "TARGET", "EXIT", "STOP %", "STOP (P)", "TARGET %", "TARGET (P)", "POINTS", "RET", "R/R",
];

function normalizeDirection(raw) {
  const upper = String(raw).trim().toUpperCase();
  if (upper === "BUY") return "BUY";
  if (upper === "SELL") return "SELL";
  return null;
}

// The spreadsheet's DATE column has no time-of-day (always midnight) --
// confirmed during earlier inspection. We treat it as a date-only value and
// do NOT fabricate a time. published_at is set to midnight UTC on that date;
// this is honest about precision, not a guess at an actual trade time.
function toIsoDate(excelDate) {
  if (excelDate instanceof Date) {
    return excelDate.toISOString();
  }
  // xlsx sometimes gives a serial number instead of a Date depending on
  // cellDates option -- we read with cellDates: true below specifically to
  // avoid needing to handle the Excel epoch offset here.
  return null;
}

async function loadReferenceData() {
  const { data: markets, error: marketsError } = await db.from("markets").select("market_id, symbol");
  if (marketsError) throw new Error(`Failed to load markets: ${marketsError.message}`);

  const { data: codes, error: codesError } = await db
    .from("analyst_external_codes")
    .select("analyst_id, external_code")
    .eq("source_system", "ACUITY_PERFORMANCE_API");
  if (codesError) throw new Error(`Failed to load analyst_external_codes: ${codesError.message}`);

  const marketBySymbol = new Map(markets.map((m) => [m.symbol, m.market_id]));
  const analystByCode = new Map(codes.map((c) => [c.external_code.toUpperCase(), c.analyst_id]));

  return { marketBySymbol, analystByCode };
}

async function main() {
  console.log(`Reading ${filePath}...`);
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  const headerRow = rows[0].map((h) => String(h).trim());
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    if (headerRow[i] !== EXPECTED_HEADERS[i]) {
      console.error(`Header mismatch at column ${i}: expected '${EXPECTED_HEADERS[i]}', found '${headerRow[i]}'.`);
      console.error("Stopping rather than guess at column mapping. Fix the spreadsheet header or this script's EXPECTED_HEADERS.");
      process.exit(1);
    }
  }

  const dataRows = rows.slice(1).filter((r) => r[0] !== null && r[0] !== "");
  console.log(`${dataRows.length} data rows found.`);

  const { marketBySymbol, analystByCode } = await loadReferenceData();

  const unmappedSymbols = new Map(); // symbol -> count
  const unmappedAnalysts = new Map();

  const operatorEmail = process.env.BACKFILL_OPERATOR_EMAIL;
  if (!isDryRun && !operatorEmail) {
    console.error("BACKFILL_OPERATOR_EMAIL must be set (your own app_users email) -- start_import_batch");
    console.error("requires a real triggered_by_id, since a human is running this script, not a service principal.");
    process.exit(1);
  }

  let operatorId = null;
  if (!isDryRun) {
    const { data: operator, error: operatorError } = await db
      .from("app_users").select("app_user_id").eq("email", operatorEmail).single();
    if (operatorError || !operator) {
      console.error(`Could not resolve app_users row for email '${operatorEmail}': ${operatorError?.message}`);
      process.exit(1);
    }
    operatorId = operator.app_user_id;
  }

  let batchId = null;
  if (!isDryRun) {
    const { data: batch, error: batchError } = await db.rpc("start_import_batch", {
      p_source_system: "MANUAL_BACKFILL",
      p_target_table: "actual_trades",
      p_batch_type: "HISTORICAL_BACKFILL",
      p_triggered_by_type: "USER",
      p_triggered_by_id: operatorId,
    });
    if (batchError) {
      console.error(`start_import_batch failed: ${batchError.message}`);
      process.exit(1);
    }
    batchId = batch;
    console.log(`Import batch started: ${batchId}`);
  }

  let success = 0, duplicate = 0, error = 0;
  const BATCH_LOG_INTERVAL = 1000;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const [id, date, symbol, , analystCode, tradeDir, entry, stop, target, exit, , , , , , , rr] = row;

    const marketId = marketBySymbol.get(symbol);
    const analystId = analystByCode.get(String(analystCode).toUpperCase());
    const direction = normalizeDirection(tradeDir);
    const publishedAt = toIsoDate(date);

    const rowErrors = [];
    if (!marketId) rowErrors.push(`unmapped symbol '${symbol}'`);
    if (!analystId) rowErrors.push(`unmapped analyst code '${analystCode}'`);
    if (!direction) rowErrors.push(`unrecognized direction '${tradeDir}'`);
    if (!publishedAt) rowErrors.push(`unparseable date`);

    if (rowErrors.length > 0) {
      if (!marketId) unmappedSymbols.set(symbol, (unmappedSymbols.get(symbol) || 0) + 1);
      if (!analystId) unmappedAnalysts.set(analystCode, (unmappedAnalysts.get(analystCode) || 0) + 1);

      if (!isDryRun) {
        await db.rpc("record_import_error", {
          p_import_batch_id: batchId,
          p_source_record_id: String(id),
          p_error_type: "VALIDATION_FAILED",
          p_error_detail: rowErrors.join("; "),
          p_raw_payload: { row: headerRow.reduce((o, h, idx) => ({ ...o, [h]: row[idx] }), {}) },
        });
      }
      error++;
      continue;
    }

    if (isDryRun) {
      success++;
      continue;
    }

    const { data: result, error: rpcError } = await db.rpc("upsert_actual_trade", {
      p_source_system: "MANUAL_BACKFILL",
      p_source_record_id: String(id),
      p_historical_backfill: true,
      p_import_batch_id: batchId,
      p_opportunity_id: null,
      p_recommendation_version_id: null,
      p_published_at: publishedAt,
      p_analyst_id: analystId,
      p_market_id: marketId,
      p_session: null, // genuinely unknown -- spreadsheet has date only, no time
      p_direction: direction,
      p_entry: entry,
      p_stop: stop,
      p_target: target,
      p_expiry: null, // not present in this spreadsheet format
      p_triggered: true, // every row in this export represents a closed/exited trade
      p_closed_at: null, // no exit-date column exists in this spreadsheet format -- DO NOT
                          // fabricate this as publishedAt; the source webhook sample showed
                          // real exits landing days after publication. triggered/result_r
                          // already capture the outcome without needing a fake close timestamp.
      p_result_r: rr,
      p_raw_payload: { row: headerRow.reduce((o, h, idx) => ({ ...o, [h]: row[idx] }), {}) },
    });

    if (rpcError) {
      await db.rpc("record_import_error", {
        p_import_batch_id: batchId,
        p_source_record_id: String(id),
        p_error_type: "SCHEMA_MISMATCH",
        p_error_detail: rpcError.message,
        p_raw_payload: { row: headerRow.reduce((o, h, idx) => ({ ...o, [h]: row[idx] }), {}) },
      });
      error++;
      continue;
    }

    if (result === "DUPLICATE") {
      await db.rpc("record_import_duplicate", { p_import_batch_id: batchId });
      duplicate++;
    } else {
      await db.rpc("record_import_success", { p_import_batch_id: batchId });
      success++;
    }

    if ((i + 1) % BATCH_LOG_INTERVAL === 0) {
      console.log(`...${i + 1}/${dataRows.length} processed (success=${success}, duplicate=${duplicate}, error=${error})`);
    }
  }

  if (!isDryRun) {
    await db.rpc("finalize_import_batch", { p_import_batch_id: batchId, p_total_rows: dataRows.length });
  }

  console.log("\n=== Summary ===");
  console.log(`Total rows: ${dataRows.length}`);
  console.log(`Success: ${success}, Duplicate: ${duplicate}, Error: ${error}`);

  if (unmappedSymbols.size > 0) {
    console.log("\nUnmapped symbols (row count):");
    for (const [sym, count] of [...unmappedSymbols.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${sym}: ${count}`);
    }
  }
  if (unmappedAnalysts.size > 0) {
    console.log("\nUnmapped analyst codes (row count):");
    for (const [code, count] of [...unmappedAnalysts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${code}: ${count}`);
    }
  }

  if (isDryRun) {
    console.log("\nDRY RUN -- nothing was written to the database.");
  } else {
    console.log(`\nImport batch: ${batchId}`);
    console.log("Check import_batches and import_errors in the SQL Editor to confirm reconciliation.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
