// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Shadow System KPI Calculator
// ============================================================================
// Computes the same KPI set as calculateKpis.ts but for shadow trades.
// Stored with kpi_visibility = 'INTERNAL_ONLY' and analyst_id = null.
// Never visible to analysts -- internal comparison only.
//
// KPIs computed:
//   total_return_r     -- sum of result_r on closed shadow trades
//   win_rate           -- wins / closed triggered trades
//   triggered_rate     -- triggered / total shadow trades generated
//   max_drawdown       -- maximum equity drawdown in R
//
// Run:
//   npx tsx src/scripts/calculateShadowKpis.ts --dry-run
//   npx tsx src/scripts/calculateShadowKpis.ts
//   npx tsx src/scripts/calculateShadowKpis.ts --months=36
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// ── Helpers (mirrors calculateKpis.ts exactly) ───────────────────────────────

function maxDrawdown(trades: { result_r: number }[]): { value: number; sequence_length: number } {
  if (trades.length === 0) return { value: 0, sequence_length: 0 }
  let equity = 0, peak = 0, maxDD = 0, maxSeq = 0, currentSeq = 0
  for (const t of trades) {
    equity += t.result_r
    if (equity > peak) {
      peak = equity
      currentSeq = 0
    } else {
      const dd = equity - peak
      if (dd < maxDD) maxDD = dd
      if (t.result_r < 0) {
        currentSeq++
        if (currentSeq > maxSeq) maxSeq = currentSeq
      } else {
        currentSeq = 0
      }
    }
  }
  return { value: maxDD, sequence_length: maxSeq }
}

function generateMonths(n: number): { start: string; end: string }[] {
  const months = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const start = d.toISOString().slice(0, 10)
    const end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
    months.push({ start, end })
  }
  return months
}

// Terminal statuses that have a result
const CLOSED_STATUSES = ['TARGET_HIT', 'STOP_HIT', 'EXPIRY']
const TRIGGERED_STATUSES = ['TRIGGERED', 'TARGET_HIT', 'STOP_HIT', 'EXPIRY', 'AMBIGUOUS']

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const SUPABASE_URL              = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars'); process.exit(1)
  }

  const isDryRun   = process.argv.includes('--dry-run')
  const monthsArg  = process.argv.find(a => a.startsWith('--months='))?.split('=')[1]
  const numMonths  = Number(monthsArg ?? 12)

  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Computing shadow KPIs for last ${numMonths} months\n`)

  const months      = generateMonths(numMonths)
  const generatedAt = new Date().toISOString()
  const windowStart = months[months.length - 1]!.start

  const { data: teamRow } = await db.from('teams').select('team_id').eq('active', true).single()
  const teamId = teamRow?.team_id ?? null

  // Load all shadow trades with outcomes in the window
  const allShadowRows: any[] = []
  let page = 0, hasMore = true
  process.stdout.write('Loading shadow trades')
  while (hasMore) {
    const { data: batch, error } = await db
      .from('shadow_trades')
      .select(`
        shadow_trade_id,
        generated_at,
        direction,
        session,
        entry,
        stop,
        target,
        rr,
        entry_mode,
        shadow_trade_outcomes (
          trade_outcome_status,
          result_r,
          triggered_at,
          triggered_price,
          closed_at,
          exit_price,
          exit_reason
        )
      `)
      .gte('generated_at', `${windowStart}T00:00:00Z`)
      .range(page * 1000, page * 1000 + 999)

    if (error) { console.error(`\nError: ${error.message}`); break }
    if (!batch?.length) { hasMore = false } else {
      allShadowRows.push(...batch)
      hasMore = batch.length === 1000
      page++
      process.stdout.write('.')
    }
  }
  console.log(`\nLoaded ${allShadowRows.length} shadow trades\n`)

  if (allShadowRows.length === 0) {
    console.log('No shadow trades found in window.')
    return
  }

  // Flatten: one row per shadow trade with its outcome
  const flatTrades = allShadowRows.map(st => {
    const outcome = (st.shadow_trade_outcomes as any[])?.[0]
    return {
      generated_at:     st.generated_at as string,
      direction:        st.direction as string,
      session:          st.session as string,
      entry_mode:       st.entry_mode as string,
      status:           outcome?.trade_outcome_status ?? 'NOT_TRIGGERED',
      result_r:         outcome?.result_r != null ? Number(outcome.result_r) : null,
      triggered_at:     outcome?.triggered_at ?? null,
    }
  })

  const kpiRows: any[] = []

  for (const { start, end } of months) {
    const monthTrades = flatTrades.filter(t => {
      const d = t.generated_at.slice(0, 10)
      return d >= start && d <= end
    })
    if (monthTrades.length === 0) continue

    const total       = monthTrades.length
    const triggered   = monthTrades.filter(t => TRIGGERED_STATUSES.includes(t.status))
    const closed      = monthTrades.filter(t => CLOSED_STATUSES.includes(t.status) && t.result_r !== null)

    const returnR     = closed.reduce((s, t) => s + t.result_r!, 0)
    const wins        = closed.filter(t => t.result_r! > 0)
    const winRate     = closed.length > 0 ? wins.length / closed.length : null
    const triggerRate = total > 0 ? triggered.length / total : null

    const sortedClosed = [...closed].sort((a, b) => a.generated_at.localeCompare(b.generated_at))
    const dd = maxDrawdown(sortedClosed.map(t => ({ result_r: t.result_r! })))

    console.log(
      `  ${start.slice(0, 7)}: total=${total}, triggered=${triggered.length}, closed=${closed.length}, ` +
      `R=${returnR.toFixed(2)}, win=${winRate !== null ? (winRate*100).toFixed(0)+'%' : '—'}, ` +
      `trigger=${triggerRate !== null ? (triggerRate*100).toFixed(0)+'%' : '—'}, DD=${dd.value.toFixed(2)}R`
    )

    const baseKpi = {
      period_start:                    start,
      period_end:                      end,
      team_id:                         teamId,
      analyst_id:                      null,         // null = shadow system
      kpi_visibility:                  'INTERNAL_ONLY',
      includes_historical_backfill:    false,
      requires_recommendation_version: false,
      data_freshness:                  'MONTHLY',
      generated_at:                    generatedAt,
    }

    kpiRows.push({
      ...baseKpi,
      kpi_name:  'total_return_r',
      kpi_value: { value: returnR, unit: 'R', trade_count: closed.length },
    })

    kpiRows.push({
      ...baseKpi,
      kpi_name:  'max_drawdown',
      kpi_value: { value: dd.value, unit: 'R', sequence_length: dd.sequence_length },
    })

    if (winRate !== null) {
      kpiRows.push({
        ...baseKpi,
        kpi_name:  'win_rate',
        kpi_value: { value: winRate, unit: 'rate', wins: wins.length, triggered: closed.length },
      })
    }

    if (triggerRate !== null) {
      kpiRows.push({
        ...baseKpi,
        kpi_name:  'triggered_rate',
        kpi_value: { value: triggerRate, unit: 'rate', triggered: triggered.length, total_setups: total },
      })
    }
  }

  console.log(`\nTotal KPI rows: ${kpiRows.length}`)

  if (isDryRun) {
    console.log('\nDRY RUN -- nothing written.')
    return
  }

  // Delete existing shadow KPIs (analyst_id IS NULL + INTERNAL_ONLY)
  const { error: delError } = await db
    .from('executive_kpis')
    .delete()
    .is('analyst_id', null)
    .eq('kpi_visibility', 'INTERNAL_ONLY')
    .in('kpi_name', ['total_return_r', 'win_rate', 'triggered_rate', 'max_drawdown'])

  if (delError) { console.error('Delete error:', delError.message); process.exit(1) }

  // Insert in batches of 100
  const BATCH = 100
  let inserted = 0
  for (let i = 0; i < kpiRows.length; i += BATCH) {
    const { error } = await db.from('executive_kpis').insert(kpiRows.slice(i, i + BATCH))
    if (error) { console.error(`Insert error at ${i}: ${error.message}`); process.exit(1) }
    inserted += Math.min(BATCH, kpiRows.length - i)
  }

  console.log(`Inserted ${inserted} shadow KPI rows.`)
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
