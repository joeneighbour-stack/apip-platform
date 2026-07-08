// ============================================================================
// APIP Trading Intelligence & Performance Platform
// KPI Calculation Script
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

function maxDrawdown(trades: { result_r: number }[]): { value: number; sequence_length: number } {
  if (trades.length === 0) return { value: 0, sequence_length: 0 }

  // Build equity curve
  let equity = 0
  let peak = 0
  let maxDD = 0
  let maxSeq = 0
  let currentSeq = 0
  let inDrawdown = false

  for (const t of trades) {
    equity += t.result_r

    if (equity > peak) {
      peak = equity
      inDrawdown = false
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
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
    months.push({ start, end })
  }
  return months
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars'); process.exit(1)
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

  const { data: analysts } = await db
    .from('analysts').select('analyst_id, display_name').eq('active', true)
  if (!analysts?.length) { console.error('No active analysts'); process.exit(1) }

  const { data: teamRow } = await db.from('teams').select('team_id').eq('active', true).single()
  const teamId = teamRow?.team_id ?? null

  // Load all trades for the window
  const windowStart = months[months.length - 1]!.start

  // Load post-trade reviews for alignment rate
  const { data: reviewRows } = await db
    .from('post_trade_reviews')
    .select(`
      trade_id, alignment_score, direction_alignment, entry_alignment, created_at,
      trade:trade_id ( analyst_id, published_at )
    `)

  // Group reviews by analyst_id
  const reviewsByAnalystId = new Map<string, any[]>()
  for (const r of (reviewRows ?? [])) {
    const analystId = (r.trade as any)?.analyst_id
    if (!analystId) continue
    if (!reviewsByAnalystId.has(analystId)) reviewsByAnalystId.set(analystId, [])
    reviewsByAnalystId.get(analystId)!.push(r)
  }
  console.log(`  Post-trade reviews loaded: ${reviewRows?.length ?? 0}`)
  const PAGE_SIZE = 1000
  const allTrades: any[] = []
  let page = 0, hasMore = true

  process.stdout.write('Loading trades')
  while (hasMore) {
    const { data, error } = await db.from('actual_trades')
      .select('analyst_id, market_id, direction, result_r, triggered, published_at')
      .gte('published_at', windowStart)
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
    const monthlyRows: any[] = []

    for (const { start, end } of months) {
      const monthTrades = analystTrades.filter(t =>
        t.published_at.slice(0, 10) >= start && t.published_at.slice(0, 10) <= end
      )
      if (monthTrades.length === 0) continue

      // Return (R) -- sum of closed triggered trades only (exclude open/pending)
      const allTriggered = monthTrades.filter(t => t.triggered)
      const triggered = allTriggered.filter(t => t.result_r !== null) // closed only
      const returnR = triggered.reduce((s, t) => s + Number(t.result_r), 0)

      // Win rate -- wins / triggered
      const wins = triggered.filter(t => Number(t.result_r) > 0)
      const winRate = triggered.length > 0 ? wins.length / triggered.length : null

      // Trigger rate -- triggered / total published setups
      // This is the real metric: of all setups published, how many triggered?
      const totalSetups = monthTrades.length
      const triggerRate = totalSetups > 0 ? triggered.length / totalSetups : null

      // Max drawdown -- on triggered trades only, sorted by date
      const sortedTriggered = [...triggered].sort((a, b) =>
        a.published_at.localeCompare(b.published_at)
      )
      const dd = maxDrawdown(sortedTriggered.map(t => ({ result_r: Number(t.result_r) })))

      monthlyRows.push({
        start, end, returnR, winRate, triggerRate,
        drawdown: dd.value, tradeCount: monthTrades.length,
        triggeredCount: triggered.length
      })

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
          kpi_value: { value: returnR, unit: 'R', trade_count: triggered.length }
        },
        {
          ...baseKpi,
          kpi_name: 'max_drawdown',
          kpi_value: { value: dd.value, unit: 'R', sequence_length: dd.sequence_length }
        },
      )

      if (winRate !== null) {
        kpiRows.push({
          ...baseKpi,
          kpi_name: 'win_rate',
          kpi_value: { value: winRate, unit: 'rate', wins: wins.length, triggered: triggered.length }
        })
      }

      if (triggerRate !== null) {
        kpiRows.push({
          ...baseKpi,
          kpi_name: 'triggered_rate',
          kpi_value: {
            value: triggerRate,
            unit: 'rate',
            triggered: triggered.length,
            total_setups: totalSetups,
          }
        })
      }

      // Alignment rate -- from post_trade_reviews for this analyst/month
      const analystReviews = reviewsByAnalystId.get(analyst.analyst_id) ?? []
      const monthReviews = analystReviews.filter(r => {
        const pubDate = (r.trade as any)?.published_at?.slice(0, 10)
        return pubDate >= start && pubDate <= end
      })

      if (monthReviews.length > 0) {
        const fullyAligned = monthReviews.filter(r => r.alignment_score === 2).length
        const partiallyAligned = monthReviews.filter(r => r.alignment_score === 1).length
        const notAligned = monthReviews.filter(r => r.alignment_score === 0).length
        // Weighted: full=1.0, partial=0.5, none=0
        const alignmentRate = (fullyAligned + partiallyAligned * 0.5) / monthReviews.length
        kpiRows.push({
          ...baseKpi,
          kpi_name: 'alignment_rate',
          kpi_value: {
            value: alignmentRate,
            unit: 'rate',
            fully_aligned: fullyAligned,
            partially_aligned: partiallyAligned,
            not_aligned: notAligned,
            reviewed: monthReviews.length,
          },
          requires_recommendation_version: true,
        })
      }
    }

    const latestMonth = monthlyRows[0]
    if (latestMonth) {
      console.log(
        `  ${analyst.display_name}: ${monthlyRows.length} months | ` +
        `Latest: R=${latestMonth.returnR.toFixed(2)}, ` +
        `Win=${latestMonth.winRate !== null ? (latestMonth.winRate * 100).toFixed(0) + '%' : '—'}, ` +
        `Trigger=${latestMonth.triggerRate !== null ? (latestMonth.triggerRate * 100).toFixed(0) + '%' : '—'} ` +
        `(${latestMonth.triggeredCount}/${latestMonth.tradeCount}), ` +
        `DD=${latestMonth.drawdown.toFixed(2)}R`
      )
    }
  }

  console.log(`\nTotal KPI rows: ${kpiRows.length}`)

  if (isDryRun) {
    console.log('\nDRY RUN -- nothing written.')
    return
  }

  console.log('\nReplacing existing KPIs...')
  const analystIds = analysts.map(a => a.analyst_id)
  const { error: delError } = await db
    .from('executive_kpis')
    .delete()
    .in('analyst_id', analystIds)
    .in('kpi_name', ['total_return_r', 'return_r', 'win_rate', 'triggered_rate', 'trigger_rate', 'max_drawdown', 'alignment_rate'])

  if (delError) { console.error('Delete error:', delError.message); process.exit(1) }

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
