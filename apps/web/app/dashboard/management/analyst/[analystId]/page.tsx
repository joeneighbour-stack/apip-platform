import { getCurrentUser } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { KpiSummary } from '@/components/analyst/KpiSummary'
import { PerformanceBreakdown } from '@/components/analyst/PerformanceBreakdown'
import { CompliancePanel } from '@/components/analyst/CompliancePanel'
import { TradeHistoryTable } from '@/components/analyst/TradeHistoryTable'
import { MarketNews } from '@/components/analyst/MarketNews'

interface PageProps {
  params: Promise<{ analystId: string }>
}

function validityLabel(status: string | null): { label: string; color: string } | null {
  switch (status) {
    case 'DO_NOT_USE_RECALCULATE': return { label: 'Levels outdated', color: 'text-red-700' }
    case 'ENTRY_ALREADY_PASSED':   return { label: 'Entry passed', color: 'text-amber-600' }
    case 'STALE_PRICE':
    case 'CAUTION_VOLATILITY':
    case 'ZONE_CHANGED':           return { label: 'High volatility', color: 'text-amber-600' }
    default: return null
  }
}

function stripBoilerplate(note: string | null): string {
  if (!note) return ''
  return note
    .replace('Treat this as a coaching range rather than an instruction; execution judgement remains important.', '')
    .replace('The historical profile favours', 'Historical profile favours')
    .trim()
}

export default async function AnalystProfilePage({ params }: PageProps) {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const supabase = await createClient()
  const adminDb = createAdminClient()
  const { analystId } = await params

  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString().split('T')[0]
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Fetch analyst details
  const { data: analyst } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active')
    .eq('analyst_id', analystId)
    .single()

  if (!analyst) notFound()

  // Today's recommendations via adminDb (bypass RLS)
  const { data: allRecs } = await adminDb
    .from('coaching_recommendations')
    .select(`
      recommendation_id, entry_range_low, entry_range_high,
      risk_range, target_range, trigger_probability, expected_r,
      coaching_note, shown_at,
      opportunity:opportunity_id (
        analyst_action, direction, current_zone,
        market:market_id ( symbol, asset_class, market_id )
      ),
      recommendation_version:active_recommendation_version_id (
        recommendation_validity_status
      )
    `)
    .eq('analyst_id', analystId)
    .gte('shown_at', today + 'T00:00:00Z')
    .order('shown_at', { ascending: false })

  // Deduplicate by symbol
  const seenSymbols = new Set<string>()
  const recommendations = (allRecs ?? []).filter((rec: any) => {
    const symbol = rec.opportunity?.market?.symbol
    if (!symbol || seenSymbols.has(symbol)) return false
    seenSymbols.add(symbol)
    return true
  })

  // Event risk for today's markets
  const marketIds = recommendations.map((r: any) => r.opportunity?.market?.market_id).filter(Boolean)
  const { data: eventRisks } = marketIds.length > 0
    ? await adminDb
        .from('market_event_risk')
        .select('market_id, event:event_id ( event_name, event_time_uk )')
        .in('market_id', marketIds)
        .eq('event_risk_status', 'HIGH_RISK')
    : { data: [] }

  const eventsByMarket = new Map<string, string[]>()
  for (const er of (eventRisks ?? []) as any[]) {
    const event = er.event
    if (!event || event.event_time_uk?.slice(0, 10) !== today) continue
    if (!eventsByMarket.has(er.market_id)) eventsByMarket.set(er.market_id, [])
    eventsByMarket.get(er.market_id)!.push(event.event_name)
  }

  // KPI trend
  const { data: kpiTrend } = await supabase
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start, period_end')
    .eq('analyst_id', analystId)
    .gte('period_start', twoYearsAgo)
    .order('period_start', { ascending: true })

  const kpis = (kpiTrend ?? []).filter((k: any) => k.period_start === monthStart)

  // Current month stats from KPIs
  const currentMonthKpi = kpis.find((k: any) => k.kpi_name === 'total_return_r')
  const monthR = currentMonthKpi ? Number(currentMonthKpi.kpi_value?.value ?? 0) : 0
  const monthTradeCount = currentMonthKpi ? Number(currentMonthKpi.kpi_value?.trade_count ?? 0) : 0
  const winRateKpi = kpis.find((k: any) => k.kpi_name === 'win_rate')
  const winRate = winRateKpi ? Math.round(Number(winRateKpi.kpi_value?.value ?? 0) * 100) : null

  // All trades for breakdown
  const allTrades: any[] = []
  const PAGE_SIZE = 1000
  let page = 0
  let hasMore = true
  while (hasMore) {
    const { data: batch } = await supabase
      .from('actual_trades')
      .select(`
        trade_id, direction, result_r, triggered,
        published_at, historical_backfill,
        market:market_id ( symbol, asset_class )
      `)
      .eq('analyst_id', analystId)
      .gte('published_at', twoYearsAgo)
      .order('published_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (!batch?.length) { hasMore = false } else {
      allTrades.push(...batch)
      hasMore = batch.length === PAGE_SIZE
      page++
    }
  }

  // Last 30 days trades for trade log
  const recentTrades = allTrades.filter((t: any) => t.published_at >= thirtyDaysAgo + 'T00:00:00Z')
  const tradeIds = recentTrades.map((t: any) => t.trade_id)

  const { data: tradeDetails } = tradeIds.length > 0
    ? await supabase
        .from('actual_trades')
        .select('trade_id, entry, stop, target, session')
        .in('trade_id', tradeIds)
    : { data: [] }

  const detailsByTradeId = new Map((tradeDetails ?? []).map((t: any) => [t.trade_id, t]))
  const recentTradesWithDetails = recentTrades.map((t: any) => ({
    ...t,
    ...(detailsByTradeId.get(t.trade_id) ?? {}),
  }))

  // Post-trade reviews
  const { data: reviews } = await supabase
    .from('post_trade_reviews')
    .select('review_id, market, session, direction_alignment, entry_alignment, alignment_score, review_status, created_at')
    .eq('analyst_id', analystId)
    .order('created_at', { ascending: false })
    .limit(50)

  // Disputes
  const { data: disputes } = await supabase
    .from('trade_disputes')
    .select('trade_id, status, dispute_type')
    .eq('raised_by_analyst_id', analystId)

  const disputesByTradeId = new Map(
    (disputes ?? []).map((d: any) => [d.trade_id, d])
  )

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{analyst.display_name}</h1>
            {!analyst.active && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Inactive</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">Analyst profile &mdash; management view</p>
        </div>
        <a href="/dashboard/management" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Management
        </a>
      </div>

      {/* This month quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">This Month Return</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${monthR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {monthR > 0 ? '+' : ''}{monthR.toFixed(2)}R
          </p>
          <p className="text-xs text-muted-foreground mt-1">{monthTradeCount} closed trades</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Win Rate</p>
          <p className={`text-2xl font-semibold mt-1 ${winRate !== null && winRate >= 50 ? 'text-green-700' : 'text-muted-foreground'}`}>
            {winRate !== null ? `${winRate}%` : '\u2014'}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">All Time Trades</p>
          <p className="text-2xl font-semibold mt-1">{allTrades.length.toLocaleString()}</p>
        </div>
      </div>

      {/* Today's Recommendations */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          Today&apos;s Recommendations
          <span className="ml-2 text-xs font-normal text-muted-foreground">({recommendations.length} markets)</span>
        </h2>
        {recommendations.length === 0 ? (
          <div className="rounded-lg border border-border p-6">
            <p className="text-sm text-muted-foreground">No recommendations generated yet for today.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recommendations.map((rec: any) => {
              const opp = rec.opportunity
              const symbol = opp?.market?.symbol ?? '\u2014'
              const direction = opp?.direction ?? null
              const action = opp?.analyst_action ?? ''
              const validity = rec.recommendation_version?.recommendation_validity_status ?? 'VALID'
              const vLabel = validityLabel(validity)
              const marketId = opp?.market?.market_id
              const events = marketId ? (eventsByMarket.get(marketId) ?? []) : []
              const isDoNotUse = validity === 'DO_NOT_USE_RECALCULATE'
              const note = stripBoilerplate(rec.coaching_note)

              return (
                <div key={rec.recommendation_id}
                  className={`rounded-lg border p-4 space-y-3 ${isDoNotUse ? 'border-red-200 bg-red-50/20 opacity-60' : 'border-border bg-card'}`}>

                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{symbol}</span>
                      {direction && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>{direction}</span>
                      )}
                      {action === 'ENTER_NOW' && !isDoNotUse && (
                        <span className="text-xs font-medium text-green-700">&#9889;</span>
                      )}
                    </div>
                    {vLabel && <span className={`text-xs font-medium ${vLabel.color}`}>{vLabel.label}</span>}
                  </div>

                  {/* Trigger / Expected R */}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Trigger <span className="font-medium text-foreground">
                      {rec.trigger_probability ? `${Math.round(rec.trigger_probability * 100)}%` : '\u2014'}
                    </span></span>
                    <span>Expected R <span className={`font-medium ${(rec.expected_r ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {rec.expected_r != null ? `${Number(rec.expected_r) > 0 ? '+' : ''}${Number(rec.expected_r).toFixed(2)}R` : '\u2014'}
                    </span></span>
                  </div>

                  {/* Event risk */}
                  {events.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {events.map((e, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">
                          &#9888; {e}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* News */}
                  <MarketNews symbols={[symbol]} />

                  {/* Levels */}
                  {!isDoNotUse && (
                    <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/60">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Entry</p>
                        <p className="text-xs font-medium tabular-nums">
                          {Number(rec.entry_range_low).toFixed(4)}&ndash;{Number(rec.entry_range_high).toFixed(4)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Risk</p>
                        <p className="text-xs font-medium tabular-nums">{rec.risk_range ?? '\u2014'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Target</p>
                        <p className="text-xs font-medium tabular-nums">{rec.target_range ?? '\u2014'}</p>
                      </div>
                    </div>
                  )}

                  {/* Coaching note */}
                  {note && !isDoNotUse && (
                    <p className="text-xs text-muted-foreground leading-relaxed pt-1 border-t border-border/60">
                      {note}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* KPI Summary */}
      <KpiSummary kpis={kpis} kpiTrend={kpiTrend ?? []} />

      {/* Performance Breakdown */}
      <PerformanceBreakdown trades={allTrades} />

      {/* Coaching Compliance */}
      <CompliancePanel reviews={reviews ?? []} />

      {/* 30-day Trade Log */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Trade Log &mdash; Last 30 Days</h2>
        <TradeHistoryTable
          trades={recentTradesWithDetails}
          analystId={analystId}
          disputesByTradeId={disputesByTradeId}
        />
      </section>
    </div>
  )
}

