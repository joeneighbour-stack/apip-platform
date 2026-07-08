// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Actual Trade Importer — Acuity Performance API
// ============================================================================
// Fetches analyst trades from the n8n webhook, normalises them, and upserts
// into actual_trades. Filters to ReportType=Analyst only (Pattern support TBD).
//
// Usage:
//   npx tsx src/scripts/importActualTrades.ts --dry-run
//   npx tsx src/scripts/importActualTrades.ts                    # incremental from last sync
//   npx tsx src/scripts/importActualTrades.ts --from=2026-01-01  # from specific date
//   npx tsx src/scripts/importActualTrades.ts --from=2024-01-01 --to=2026-07-01  # full backfill
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, N8N_WEBHOOK_URL
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL ?? 'https://n8n.srv1104653.hstgr.cloud/webhook/8c614cce-75ce-448d-9fb4-8c7f234dfedd'
const WEBHOOK_USERNAME = process.env.N8N_WEBHOOK_USERNAME ?? 'product'
const WEBHOOK_PASSWORD = process.env.N8N_WEBHOOK_PASSWORD ?? 'barcelona123'

// Analyst code → display name for lookup
const ANALYST_CODE_MAP: Record<string, string> = {
  IAN:        'Ian Coleman',
  KG:         'Khaled Gad',
  MAG:        'Maged Darwish',
  MOH:        'Mona Hassan',
  MONA:       'Mona Hassan',
  MPH:        'Mona Hassan',
  TIV:        'Tibor Vrbovsky',
  TIVS:       'Tibor Vrbovsky',
  JN:         'Joe Neighbour',
}

// Symbol normalisations — API name → APIP market symbol
const SYMBOL_OVERRIDES: Record<string, string> = {
  'US100':                'NASDAQ',
  'NAS100':               'NASDAQ',
  'WTI':                  'Oil',
  'CRUDE':                'Oil',
  'XAUUSD':               'Gold',
  'XAGUSD':               'Silver',
  'BTCUSD':               'Bitcoin',
  'ETHUSD':               'Ethereum',
  'UK100':                'FTSE',
  'GER30':                'DAX',
  'GER40':                'DAX',
  'FRA40':                'CAC',
  'JP225':                'NIKKEI',
  'NIK225':               'NIKKEI',
  'AUS200':               'ASX200',
  'HK50':                 'HS50',
  'CHN50':                'CHINA A50',
  'CHINA50':              'CHINA A50',
  'US30':                 'DOW',
  'DOWJONES':             'DOW',
  'SPX500':               'SP500',
  'US500':                'SP500',
  'US2000':               'US2000',
  'COPPER':               'Copper',
  'PLATINUM':             'Platinum',
  'PALLADIUM':            'Palladium',
  'NATGAS':               'Natural Gas',
  'NATURAL GAS':          'Natural Gas',
  'NATURAL GAS.1':        'Natural Gas',
  'BRENT':                'Brent',
  'XRP':                  'Ripple',
  // Equities not in APIP market universe -- will be skipped
}

// Derive session from publication hour (UTC)
function deriveSession(publishedAt: string, assetClass: string): string {
  const hour = new Date(publishedAt).getUTCHours()
  if (hour >= 5 && hour < 12) return 'EUROPEAN'
  if (hour >= 12 && hour < 16) return 'US'
  return 'APAC'
}

// Cap extreme RR values — data errors can produce 50R+ or -10R
function capResultR(rr: number | null, triggered: boolean): number | null {
  if (!triggered || rr === null) return null
  if (rr > 10) return 3   // unrealistic win — cap at 3R
  if (rr < -2) return -1  // unrealistic loss — cap at -1R
  return Math.round(rr * 10000) / 10000 // 4dp
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const isDryRun = process.argv.includes('--dry-run')
  const fromArg = process.argv.find(a => a.startsWith('--from='))?.split('=')[1]
  const toArg = process.argv.find(a => a.startsWith('--to='))?.split('=')[1]

  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  console.log(`\n=== APIP Actual Trade Importer ===`)
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)

  // ── Determine sync window ────────────────────────────────────────────────
  let fromDate: string
  let toDate = toArg ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  if (fromArg) {
    fromDate = fromArg
    console.log(`Sync window: ${fromDate} → ${toDate} (explicit)`)
  } else {
    // Find last successful ACUITY_PERFORMANCE_API sync
    const { data: lastBatch } = await db
      .from('import_batches')
      .select('date_range_end, finished_at')
      .eq('source_system', 'ACUITY_PERFORMANCE_API')
      .eq('status', 'SUCCESS')
      .order('finished_at', { ascending: false })
      .limit(1)
      .single()

    if (lastBatch?.date_range_end) {
      // Go back 1 day to catch any late-arriving trades
      const lastSync = new Date(lastBatch.date_range_end)
      lastSync.setDate(lastSync.getDate() - 1)
      fromDate = lastSync.toISOString().slice(0, 10)
      console.log(`Sync window: ${fromDate} → ${toDate} (incremental from last sync)`)
    } else {
      // No previous sync -- default to 2026-06-19 (manual backfill ends 2026-06-18)
      fromDate = '2026-06-19'
      console.log(`Sync window: ${fromDate} → ${toDate} (no previous sync, using default)`)
    }
  }

  // ── Load lookups ─────────────────────────────────────────────────────────
  const { data: analysts } = await db.from('analysts').select('analyst_id, display_name')
  const analystIdByName = new Map((analysts ?? []).map(a => [a.display_name, a.analyst_id]))

  // Build analyst code → analyst_id map
  const analystIdByCode = new Map<string, string>()
  for (const [code, name] of Object.entries(ANALYST_CODE_MAP)) {
    const id = analystIdByName.get(name)
    if (id) analystIdByCode.set(code, id)
    else console.warn(`  Warning: analyst "${name}" (${code}) not found in DB`)
  }

  const { data: markets } = await db.from('markets').select('market_id, symbol')
  const marketIdBySymbol = new Map<string, string>()
  for (const m of (markets ?? [])) {
    marketIdBySymbol.set(m.symbol.toLowerCase(), m.market_id)
    marketIdBySymbol.set(m.symbol, m.market_id)
  }

  console.log(`\nAnalysts mapped: ${analystIdByCode.size}/${Object.keys(ANALYST_CODE_MAP).length}`)
  console.log(`Markets in DB: ${markets?.length ?? 0}`)

  // ── Start import batch ───────────────────────────────────────────────────
  let batchId: string | null = null
  if (!isDryRun) {
    const { data: principal } = await db
      .from('service_principals')
      .select('service_principal_id')
      .eq('name', 'ACUITY_PERFORMANCE_IMPORTER')
      .single()

    const { data: batch } = await db.from('import_batches').insert({
      source_system: 'ACUITY_PERFORMANCE_API',
      target_table: 'actual_trades',
      batch_type: fromArg?.startsWith('20') && fromArg < '2026-01-01' ? 'HISTORICAL_BACKFILL' : 'INCREMENTAL_API_SYNC',
      triggered_by_type: 'SYSTEM',
      triggered_by_id: principal?.service_principal_id,
      date_range_start: fromDate,
      date_range_end: toDate,
      status: 'RUNNING',
      total_rows: 0, success_rows: 0, duplicate_rows: 0, error_rows: 0,
      started_at: new Date().toISOString(),
    }).select('import_batch_id').single()

    batchId = batch?.import_batch_id ?? null
    console.log(`Import batch: ${batchId}`)
  }

  // ── Fetch from webhook ───────────────────────────────────────────────────
  console.log(`\nFetching from webhook...`)
  const fetchStart = Date.now()

  let rawTrades: any[] = []
  try {
    const credentials = Buffer.from(`${WEBHOOK_USERNAME}:${WEBHOOK_PASSWORD}`).toString('base64')
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: JSON.stringify({ from: fromDate, to: toDate }),
    })
    if (!res.ok) {
      console.error(`Webhook returned HTTP ${res.status}`)
      process.exit(1)
    }
    rawTrades = await res.json()
  } catch (err) {
    console.error('Webhook fetch failed:', (err as Error).message)
    process.exit(1)
  }

  console.log(`Fetched ${rawTrades.length} raw records in ${Date.now() - fetchStart}ms`)

  // ── Filter to Analyst only ───────────────────────────────────────────────
  const analystTrades = rawTrades.filter(t =>
    t.ReportType === 'Analyst' &&
    !['STEVE TEST', 'TEST'].includes((t.Analyst ?? '').toUpperCase().trim())
  )
  const patternCount = rawTrades.length - analystTrades.length
  console.log(`  Analyst trades: ${analystTrades.length}, Pattern (skipped): ${patternCount}`)

  // ── Normalise and upsert ─────────────────────────────────────────────────
  let successRows = 0, duplicateRows = 0, errorRows = 0
  let unknownAnalysts = new Set<string>()
  let unknownSymbols = new Set<string>()

  for (const t of analystTrades) {
    // Resolve analyst
    const analystCode = (t.Analyst ?? '').toUpperCase().trim()
    const analystId = analystIdByCode.get(analystCode)
    if (!analystId) {
      unknownAnalysts.add(analystCode || '(empty)')
      errorRows++
      continue
    }

    // Resolve symbol
    const rawSymbol = (t.Symbol ?? '').trim()
    const normSymbol = SYMBOL_OVERRIDES[rawSymbol.toUpperCase()] ?? SYMBOL_OVERRIDES[rawSymbol] ?? rawSymbol
    const marketId = marketIdBySymbol.get(normSymbol) ?? marketIdBySymbol.get(normSymbol.toLowerCase())
    if (!marketId) {
      unknownSymbols.add(rawSymbol)
      errorRows++
      continue
    }

    // Normalise fields
    const triggered = t.Triggered === true
    const resultR = capResultR(t.RR ?? null, triggered)
    const direction = (t.Direction ?? '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY'
    const session = deriveSession(t.PublicationDate, t.AssetClass)

    const tradeRow = {
      source_system: 'ACUITY_PERFORMANCE_API',
      source_record_id: t.ReportId,
      historical_backfill: false,
      import_batch_id: batchId,
      imported_at: new Date().toISOString(),
      published_at: t.PublicationDate,
      analyst_id: analystId,
      market_id: marketId,
      session,
      direction,
      entry: t.Entry ?? null,
      stop: t.StopLoss ?? null,
      target: t.TakeProfit ?? null,
      expiry: t.Expiry ?? null,
      triggered,
      closed_at: t.ExitDate ?? null,
      result_r: resultR,
      raw_payload: t,
    }

    if (isDryRun) {
      successRows++
      continue
    }

    const { error, status } = await db
      .from('actual_trades')
      .upsert(tradeRow, { onConflict: 'source_system,source_record_id' })

    if (error) {
      console.error(`  Error on ${t.ReportId}: ${error.message}`)
      errorRows++

      if (batchId) {
        await db.from('import_errors').insert({
          import_batch_id: batchId,
          source_record_id: t.ReportId,
          error_type: 'SCHEMA_MISMATCH',
          error_detail: error.message,
          raw_payload: { response_body: t },
          resolved: false,
        })
      }
    } else if (status === 200) {
      duplicateRows++ // existing row updated
    } else {
      successRows++
    }
  }

  // ── Link to recommendation_versions (post-platform trades) ───────────────
  if (!isDryRun && successRows > 0) {
    console.log('\nLinking new trades to recommendation_versions...')
    let linked = 0

    // Find recently inserted unlinked trades from this batch
    const { data: newTrades } = await db
      .from('actual_trades')
      .select('trade_id, analyst_id, market_id, direction, published_at')
      .eq('import_batch_id', batchId!)
      .is('recommendation_version_id', null)
      .eq('historical_backfill', false)
      .gte('published_at', '2026-07-01') // only platform-era trades

    for (const trade of (newTrades ?? [])) {
      // Find coaching recommendation shown within 4 hours before trade publication
      const pubTime = new Date(trade.published_at)
      const windowStart = new Date(pubTime.getTime() - 4 * 60 * 60 * 1000).toISOString()

      const { data: coaching } = await db
        .from('coaching_recommendations')
        .select('recommendation_id, active_recommendation_version_id, opportunity_id')
        .eq('analyst_id', trade.analyst_id)
        .gte('shown_at', windowStart)
        .lte('shown_at', trade.published_at)
        .order('shown_at', { ascending: false })
        .limit(1)
        .single()

      if (!coaching) continue

      // Verify market and direction match via opportunity
      const { data: opp } = await db
        .from('opportunities')
        .select('market_id, direction')
        .eq('opportunity_id', coaching.opportunity_id)
        .single()

      if (!opp || opp.market_id !== trade.market_id || opp.direction !== trade.direction) continue

      await db.from('actual_trades')
        .update({
          opportunity_id: coaching.opportunity_id,
          recommendation_version_id: coaching.active_recommendation_version_id,
        })
        .eq('trade_id', trade.trade_id)

      linked++
    }

    console.log(`  Linked ${linked} trades to recommendation_versions`)
  }

  // ── Finalise batch ───────────────────────────────────────────────────────
  if (!isDryRun && batchId) {
    const status = errorRows > 0 && successRows === 0 ? 'FAILED'
      : errorRows > 0 ? 'PARTIAL_SUCCESS'
      : 'SUCCESS'

    await db.from('import_batches').update({
      status,
      total_rows: analystTrades.length,
      success_rows: successRows,
      duplicate_rows: duplicateRows,
      error_rows: errorRows,
      finished_at: new Date().toISOString(),
    }).eq('import_batch_id', batchId)
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n=== SUMMARY ===')
  console.log(`Total fetched:    ${rawTrades.length}`)
  console.log(`Analyst trades:   ${analystTrades.length}`)
  console.log(`Inserted:         ${successRows}`)
  console.log(`Updated:          ${duplicateRows}`)
  console.log(`Errors:           ${errorRows}`)

  if (unknownAnalysts.size > 0) {
    console.log(`Unknown analysts: ${[...unknownAnalysts].join(', ')}`)
  }
  if (unknownSymbols.size > 0) {
    const shown = [...unknownSymbols].slice(0, 10)
    console.log(`Unknown symbols:  ${shown.join(', ')}${unknownSymbols.size > 10 ? ` ... +${unknownSymbols.size - 10} more` : ''}`)
  }

  if (isDryRun) console.log('\nDRY RUN -- nothing written.')
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
