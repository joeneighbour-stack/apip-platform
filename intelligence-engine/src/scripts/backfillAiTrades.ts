// ============================================================================
// APIP Trading Intelligence & Performance Platform
// AI Trades One-Time Backfill
// ============================================================================
// Fetches the full AI-signal history from the signal-performance webhook
// (2023-10-01 to today) and upserts it into ai_trades (migration 066).
// Safe to re-run: ignoreDuplicates means an existing report_id is skipped,
// never overwritten -- re-running this picks up only genuinely new rows.
//
// Run once: npx tsx src/scripts/backfillAiTrades.ts
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Same webhook as importActualTrades.ts/backfillPatternTrades.ts -- duplicated
// rather than imported, matching this codebase's existing convention for
// standalone scripts with no shared module between them (see e.g.
// preallocateDay.ts's own comment on SESSION_MARKETS).
const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL ?? 'https://n8n.srv1104653.hstgr.cloud/webhook/signal-performance'
const WEBHOOK_USERNAME = process.env.N8N_WEBHOOK_USERNAME ?? 'product'
const WEBHOOK_PASSWORD = process.env.N8N_WEBHOOK_PASSWORD ?? 'barcelona123'

const FROM_DATE = '2023-10-01'

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const isDryRun = process.argv.includes('--dry-run')
  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const toDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  console.log(`\n=== APIP AI Trades Backfill ===`)
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Window: ${FROM_DATE} → ${toDate}`)

  // ── Fetch from webhook ───────────────────────────────────────────────────
  console.log(`\nFetching from webhook...`)
  const fetchStart = Date.now()

  const MAX_FETCH_ATTEMPTS = 3
  const RETRY_DELAY_MS = 5000

  let rawTrades: any[] = []
  let fetchSucceeded = false
  let lastFetchError = ''

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const credentials = Buffer.from(`${WEBHOOK_USERNAME}:${WEBHOOK_PASSWORD}`).toString('base64')
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${credentials}`,
        },
        body: JSON.stringify({ from: FROM_DATE, to: toDate }),
      })
      if (!res.ok) {
        throw new Error(`Webhook returned HTTP ${res.status}`)
      }
      rawTrades = await res.json()
      fetchSucceeded = true
      break
    } catch (err) {
      lastFetchError = (err as Error).message
      console.error(`Webhook fetch attempt ${attempt}/${MAX_FETCH_ATTEMPTS} failed: ${lastFetchError}`)
      if (attempt < MAX_FETCH_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }
  }

  if (!fetchSucceeded) {
    console.error(`\nWebhook fetch failed after ${MAX_FETCH_ATTEMPTS} attempts. Last error: ${lastFetchError}`)
    process.exit(1)
  }

  console.log(`Fetched ${rawTrades.length} raw records in ${Date.now() - fetchStart}ms`)

  // ── Filter to AI only, normalise ─────────────────────────────────────────
  // Same field mapping as importActualTrades.ts's AI-trade routing --
  // duplicated for the same no-shared-module reason as the webhook constants
  // above.
  const aiRows = rawTrades
    .filter(t => t.ReportType === 'AI' && t.ReportId)
    .map(t => ({
      report_id:       t.ReportId as string,
      symbol:          (t.Symbol as string ?? '').replace('/', ''),
      asset_name:      t.Name ?? null,
      asset_class:     t.AssetClass ?? null,
      direction:       t.Direction ? (t.Direction as string).toUpperCase() : null,
      status:          t.Status ?? null,
      confidence:      t.Confidence ?? null,
      published_at:    t.PublicationDate ?? null,
      exit_date:       t.ExitDate ?? null,
      expiry:          t.Expiry ?? null,
      entry:           t.Entry ?? null,
      stop_loss:       t.StopLoss ?? null,
      take_profit:     t.TakeProfit ?? null,
      exit_price:      t.ExitPrice ?? null,
      rr:              t.RR ?? null,
      triggered:       t.Triggered ?? false,
      return_pct:      t.Return ?? null,
      source_system:   'ACUITY_PERFORMANCE_API',
      import_batch_id: null,
    }))

  console.log(`AI trades: ${aiRows.length} (of ${rawTrades.length} total records)`)

  if (isDryRun) {
    console.log('\nDRY RUN -- nothing written.')
    return
  }

  // ── Upsert in batches, ignoreDuplicates ──────────────────────────────────
  // .select('report_id') after the upsert is what makes "inserted vs skipped"
  // countable at all: ON CONFLICT DO NOTHING (ignoreDuplicates: true) returns
  // only the rows actually written in its RETURNING set, so a conflicting
  // (already-imported) row is simply absent from the response rather than
  // flagged -- the gap between batch size and returned-row count is the
  // duplicate count.
  const AI_BATCH = 200
  let totalInserted = 0
  let totalDuplicates = 0
  let totalErrors = 0

  for (let i = 0; i < aiRows.length; i += AI_BATCH) {
    const batch = aiRows.slice(i, i + AI_BATCH)
    const { data, error } = await db
      .from('ai_trades')
      .upsert(batch, { onConflict: 'report_id', ignoreDuplicates: true })
      .select('report_id')

    if (error) {
      console.error(`  Batch error at ${i}: ${error.message}`)
      totalErrors += batch.length
    } else {
      const inserted = data?.length ?? 0
      totalInserted += inserted
      totalDuplicates += batch.length - inserted
    }
    process.stdout.write(`\r  Processed ${Math.min(i + AI_BATCH, aiRows.length)}/${aiRows.length}`)
  }
  console.log('')

  console.log('\n=== SUMMARY ===')
  console.log(`Total fetched:     ${rawTrades.length}`)
  console.log(`AI trades:         ${aiRows.length}`)
  console.log(`Inserted:          ${totalInserted}`)
  console.log(`Duplicates skipped: ${totalDuplicates}`)
  console.log(`Errors:            ${totalErrors}`)
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
