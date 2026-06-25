// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Phase 1.4 — Full historical publication pull (2022 -> today), chunked monthly
// ============================================================================
// Calls the already-deployed acuity-performance-importer Edge Function once
// per calendar month, rather than one giant request spanning years. This
// matters for two real reasons, not just caution for its own sake:
//   1. A single request covering 4+ years could plausibly exceed the Edge
//      Function's execution time limit or memory, especially given one
//      month alone returned 935 records.
//   2. Chunking means a failure partway through loses at most one month of
//      progress, not the whole run -- and this script logs per-month
//      results so you can see exactly where it got to if it stops.
//
// Run:
//   node scripts/run-full-publication-backfill.js
//
// Required environment variables:
//   SUPABASE_ANON_KEY   (the anon/public key -- this calls the Edge Function
//                        over HTTP, same as the manual PowerShell test calls)
//
// This does NOT call the database directly -- it calls your deployed
// Edge Function, which itself handles the webhook auth and all the
// upsert/reconciliation logic already tested today.
// ============================================================================

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const FUNCTION_URL = "https://kdpcpdgskjkfcvoieiuw.supabase.co/functions/v1/acuity-performance-importer";

if (!SUPABASE_ANON_KEY) {
  console.error("SUPABASE_ANON_KEY must be set as an environment variable.");
  process.exit(1);
}

function monthRanges(startYear, startMonth, endDate) {
  const ranges = [];
  let year = startYear;
  let month = startMonth; // 1-indexed
  while (true) {
    const rangeStart = new Date(Date.UTC(year, month - 1, 1));
    if (rangeStart >= endDate) break;
    let nextMonth = month + 1;
    let nextYear = year;
    if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
    let rangeEnd = new Date(Date.UTC(nextYear, nextMonth - 1, 1));
    if (rangeEnd > endDate) rangeEnd = endDate;
    ranges.push({
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
    });
    year = nextYear;
    month = nextMonth;
  }
  return ranges;
}

async function callImporterForRange(from, to) {
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode: "BACKFILL", dateRangeStart: from, dateRangeEnd: to }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

async function main() {
  // Webhook confirmed depth: ~2022 onward. End date: today, so we capture
  // everything up to the present in one pass.
  const today = new Date();
  const ranges = monthRanges(2022, 1, today);

  console.log(`Running ${ranges.length} monthly chunks from ${ranges[0].from} to ${ranges[ranges.length - 1].to}.`);
  console.log("Each chunk is a separate request to the deployed Edge Function -- this will take a while.\n");

  const summary = [];

  for (const range of ranges) {
    console.log(`--- ${range.from} to ${range.to} ---`);
    try {
      const result = await callImporterForRange(range.from, range.to);
      console.log(`  processed=${result.processed} success=${result.success} duplicate=${result.duplicate} errors=${result.errors} (batch ${result.importBatchId})`);
      summary.push({ ...range, ...result, failed: false });
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      summary.push({ ...range, failed: true, error: err.message });
      // Continue to the next month rather than aborting the whole run --
      // a single bad month (e.g. a transient network blip) shouldn't lose
      // years of otherwise-successful progress. Failed months are listed
      // clearly in the final summary so they can be re-run individually.
    }
    // Small delay between requests to avoid hammering the webhook/Edge
    // Function back-to-back with no breathing room.
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n=== Full run summary ===");
  let totalProcessed = 0, totalSuccess = 0, totalDuplicate = 0, totalErrors = 0;
  const failedRanges = [];
  for (const s of summary) {
    if (s.failed) {
      failedRanges.push(s);
      continue;
    }
    totalProcessed += s.processed;
    totalSuccess += s.success;
    totalDuplicate += s.duplicate;
    totalErrors += s.errors;
  }
  console.log(`Total processed: ${totalProcessed}, success: ${totalSuccess}, duplicate: ${totalDuplicate}, errors: ${totalErrors}`);

  if (failedRanges.length > 0) {
    console.log(`\n${failedRanges.length} month(s) FAILED entirely and need to be re-run manually:`);
    for (const f of failedRanges) {
      console.log(`  ${f.from} to ${f.to}: ${f.error}`);
    }
  } else {
    console.log("\nAll months completed without a request-level failure.");
    console.log("Check import_errors in the SQL Editor for any row-level errors (unmapped symbols/analysts) within successful months.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
