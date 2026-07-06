// ============================================================================
// APIP Trading Intelligence & Performance Platform
// KPI Calculation Script
// ============================================================================
// Computes monthly KPIs per analyst from actual_trades and writes to
// executive_kpis. Replaces seeded dummy data with real computed values.
//
// Metrics computed (all can use historical backfill per spec sheet 42):
//   - return_r:      sum of result_r for the month
//   - win_rate:      wins / triggered trades (triggered trades only)
//   - trigger_rate:  triggered trades / estimated publication days
//   - max_drawdown:  maximum consecutive losing R in the month
//
// Alignment Rate is EXCLUDED -- requires recommendation_version_id (post-platform only)
//
// Run:
//   npx tsx src/scripts/calculateKpis.ts --dry-run
//   npx tsx src/scripts/calculateKpis.ts
//   npx tsx src/scripts/calculateKpis.ts --months=6   (last N months, default 12)
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// APAC markets excluded on Fridays (no Friday APAC session)
const APAC_MARKETS = new Set([
  'CHINA A50', 'ASX200', 'GBPAUD', 'NZDJPY',
  'NZDUSD', 'HS50', 'NIKKEI', 'EURAUD', 'GBPNZD',
])

function countPublicationDays(first: string, last: string, excludeFridays: boolean): number {
  const start = new Date(first + 'T12:00:00Z')
  const end = new Date(last + 'T12:00:00Z')
  if (start > end) return 0
  let count = 0
  const current = new Date(start)
  while (current <= end) {
    const day = current.getUTCDay()
    if (excludeFridays ? [1,2,3,4].includes(day) : [1,2,3,4,5].includes(day)) count++
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return count
}

function maxDrawdown(trades: { result_r: number }[]): number {
  let maxDD = 0
  let runningDD = 0
  for (const t of trades) {
    if (t.result_r < 0) {
      runningDD += t.result_r
      if (runningDD < maxDD) maxDD = runningDD
    } else {
      runningDD = 0
    }
  }
  return maxDD
}

  // Generate month periods -- period_start = first day, period_end = last day
  function generateMonths(n: number): { start: string; end: string }[] {
    const months = []
    const now = new Date()
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
      const start = d.toISOString().slice(0, 10) // first day of month
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) // last day
      months.push({ start, end })
    }
    return months
  }

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const isDryRun = process.argv.includes('--dry-run')
  const monthsArg = process.argv.find(a => a.startsWith('--months='))?.split('=')[1]
  const numMonths = Number(monthsArg ?? 12)

  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Computing KPIs for last ${numMonths} months\n`)

  const months = generateMonths(numMonths)
  const generatedAt = new Date().toISOString()

  // Load active analysts
  const { data: analysts } = await db
    .from('analysts').select('analyst_id, display_name').eq('active', true)

  if (!analysts?.length) { console.error('No active analysts'); process.exit(1) }

  // Load team
  const { data: teamRow } = await db.from('teams').select('team_id').eq('active', true).single()
  const teamId = teamRow?.team_id ?? null

  // Market symbol lookup
  const { data: markets } = await db.from('markets').select('market_id, symbol')
  const symbolByMarketId = new Map((markets ?? []).map(m => [m.market_id, m.symbol]))

  // Load all trades needed (cover the full period)
  const windowStart = months[months.length - 1]!.start
  const PAGE_SIZE = 1000
  const allTrades: any[] = []
  let page = 0, hasMore = true

  process.stdout.write('Loading trades')
  while (hasMore) {
    const { data, error } = await db.from('actual_trades')
      .select('analyst_id, market_id, direction, result_r, triggered, published_at, historical_backfill')
      .gte('published_at', windowStart)
      .not('result_r', 'is', null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (error) { console.error(`\nPagination error: ${error.message}`); break }
    if (!data?.length) { hasMore = false } else {
      allTrades.push(...data)
      hasMore = data.length === PAGE_SIZE
      page++
      process.stdout.write('.')
    }
  }
  console.log(`\nLoaded ${allTrades.length} trades\n`)

  const kpiRows: any[] = []

  for (const analyst of analysts) {
    const analystTrades = allTrades.filter(t => t.analyst_id === analyst.analyst_id)

    // Compute trigger rate per market (for the full window -- not per month)
    // Used as denominator context for monthly trigger rate
    const marketGroups = new Map<string, any[]>()
    for (const t of analystTrades) {
      if (!marketGroups.has(t.market_id)) marketGroups.set(t.market_id, [])
      marketGroups.get(t.market_id)!.push(t)
    }

    const monthlyRows: any[] = []

    for (const { start, end } of months) {
      const monthTrades = analystTrades.filter(t =>
        t.published_at.slice(0, 10) >= start && t.published_at.slice(0, 10) <= end
      )

      if (monthTrades.length === 0) continue

      // Return (R) -- sum of all result_r
      const returnR = monthTrades.reduce((s, t) => s + Number(t.result_r), 0)

      // Win rate -- triggered trades only
      const triggered = monthTrades.filter(t => t.triggered)
      const wins = triggered.filter(t => Number(t.result_r) > 0)
      const winRate = triggered.length > 0 ? wins.length / triggered.length : null

      // Trigger rate -- trades / publication days for this month
      // Group by market for this month to get per-market days
      const monthMarketGroups = new Map<string, any[]>()
      for (const t of monthTrades) {
        if (!monthMarketGroups.has(t.market_id)) monthMarketGroups.set(t.market_id, [])
        monthMarketGroups.get(t.market_id)!.push(t)
      }

      let totalTrades = 0
      let totalPubDays = 0
      for (const [market_id, mTrades] of monthMarketGroups) {
        const symbol = symbolByMarketId.get(market_id) ?? ''
        const isApac = APAC_MARKETS.has(symbol)
        const pubDays = countPublicationDays(start, end, isApac)
        totalTrades += mTrades.length
        totalPubDays += pubDays
      }
      const triggerRate = totalPubDays > 0 ? Math.min(totalTrades / totalPubDays, 1.0) : null

      // Max drawdown -- consecutive losing R
      const sortedTrades = [...monthTrades].sort((a, b) =>
        a.published_at.localeCompare(b.published_at)
      )
      const dd = maxDrawdown(sortedTrades.map(t => ({ result_r: Number(t.result_r) })))

      monthlyRows.push({ start, end, returnR, winRate, triggerRate, drawdown: dd, tradeCount: monthTrades.length })

      // Build KPI rows for this month
      const baseKpi = {
        period_start: start,
        period_end: end,
        team_id: teamId,
        analyst_id: analyst.analyst_id,
        kpi_visibility: 'ANALYST_OWN',
        includes_historical_backfill: true,
        requires_recommendation_version: false,
        data_freshness: 'MONTHLY',
        generated_at: generatedAt,
      }

      kpiRows.push(
        {
          ...baseKpi,
          kpi_name: 'total_return_r',
          kpi_value: {
            value: returnR,
            unit: 'R',
            trade_count: monthTrades.length,
          }
        },
        {
          ...baseKpi,
          kpi_name: 'max_drawdown',
          kpi_value: {
            value: dd,
            unit: 'R',
            sequence_length: sortedTrades.reduce((maxSeq, t, i, arr) => {
              if (Number(t.result_r) >= 0) return maxSeq
              let seq = 0
              for (let j = i; j < arr.length && Number(arr[j]!.result_r) < 0; j++) seq++
              return Math.max(maxSeq, seq)
            }, 0),
          }
        },
      )
      if (winRate !== null) {
        kpiRows.push({
          ...baseKpi,
          kpi_name: 'win_rate',
          kpi_value: {
            value: winRate,
            unit: 'rate',
            wins: wins.length,
            triggered: triggered.length,
          }
        })
      }
      if (triggerRate !== null) {
        kpiRows.push({
          ...baseKpi,
          kpi_name: 'triggered_rate',
          kpi_value: {
            value: triggerRate,
            unit: 'rate',
            triggered: monthTrades.length,
            total_setups: totalPubDays,
          }
        })
      }
    }

    // Print summary
    const latestMonth = monthlyRows[0]
    if (latestMonth) {
      console.log(
        `  ${analyst.display_name}: ${monthlyRows.length} months | ` +
        `Latest: R=${latestMonth.returnR.toFixed(2)}, ` +
        `Win=${latestMonth.winRate !== null ? (latestMonth.winRate * 100).toFixed(0) + '%' : '—'}, ` +
        `Trigger=${latestMonth.triggerRate !== null ? (latestMonth.triggerRate * 100).toFixed(0) + '%' : '—'}, ` +
        `DD=${latestMonth.drawdown.toFixed(2)}R`
      )
    }
  }

  console.log(`\nTotal KPI rows: ${kpiRows.length}`)

  if (isDryRun) {
    console.log('\nDRY RUN -- nothing written.')
    return
  }

  // Delete existing computed KPIs (keep only non-seeded ones by replacing all)
  console.log('\nReplacing existing KPIs...')
  const analystIds = analysts.map(a => a.analyst_id)
  const { error: delError } = await db
    .from('executive_kpis')
    .delete()
    .in('analyst_id', analystIds)
    .in('kpi_name', ['total_return_r', 'return_r', 'win_rate', 'triggered_rate', 'trigger_rate', 'max_drawdown', 'trade_count'])

  if (delError) { console.error('Delete error:', delError.message); process.exit(1) }

  // Insert in batches
  const BATCH = 500
  let inserted = 0
  for (let i = 0; i < kpiRows.length; i += BATCH) {
    const { error } = await db.from('executive_kpis').insert(kpiRows.slice(i, i + BATCH))
    if (error) { console.error(`Insert error: ${error.message}`); process.exit(1) }
    inserted += Math.min(BATCH, kpiRows.length - i)
    process.stdout.write(`\rInserted ${inserted}/${kpiRows.length}`)
  }

  console.log(`\n\nDone. ${inserted} KPI rows written.`)
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
