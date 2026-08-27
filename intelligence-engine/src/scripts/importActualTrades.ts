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

const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL ?? 'https://n8n.srv1104653.hstgr.cloud/webhook/signal-performance'
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
  // Duplicate feed for Natural Gas -- already covered by the NATGAS/NATURAL GAS
  // alias below. Matched case-insensitively via rawSymbol.toUpperCase(), so one
  // uppercase key is enough; the API has been observed sending both
  // "NATURAL GAS.1" and "Natural Gas.1" for this same duplicate feed.
  'NATURAL GAS.1': 'SKIP',
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
  'XCUUSD':               'Copper',
  'COPPER':               'Copper',
  'PLATINUM':             'Platinum',
  'PALLADIUM':            'Palladium',
  'NATGAS':               'Natural Gas',
  'NATURAL GAS':          'Natural Gas',
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
  // Both declared here, before the try block, so the catch handler below can
  // mark the batch FAILED (using the same client, not a second one) regardless
  // of where inside main() an unhandled error is thrown -- previously an error
  // anywhere past batch creation left the row stuck at RUNNING forever, since
  // nothing downstream of the try/catch site in the outer main().catch() ever
  // touched import_batches.
  let batchId: string | null = null
  let db: SupabaseClient | null = null

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
      process.exit(1)
    }

    const isDryRun = process.argv.includes('--dry-run')
    const fromArg = process.argv.find(a => a.startsWith('--from='))?.split('=')[1]
    const toArg = process.argv.find(a => a.startsWith('--to='))?.split('=')[1]

    db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })

    console.log(`\n=== APIP Actual Trade Importer ===`)
    console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)

    // ── Watchdog mode ────────────────────────────────────────────────────────
    // Run by import-watchdog.yml as a third chance after the 07:30/08:30 scheduled
    // imports, in case GitHub Actions silently skipped both. Safe to run even if a
    // scheduled import already succeeded: skip the (slow, rate-limited) webhook
    // fetch entirely if today's ACUITY_PERFORMANCE_API trades are already present.
    if (process.env.WATCHDOG_MODE === 'true') {
      const today = new Date().toISOString().slice(0, 10)
      const { data: todayTrades } = await db
        .from('actual_trades')
        .select('trade_id')
        .eq('source_system', 'ACUITY_PERFORMANCE_API')
        .gte('published_at', today)
        .limit(1)

      if (todayTrades && todayTrades.length > 0) {
        console.log(`Import already ran today, skipping`)
        process.exit(0)
      }
      console.log(`Watchdog: no ACUITY_PERFORMANCE_API trades found for ${today} -- proceeding with import`)
    }

    // ── Determine sync window ────────────────────────────────────────────────
    // Hard floor -- manual backfill is source of truth before this date
    const MIN_API_DATE = '2026-06-19'

    // Distinct from MIN_API_DATE above: the webhook feed existed (and could be synced)
    // from MIN_API_DATE, but wasn't authoritative until the live feed fully took over --
    // the one-time MANUAL_BACKFILL upload is the complete, correct history for every date
    // before LIVE_API_START, so a same-day API row before it is dropped in favour of
    // backfill during dedup below rather than treated as a genuine additional trade.
    const LIVE_API_START = '2026-08-01'

    // Default: last 48 hours (catches same-day and yesterday's late publications).
    // Override via SYNC_DAYS_BACK env var, or pass --full-sync for a manual
    // historical re-run from LIVE_API_START (or --from= directly for anything
    // further back than that). Replaces the old "look up the last successful
    // import_batches row and sync from there" fallback -- that could silently
    // balloon into a large, slow window (and the historical-scan MANUAL_BACKFILL
    // dedup load below with it) if a scheduled run had been missed for several
    // days; a flat, predictable window is both faster and simpler to reason about,
    // and a real multi-day gap is caught by import-watchdog.yml or a manual
    // --full-sync rather than an ever-growing default.
    const DEFAULT_SYNC_DAYS = 2
    const syncDaysBack = process.env.SYNC_DAYS_BACK
      ? parseInt(process.env.SYNC_DAYS_BACK)
      : DEFAULT_SYNC_DAYS

    const isFullSync = process.argv.includes('--full-sync')

    let fromDate: string
    let toDate = toArg ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    if (fromArg) {
      // Enforce floor even on explicit --from argument
      fromDate = fromArg < MIN_API_DATE ? MIN_API_DATE : fromArg
      if (fromArg < MIN_API_DATE) {
        console.log(`  Warning: --from=${fromArg} is before MIN_API_DATE, clamped to ${MIN_API_DATE}`)
      }
      console.log(`Sync window: ${fromDate} → ${toDate} (explicit)`)
    } else if (isFullSync) {
      // Full historical window -- everything the live feed has been authoritative
      // for. Dates before this remain MANUAL_BACKFILL's domain; pass --from=
      // directly to reach further back than that.
      fromDate = LIVE_API_START
      console.log(`FULL SYNC: fetching from ${fromDate}`)
      console.log(`Sync window: ${fromDate} → ${toDate} (full sync)`)
    } else {
      // SYNC_DAYS_BACK env override, or the DEFAULT_SYNC_DAYS=2 (48h) default
      const daysBackDate = new Date(Date.now() - syncDaysBack * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      fromDate = daysBackDate < MIN_API_DATE ? MIN_API_DATE : daysBackDate
      if (daysBackDate < MIN_API_DATE) {
        console.log(`  Warning: SYNC_DAYS_BACK=${syncDaysBack} resolves before MIN_API_DATE, clamped to ${MIN_API_DATE}`)
      }
      console.log(`Sync window: ${fromDate} → ${toDate} (SYNC_DAYS_BACK=${syncDaysBack})`)
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

    // ── Load entry-zone map ──────────────────────────────────────────────────
    // market_state_daily.zone at the trade's published date, loaded once as a
    // market_id+date -> zone map (not queried per trade) so the import stays
    // fast. Only from 2026-01-01 onwards -- pre-2026 zone data is a known
    // artifact (99.8% ZONE_2, confirmed -- same boundary generateAnalystProfiles.ts's
    // ZONE_VALID_FROM already enforces). fromDate is always >= MIN_API_DATE
    // (2026-06-19), itself already past 2026-01-01, so this floor is a
    // defensive belt-and-braces bound rather than the one actually binding today.
    const ZONE_VALID_FROM = '2026-01-01'
    const zoneMapFromDate = fromDate > ZONE_VALID_FROM ? fromDate : ZONE_VALID_FROM
    const zoneMap = new Map<string, string>()
    if (zoneMapFromDate <= toDate) {
      const { data: dailyStates } = await db
        .from('market_state_daily')
        .select('market_id, date, zone')
        .gte('date', zoneMapFromDate)
        .lte('date', toDate)
      for (const row of dailyStates ?? []) {
        if (row.zone) zoneMap.set(`${row.market_id}:${row.date}`, row.zone)
      }
    }
    console.log(`Zone map loaded: ${zoneMap.size} market/date entries (from ${zoneMapFromDate})`)

    // ── Load existing MANUAL_BACKFILL trades for the sync window ────────────────
    // The webhook feed and the historical CSV backfill can both cover the same real
    // trade for dates at/after MIN_API_DATE (the backfill file wasn't cut off exactly
    // at the API cutover) -- without this check, importing inserts a second,
    // ACUITY_PERFORMANCE_API-sourced row for a trade that already exists as
    // MANUAL_BACKFILL, double-counting it in every downstream R calculation.
    // Paginated with a deterministic order: .range() without one doesn't guarantee
    // stable results across pages and can silently drop rows on a table this size.
    //
    // Only needed when fromDate reaches back before LIVE_API_START: the in-loop
    // check below (`tradeDate < LIVE_API_START && backfillKeys.has(...)`) can only
    // ever be true for a trade in that range, so there's nothing for this set to
    // protect once fromDate is already at or after LIVE_API_START -- true for every
    // normal 48-hour incremental run. Gated on the actual fromDate rather than
    // syncDaysBack itself: an explicit --from= before LIVE_API_START still needs
    // this loaded regardless of what SYNC_DAYS_BACK/DEFAULT_SYNC_DAYS resolved to,
    // since that variable doesn't reflect the real window once --from= or
    // --full-sync are involved.
    const needsBackfillDedup = fromDate < LIVE_API_START
    const backfillKeys = new Set<string>()
    if (needsBackfillDedup) {
      const PAGE_SIZE = 1000
      let page = 0
      let hasMore = true
      while (hasMore) {
        const { data } = await db
          .from('actual_trades')
          .select('analyst_id, market_id, direction, published_at')
          .eq('source_system', 'MANUAL_BACKFILL')
          .gte('published_at', fromDate)
          .order('trade_id', { ascending: true })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
        if (!data?.length) { hasMore = false } else {
          for (const t of data) {
            backfillKeys.add(`${t.analyst_id}::${t.market_id}::${t.direction}::${t.published_at.slice(0, 10)}`)
          }
          hasMore = data.length === PAGE_SIZE
          page++
        }
      }
      console.log(`MANUAL_BACKFILL trades in sync window: ${backfillKeys.size} (dedup keys)`)
    } else {
      console.log(`MANUAL_BACKFILL dedup skipped -- fromDate (${fromDate}) is at/after LIVE_API_START`)
    }

    // ── Load resolved-dispute-protected trades ───────────────────────────────
    // Trades with a RESOLVED dispute carrying override_values had their triggered/
    // result_r manually corrected by a manager (resolveDispute() in
    // apps/web/app/actions/disputes.ts) -- a re-import must never silently clobber
    // that correction back to whatever the webhook currently reports.
    const { data: resolvedDisputes } = await db
      .from('trade_disputes')
      .select('trade_id, override_values')
      .eq('status', 'RESOLVED')
      .not('override_values', 'is', null)

    const protectedTradeIds = new Set(
      (resolvedDisputes ?? []).map(d => d.trade_id)
    )
    console.log(`Protected trades (resolved disputes): ${protectedTradeIds.size}`)

    // The upsert below matches existing rows via onConflict: 'source_system,source_record_id'
    // (there is no in-memory "existing trades by dedup key" map anywhere in this file --
    // conflict resolution happens at the DB level, keyed on the webhook's own record id),
    // not trade_id -- so trade_id has to be resolved to its source_record_id here to be
    // checkable against each incoming webhook record in the main loop below. Scoped to
    // ACUITY_PERFORMANCE_API: this importer never touches MANUAL_BACKFILL rows, so a
    // protected MANUAL_BACKFILL trade can't be at risk from this upsert regardless.
    const protectedSourceRecordIds = new Set<string>()
    if (protectedTradeIds.size > 0) {
      const { data: protectedRows } = await db
        .from('actual_trades')
        .select('trade_id, source_record_id')
        .in('trade_id', [...protectedTradeIds])
        .eq('source_system', 'ACUITY_PERFORMANCE_API')
      for (const row of protectedRows ?? []) {
        if (row.source_record_id) protectedSourceRecordIds.add(row.source_record_id)
      }
    }
    console.log(`Protected source_record_ids (this source system): ${protectedSourceRecordIds.size}`)

    // ── Start import batch ───────────────────────────────────────────────────
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
          body: JSON.stringify({ from: fromDate, to: toDate }),
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
      if (batchId) {
        // batchId is only ever non-null when !isDryRun (batch creation itself is gated
        // on that), so this check alone is sufficient -- no separate !isDryRun guard needed.
        await db.from('import_batches').update({
          status: 'FAILED',
          finished_at: new Date().toISOString(),
          checksum_or_summary: `Webhook fetch failed: ${lastFetchError}`,
        }).eq('import_batch_id', batchId)
      }
      process.exit(1)
    }

    console.log(`Fetched ${rawTrades.length} raw records in ${Date.now() - fetchStart}ms`)

    // ── Filter to Analyst only ───────────────────────────────────────────────
    const analystTrades = rawTrades.filter(t => {
      if (t.ReportType !== 'Analyst') return false
      const code = (t.Analyst ?? '').toUpperCase().trim()
      if (['STEVE TEST', 'TEST'].includes(code)) return false
      if (/^\d+$/.test(code)) return false // 60, 80 are confidence values in wrong field
      return true
    })
    const patternCount = rawTrades.length - analystTrades.length
    console.log(`  Analyst trades: ${analystTrades.length}, Pattern (skipped): ${patternCount}`)

    // ── Normalise and upsert ─────────────────────────────────────────────────
    let successRows = 0, duplicateRows = 0, errorRows = 0, outOfScopeRows = 0, skippedBackfill = 0, skippedProtected = 0
    let unknownAnalysts = new Set<string>()
    let unknownSymbols = new Set<string>()
    const tradeRows: any[] = []
    const pubRows: any[] = []

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
      if (normSymbol === 'SKIP') { outOfScopeRows++; continue }
      const marketId = marketIdBySymbol.get(normSymbol) ?? marketIdBySymbol.get(normSymbol.toLowerCase())
      if (!marketId) {
        unknownSymbols.add(rawSymbol)
        outOfScopeRows++
        continue
      }

      // Normalise fields
      const triggered = t.Triggered === true
      const resultR = capResultR(t.RR ?? null, triggered)
      const direction = (t.Direction ?? '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY'
      const session = deriveSession(t.PublicationDate, t.AssetClass)

      // Skip trades with no entry price
      if (t.Entry == null) { errorRows++; continue }

      // Skip trades that already exist as MANUAL_BACKFILL for this analyst/market/
      // direction/day -- inserting an API-sourced row alongside it would double-count
      // the same real trade in every downstream R calculation. MANUAL_BACKFILL is only
      // authoritative before the live feed took over (LIVE_API_START) -- from that date
      // onward the API is primary, so a same-day backfill row (e.g. a manual correction
      // entered via the admin trade-entry form) must not suppress a genuine live-feed
      // trade; both are allowed to coexist and calculateKpis.ts's own per-day
      // source-preference dedup resolves any real overlap at aggregation time.
      const tradeDate = String(t.PublicationDate).slice(0, 10)
      const dedupKey = `${analystId}::${marketId}::${direction}::${tradeDate}`
      if (tradeDate < LIVE_API_START && backfillKeys.has(dedupKey)) { skippedBackfill++; continue }

      // Skip trades protected by a resolved dispute correction -- the upsert below
      // matches existing rows via (source_system, source_record_id), so that's the key
      // checked here rather than trade_id (see protectedSourceRecordIds above).
      if (protectedSourceRecordIds.has(t.ReportId)) {
        console.log(`  Skipping ${normSymbol} — protected by resolved dispute`)
        skippedProtected++
        continue
      }

      // 'LIVE_COMPUTED' matches migration 028's documented provenance for zone
      // derived from market_state_daily at import time -- entry_zone_source
      // must stay null whenever entry_zone does (chk_entry_zone_source_requires_zone).
      const entryZone = zoneMap.get(`${marketId}:${tradeDate}`) ?? null

      tradeRows.push({
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
        entry: t.Entry,
        stop: t.StopLoss ?? null,
        target: t.TakeProfit ?? null,
        expiry: t.Expiry ?? null,
        triggered,
        closed_at: t.ExitDate ?? null,
        result_r: resultR,
        entry_zone: entryZone,
        entry_zone_source: entryZone ? 'LIVE_COMPUTED' : null,
        raw_payload: t,
      })

      // Also build publication row -- captures ALL setups including non-triggered
      // Used for accurate trigger rate calculation
      pubRows.push({
        source_system: 'ACUITY_PERFORMANCE_API',
        source_record_id: t.ReportId,
        analyst_id: analystId,
        market_id: marketId,
        published_at: t.PublicationDate,
        direction,
        entry: t.Entry,
        stop: t.StopLoss ?? null,
        target: t.TakeProfit ?? null,
        original_triggered: triggered,
        effective_triggered: triggered,
        reconciliation_status: triggered ? 'WEBHOOK_TRUE' : 'WEBHOOK_FALSE_CONFIRMED',
        import_batch_id: batchId,
        imported_at: new Date().toISOString(),
        raw_payload: t,
      })

      if (isDryRun) successRows++
    }

    if (!isDryRun && tradeRows.length > 0) {
      // Batch upsert actual trades in chunks of 500
      const BATCH_SIZE = 500
      let processed = 0
      for (let i = 0; i < tradeRows.length; i += BATCH_SIZE) {
        const batch = tradeRows.slice(i, i + BATCH_SIZE)
        const { error } = await db
          .from('actual_trades')
          .upsert(batch, { onConflict: 'source_system,source_record_id' })

        if (error) {
          console.error(`  Batch error at ${i}: ${error.message}`)
          errorRows += batch.length
        } else {
          successRows += batch.length
        }
        processed += batch.length
        process.stdout.write(`\r  Upserted ${processed}/${tradeRows.length}`)
      }
      console.log('')

      // Also upsert analyst_publications for trigger rate calculation
      if (pubRows.length > 0) {
        let pubProcessed = 0
        for (let i = 0; i < pubRows.length; i += BATCH_SIZE) {
          const batch = pubRows.slice(i, i + BATCH_SIZE)
          const { error: pubErr } = await db
            .from('analyst_publications')
            .upsert(batch, { onConflict: 'source_system,source_record_id' })
          if (pubErr) console.error(`  analyst_publications upsert error: ${pubErr.message}`)
          pubProcessed += batch.length
          process.stdout.write(`\r  Publications upserted ${pubProcessed}/${pubRows.length}`)
        }
        console.log('')
      }
    } else if (isDryRun) {
      // already counted above
    }

    // ── Re-apply resolved dispute overrides ──────────────────────────────────
    // Belt-and-braces alongside the protectedSourceRecordIds skip above: re-applies
    // every resolved-dispute correction immediately after this run's upsert, in case
    // anything still slipped through. Gated on !isDryRun -- a dry run must not write
    // anything, same as every other mutation in this script.
    if (!isDryRun) {
      let reappliedCount = 0
      for (const dispute of (resolvedDisputes ?? [])) {
        const overrides = dispute.override_values as any
        if (!overrides) continue
        const { error: reapplyError } = await db.from('actual_trades').update({
          ...(overrides.triggered !== undefined ? { triggered: overrides.triggered } : {}),
          ...(overrides.computed_result_r !== undefined ? { result_r: overrides.computed_result_r } : {}),
        }).eq('trade_id', dispute.trade_id)
        if (reapplyError) console.error(`  Failed to re-apply dispute override for trade ${dispute.trade_id}: ${reapplyError.message}`)
        else reappliedCount++
      }
      console.log(`Re-applied ${reappliedCount} dispute overrides`)
    }

    // ── Link to recommendation_versions (post-platform trades) ───────────────
    if (!isDryRun && successRows > 0) {
      console.log('\nLinking new trades to recommendation_versions...')
      let linked = 0

      // All unlinked platform-era trades, not just the ones this batch just inserted --
      // a trade can be inserted by one run and only become linkable on a later run (e.g.
      // its matching coaching_recommendations row lands after this trade did), so scoping
      // to import_batch_id was silently skipping those forever. .limit(500) is a safety
      // cap, not an expected steady-state size -- trades that link successfully leave this
      // set and don't reappear on the next run.
      const { data: newTrades } = await db
        .from('actual_trades')
        .select('trade_id, analyst_id, market_id, direction, published_at')
        .is('opportunity_id', null)
        .is('recommendation_version_id', null)
        .eq('historical_backfill', false)
        .eq('source_system', 'ACUITY_PERFORMANCE_API')
        .gte('published_at', LIVE_API_START) // platform-era trades only -- same floor as the dedup logic above
        .limit(500)

      for (const trade of (newTrades ?? [])) {
        // Find coaching recommendation(s) shown before trade publication. Window widened
        // from 4 to 14 hours to cover APAC (rec ~05:35 UTC, trade published ~15:00-18:00
        // UTC -- a 9-13 hour gap) alongside EUROPEAN (~2-4h) and US (~5-9h).
        const pubTime = new Date(trade.published_at)
        const windowStart = new Date(pubTime.getTime() - 14 * 60 * 60 * 1000).toISOString()

        // Multiple candidates, not just the single most recent one: at a 14-hour window an
        // analyst covering several markets in a session can easily have a MORE recent
        // coaching_recommendations row for a DIFFERENT market than the one just traded --
        // taking only the latest and bailing if its market doesn't match (the old 4-hour-
        // window behaviour) would silently drop a real match sitting earlier in the window.
        // opportunity:opportunity_id embeds market_id directly, so this stays one query
        // instead of a second round-trip per candidate.
        const { data: candidates } = await db
          .from('coaching_recommendations')
          .select('recommendation_id, active_recommendation_version_id, opportunity_id, opportunity:opportunity_id ( market_id )')
          .eq('analyst_id', trade.analyst_id)
          .gte('shown_at', windowStart)
          .lte('shown_at', trade.published_at)
          .order('shown_at', { ascending: false })
          .limit(20)

        // Direction is deliberately not checked -- an analyst trading opposite to the
        // coaching recommendation should still link, not be silently dropped: that
        // divergence is exactly what direction_alignment in generatePostTradeReviews.ts
        // scores afterwards, by comparing this opportunity's direction against the trade's own.
        const coaching = (candidates ?? []).find((c: any) => c.opportunity?.market_id === trade.market_id)

        if (!coaching) continue

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
    console.log(`Out of scope:     ${outOfScopeRows} (equities not in APIP universe)`)
    console.log(`Errors:           ${errorRows}`)
    console.log(`Skipped backfill: ${skippedBackfill} (already exist as MANUAL_BACKFILL)`)
    console.log(`Skipped protected: ${skippedProtected} (protected by resolved dispute)`)

    if (unknownAnalysts.size > 0) {
      console.log(`Unknown analysts: ${[...unknownAnalysts].join(', ')}`)
    }
    if (unknownSymbols.size > 0) {
      const shown = [...unknownSymbols].slice(0, 10)
      console.log(`Out of scope symbols: ${shown.join(', ')}${unknownSymbols.size > 10 ? ` ... +${unknownSymbols.size - 10} more` : ''}`)
    }

    if (isDryRun) console.log('\nDRY RUN -- nothing written.')
  } catch (err) {
    // Catches anything thrown anywhere above -- a query throwing instead of
    // returning { error }, a programming error, etc. Without this, such an
    // error propagated straight to the outer main().catch() below, which logs
    // and exits but never touches import_batches, leaving the row stuck at
    // RUNNING indefinitely (Fix 3's cleanup SQL is the one-time remedy for
    // rows already stuck that way before this fix existed).
    console.error('Unhandled error in import:', (err as Error).message)
    if (batchId && db) {
      await db.from('import_batches').update({
        status: 'FAILED',
        finished_at: new Date().toISOString(),
        checksum_or_summary: `Unhandled error: ${(err as Error).message}`,
      }).eq('import_batch_id', batchId)
    }
    process.exit(1)
  }
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
