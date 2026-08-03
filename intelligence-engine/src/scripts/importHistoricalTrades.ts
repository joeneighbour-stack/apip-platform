// Historical Trade Importer
// Imports triggered trades from the P_L_Data.csv into actual_trades and analyst_publications
// Only imports pre-2023 rows (2023+ already covered by webhook)
// Safe to re-run — skips existing source_record_ids

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const CSV_PATH = process.env.CSV_PATH ?? './P_L_Data.csv'
const DRY_RUN = process.env.DRY_RUN === 'true'
const CUTOFF_DATE = process.env.CUTOFF_DATE ?? '2023-08-01' // Only import before this date

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Analyst code -> display_name mapping
const ANALYST_MAP: Record<string, string> = {
  'IC':   'Ian Coleman',
  'Ian':  'Ian Coleman',
  'JN':   'Joe Neighbour',
  'JPW':  'Jamie Packenham-Walsh',
  'JoD':  'Joe Damian',
  'KG':   'Khaled Gad',
  'MAG':  'Maged Darwish',
  'MOH':  'Mona Hassan',
  'MONA': 'Mona Hassan',
  'SO':   "Steve O'Hare",
  'TIV':  'Tibor Vrbovsky',
  'taf':  'Taf Nyabanga',
}

// Symbol aliases — map CSV symbols to APIP market symbols
const SYMBOL_OVERRIDES: Record<string, string> = {
  'Brent Oil': 'Brent',
  'Bitcoin Cash': 'Bitcoin Cash',
  'Binance Coin': 'Binance Coin',
  'NAS': 'NASDAQ',
  'ESP35': 'SKIP',
  'S30': 'SKIP',
  'NIFTY': 'SKIP',
  'SSE COMP': 'SKIP',
}

function parseDate(dateStr: string): string | null {
  // Format: D/M/YYYY or DD/MM/YYYY
  const parts = dateStr.trim().split('/')
  if (parts.length !== 3) return null
  const day = parts[0].padStart(2, '0')
  const month = parts[1].padStart(2, '0')
  const year = parts[2]
  if (year.length !== 4) return null
  return `${year}-${month}-${day}`
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n').filter(l => l.trim())
  const headers = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const values = line.split(',')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim() })
    return row
  })
}

async function main() {
  console.log('=== APIP Historical Trade Importer ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Cutoff date: ${CUTOFF_DATE} (only importing before this)`)

  // Load analysts
  const { data: analysts } = await db.from('analysts').select('analyst_id, display_name')
  const analystIdByName = new Map((analysts ?? []).map((a: any) => [a.display_name, a.analyst_id]))
  console.log(`Analysts loaded: ${analystIdByName.size}`)

  // Load markets
  const { data: markets } = await db.from('markets').select('market_id, symbol')
  const marketIdBySymbol = new Map((markets ?? []).map((m: any) => [m.symbol, m.market_id]))
  console.log(`Markets loaded: ${marketIdBySymbol.size}`)

  // Load existing source_record_ids to avoid duplicates
  const { data: existing } = await db
    .from('actual_trades')
    .select('source_record_id')
    .eq('source_system', 'MANUAL_BACKFILL')
  const existingIds = new Set((existing ?? []).map((r: any) => r.source_record_id))
  console.log(`Existing historical trades: ${existingIds.size}`)

  // Create import batch
  let batchId = DRY_RUN ? 'DRY_RUN' : 'eaa5252a-946f-4404-b0ee-965192dde6ac'
  console.log(`Import batch: ${batchId}`)

  // Parse CSV
  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8')
  const rows = parseCSV(csvContent)
  console.log(`\nCSV rows: ${rows.length}`)

  let inserted = 0, skipped = 0, errors = 0, outOfScope = 0, duplicates = 0
  const unknownAnalysts = new Set<string>()
  const unknownSymbols = new Set<string>()
  const tradeRows: any[] = []
  const pubRows: any[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const id = row['ID']?.trim() ?? String(i)
    const dateStr = row['DATE']?.trim() ?? ''
    const symbol = row['SYMBOL']?.trim() ?? ''
    const analystCode = row['ANALYST']?.trim() ?? ''
    const tradeDir = row['TRADE']?.trim().toUpperCase() ?? ''
    const entry = parseFloat(row['ENTRY'] ?? '0')
    const stop = parseFloat(row['STOP'] ?? '0')
    const target = parseFloat(row['TARGET'] ?? '0')
    const exit = parseFloat(row['EXIT'] ?? '0')
    const rr = parseFloat(row['R/R'] ?? '0')

    // Parse date
    const isoDate = parseDate(dateStr)
    if (!isoDate) { errors++; continue }

    // Only import before cutoff
    if (isoDate >= CUTOFF_DATE) { skipped++; continue }

    // Skip unknown analysts
    const analystName = ANALYST_MAP[analystCode]
    if (!analystName) {
      unknownAnalysts.add(analystCode)
      outOfScope++
      continue
    }

    const analystId = analystIdByName.get(analystName)
    if (!analystId) { outOfScope++; continue }

    // Resolve symbol
    const normSymbol = SYMBOL_OVERRIDES[symbol] ?? symbol
    if (normSymbol === 'SKIP') { outOfScope++; continue }

    const marketId = marketIdBySymbol.get(normSymbol)
    if (!marketId) {
      unknownSymbols.add(symbol)
      outOfScope++
      continue
    }

    // Direction
    const direction = tradeDir === 'SELL' ? 'SELL' : 'BUY'

    // Source record ID — use CSV ID + date + symbol for uniqueness
    const sourceRecordId = `CSV-${id.replace(/\s/g, '')}-${isoDate}-${analystCode}-${normSymbol}-${direction}`

    // Skip duplicates
    if (existingIds.has(sourceRecordId)) { duplicates++; continue }

    // Published at — use 08:00 UTC as default time
    const publishedAt = `${isoDate}T08:00:00Z`

    tradeRows.push({
      source_system: 'MANUAL_BACKFILL',
      source_record_id: sourceRecordId,
      import_batch_id: batchId,
      analyst_id: analystId,
      market_id: marketId,
      direction,
      entry: isNaN(entry) ? null : entry,
      stop: isNaN(stop) ? null : stop,
      target: isNaN(target) ? null : target,
      published_at: publishedAt,
      triggered: true,
      result_r: isNaN(rr) ? null : rr,
      historical_backfill: true,
      is_overridden: true,
      raw_payload: { id, date: dateStr, symbol, analyst: analystCode, trade: tradeDir, entry, stop, target, exit, rr },
    })

    pubRows.push({
      source_system: 'MANUAL_BACKFILL',
      source_record_id: `PUB-${sourceRecordId}`,
      import_batch_id: batchId,
      analyst_id: analystId,
      market_id: marketId,
      direction,
      published_at: publishedAt,
      reconciliation_status: 'WEBHOOK_TRUE',
      original_triggered: true,
      effective_triggered: true,
      raw_payload: { source: 'historical_csv' },
    })
  }

  console.log(`\nProcessed:`)
  console.log(`  To insert: ${tradeRows.length}`)
  console.log(`  Skipped (post-cutoff): ${skipped}`)
  console.log(`  Out of scope: ${outOfScope}`)
  console.log(`  Duplicates: ${duplicates}`)
  console.log(`  Errors: ${errors}`)
  console.log(`  Unknown analysts: ${[...unknownAnalysts].join(', ')}`)
  console.log(`  Unknown symbols (${unknownSymbols.size}): ${[...unknownSymbols].slice(0, 20).join(', ')}`)

  if (DRY_RUN) {
    console.log('\nDRY RUN complete — no data written')
    console.log(`Sample trade row:`, JSON.stringify(tradeRows[0], null, 2))
    return
  }

  // Batch upsert actual_trades
  const BATCH_SIZE = 500
  let processed = 0
  for (let i = 0; i < tradeRows.length; i += BATCH_SIZE) {
    const batch = tradeRows.slice(i, i + BATCH_SIZE)
    const { error } = await db
      .from('actual_trades')
      .upsert(batch, { onConflict: 'source_system,source_record_id' })
    if (error) {
      console.error(`  Batch error at ${i}: ${error.message}`)
      errors += batch.length
    } else {
      inserted += batch.length
    }
    processed += batch.length
    process.stdout.write(`\r  Upserted ${processed}/${tradeRows.length}`)
  }
  console.log('')

  // Batch upsert analyst_publications
  let pubProcessed = 0
  for (let i = 0; i < pubRows.length; i += BATCH_SIZE) {
    const batch = pubRows.slice(i, i + BATCH_SIZE)
    const { error } = await db
      .from('analyst_publications')
      .upsert(batch, { onConflict: 'source_system,source_record_id' })
    if (error) console.error(`  Pub batch error: ${error.message}`)
    pubProcessed += batch.length
    process.stdout.write(`\r  Publications upserted ${pubProcessed}/${pubRows.length}`)
  }
  console.log('')

  // Update batch status
  await db
    .from('import_batches')
    .update({
      status: errors > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
      finished_at: new Date().toISOString(),
      total_rows: tradeRows.length,
      success_rows: inserted,
      error_rows: errors,
    })
    .eq('import_batch_id', batchId)

  console.log(`\n=== SUMMARY ===`)
  console.log(`Inserted: ${inserted}`)
  console.log(`Errors:   ${errors}`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })





