import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TradeHistoryTable } from '@/components/analyst/TradeHistoryTable'

interface PageProps {
  // Allows MANAGER/ADMIN to view a specific analyst's monitor via
  // ?analystId=xxx (linked from the management analyst workspace page).
  // ANALYST always sees their own -- the param is ignored for that role.
  searchParams: Promise<{ analystId?: string }>
}

export default async function AnalystMonitorPage({ searchParams }: PageProps) {
  const user = await getCurrentUser()
  if (!['ANALYST', 'MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const { analystId: analystIdParam } = await searchParams
  const isManagerView = ['MANAGER', 'ADMIN'].includes(user.role)
  const viewingAnalystId = isManagerView ? (analystIdParam ?? user.analystId) : user.analystId
  if (!viewingAnalystId) redirect('/dashboard')

  const supabase = await createClient()

  // Header/back-link context for the manager-view case -- reusing "My Monitor" and a
  // back link to /dashboard/analyst (ANALYST-only, redirects everyone else to /login)
  // would be actively broken for a manager viewing someone else's monitor.
  let viewedAnalystName: string | null = null
  if (isManagerView) {
    const { data: viewedAnalyst, error: viewedAnalystError } = await supabase
      .from('analysts')
      .select('display_name')
      .eq('analyst_id', viewingAnalystId)
      .single()
    if (viewedAnalystError && viewedAnalystError.code !== 'PGRST116') {
      console.error('[AnalystMonitorPage] Failed to fetch viewed analyst:', viewedAnalystError.message)
    }
    viewedAnalystName = viewedAnalyst?.display_name ?? null
  }

  // Yesterday / last working day
  const yesterday = new Date(Date.now() - 86400000)
  if (yesterday.getDay() === 0) yesterday.setDate(yesterday.getDate() - 1)
  if (yesterday.getDay() === 6) yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)

  const { data: yesterdayTrades, error: yesterdayTradesError } = await supabase
    .from('actual_trades')
    .select('trade_id, result_r, triggered, direction, market:market_id ( symbol )')
    .eq('analyst_id', viewingAnalystId)
    .gte('published_at', yesterdayStr + 'T00:00:00Z')
    .lt('published_at', yesterdayStr + 'T23:59:59Z')
  if (yesterdayTradesError) console.error('[AnalystMonitorPage] Failed to fetch yesterday actual_trades:', yesterdayTradesError.message)

  const ytrades = (yesterdayTrades ?? []) as any[]
  const yTriggered = ytrades.filter(t => t.triggered === true)
  const yClosed = ytrades.filter(t => t.result_r !== null)
  const yWins = yClosed.filter(t => Number(t.result_r) > 0)
  const yReturn = yClosed.reduce((s, t) => s + Number(t.result_r), 0)
  const yWinRate = yClosed.length > 0 ? Math.round(yWins.length / yClosed.length * 100) : null
  const yTriggerRate = ytrades.length > 0 ? Math.round(yTriggered.length / ytrades.length * 100) : null

  // Last 30 days trades for trade log
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: recentTrades, error: recentTradesError } = await supabase
    .from('actual_trades')
    .select(`
      trade_id, direction, result_r, triggered,
      published_at, historical_backfill, expiry,
      market:market_id ( symbol, asset_class )
    `)
    .eq('analyst_id', viewingAnalystId)
    .gte('published_at', thirtyDaysAgo + 'T00:00:00Z')
    .order('published_at', { ascending: false })
  if (recentTradesError) console.error('[AnalystMonitorPage] Failed to fetch recent actual_trades:', recentTradesError.message)

  const tradeIds = (recentTrades ?? []).map((t: any) => t.trade_id)

  const { data: tradeDetails, error: tradeDetailsError } = tradeIds.length > 0
    ? await supabase
        .from('actual_trades')
        .select('trade_id, entry, stop, target, session')
        .in('trade_id', tradeIds)
    : { data: [], error: null }
  if (tradeDetailsError) console.error('[AnalystMonitorPage] Failed to fetch trade details:', tradeDetailsError.message)

  const detailsByTradeId = new Map((tradeDetails ?? []).map((t: any) => [t.trade_id, t]))
  const tradesWithDetails = (recentTrades ?? []).map((t: any) => ({
    ...t,
    ...(detailsByTradeId.get(t.trade_id) ?? {}),
  }))

  // Post-trade reviews -- post_trade_reviews has no analyst_id column, so scope it to
  // this analyst via a join through actual_trades.trade_id. Previously done as a
  // two-step fetch (list this analyst's trade_ids, then .in('trade_id', list)) --
  // broke silently for any analyst with 1000+ trades, since the trade_id-listing
  // query had no .range()/pagination and Supabase caps unbounded queries at 1000 rows,
  // so reviews linked to trades past the first 1000 were invisible.
  //
  // Filtering directly on the joined table instead avoids ever needing to paginate
  // actual_trades at all -- but the embed MUST use `!inner`, not the default embed.
  // Verified against the live DB before writing this: `.eq('trade.analyst_id', X)`
  // on a plain `trade:trade_id(...)` embed returns EVERY post_trade_reviews row
  // (all analysts), just nulling out `trade` on non-matching rows -- it does not
  // filter the outer query. `trade:trade_id!inner(...)` does filter correctly.
  const { data: reviews, error: reviewsError } = await supabase
    .from('post_trade_reviews')
    .select(`
      review_id, trade_id, market, session,
      direction_alignment, entry_alignment, stop_alignment, target_alignment,
      alignment_score, review_status, analyst_facing_review, created_at,
      trade:trade_id!inner ( result_r, triggered, analyst_id )
    `)
    .eq('trade.analyst_id', viewingAnalystId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (reviewsError) console.error('[AnalystMonitorPage] Failed to fetch post_trade_reviews:', reviewsError.message)

  const reviewList = (reviews ?? []) as any[]
  const reviewsByTradeId = new Map(reviewList.map(r => [r.trade_id, r]))

  // Compact compliance summary, shown above the unified trade log -- the "Recent
  // reviews" table CompliancePanel also renders is dropped here, since each review is
  // now inline in TradeHistoryTable's expandable rows instead of a separate table.
  const totalReviews = reviewList.length
  const directionAligned = reviewList.filter(r => r.direction_alignment === 'Aligned').length
  const entryAligned = reviewList.filter(r => r.entry_alignment === 'High').length
  const fullAlignment = reviewList.filter(r => r.alignment_score === 4).length
  const closedReviews = reviewList.filter(r => r.trade?.result_r != null)
  const alignedReviews = closedReviews.filter(r => r.alignment_score >= 3)
  const notAlignedReviews = closedReviews.filter(r => r.alignment_score <= 2)
  const alignedAvgR = alignedReviews.length > 0
    ? alignedReviews.reduce((s, r) => s + Number(r.trade?.result_r ?? 0), 0) / alignedReviews.length
    : null
  const notAlignedAvgR = notAlignedReviews.length > 0
    ? notAlignedReviews.reduce((s, r) => s + Number(r.trade?.result_r ?? 0), 0) / notAlignedReviews.length
    : null

  // Existing disputes
  const { data: disputes, error: disputesError } = await supabase
    .from('trade_disputes')
    .select('trade_id, status, dispute_type')
    .eq('raised_by_analyst_id', viewingAnalystId)
  if (disputesError) console.error('[AnalystMonitorPage] Failed to fetch trade_disputes:', disputesError.message)

  const disputesByTradeId = new Map(
    (disputes ?? []).map((d: any) => [d.trade_id, d])
  )

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {isManagerView ? `${viewedAnalystName ?? 'Analyst'}'s Monitor` : 'My Monitor'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recent activity, coaching compliance, and trade log
          </p>
        </div>
        <a href={isManagerView ? `/dashboard/management/analyst/${viewingAnalystId}/workspace` : '/dashboard/analyst'}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back
        </a>
      </div>

      {/* Yesterday's snapshot */}
      {ytrades.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">
            {yesterday.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Setups</p>
              <p className="text-2xl font-semibold mt-1">{ytrades.length}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Triggered</p>
              <p className="text-2xl font-semibold mt-1">
                {yTriggerRate !== null ? `${yTriggerRate}%` : '—'}
              </p>
              <p className="text-xs text-muted-foreground">
                {yTriggered.length}/{ytrades.length} triggered
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Win Rate</p>
              <p className={`text-2xl font-semibold mt-1 ${yWinRate !== null && yWinRate >= 50 ? 'text-green-700' : 'text-muted-foreground'}`}>
                {yWinRate !== null ? `${yWinRate}%` : '—'}
              </p>
            </div>
            <div className={`rounded-lg border p-4 ${yReturn >= 0 ? 'border-green-200 bg-green-50/30' : 'border-red-200 bg-red-50/30'}`}>
              <p className="text-xs text-muted-foreground">Return</p>
              <p className={`text-2xl font-semibold mt-1 ${yReturn >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {yReturn > 0 ? '+' : ''}{yReturn.toFixed(2)}R
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Coaching compliance -- compact summary only; individual reviews are inline in
          the trade log below via reviewsByTradeId, not a separate table here. */}
      {totalReviews > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Coaching Compliance</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Direction alignment</p>
                <p className="text-lg font-semibold mt-0.5">
                  {Math.round((directionAligned / totalReviews) * 100)}%
                  <span className="text-xs font-normal text-muted-foreground ml-1.5">{directionAligned}/{totalReviews}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Entry alignment</p>
                <p className="text-lg font-semibold mt-0.5">
                  {Math.round((entryAligned / totalReviews) * 100)}%
                  <span className="text-xs font-normal text-muted-foreground ml-1.5">{entryAligned}/{totalReviews}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Full alignment</p>
                <p className="text-lg font-semibold mt-0.5">
                  {Math.round((fullAlignment / totalReviews) * 100)}%
                  <span className="text-xs font-normal text-muted-foreground ml-1.5">{fullAlignment}/{totalReviews}</span>
                </p>
              </div>
              {closedReviews.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Aligned vs not aligned</p>
                  <p className="text-lg font-semibold mt-0.5 tabular-nums">
                    <span className={alignedAvgR !== null && alignedAvgR >= 0 ? 'text-green-700' : 'text-red-600'}>
                      {alignedAvgR !== null ? `${alignedAvgR >= 0 ? '+' : ''}${alignedAvgR.toFixed(2)}R` : '—'}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground mx-1.5">vs</span>
                    <span className={notAlignedAvgR !== null && notAlignedAvgR >= 0 ? 'text-green-700' : 'text-red-600'}>
                      {notAlignedAvgR !== null ? `${notAlignedAvgR >= 0 ? '+' : ''}${notAlignedAvgR.toFixed(2)}R` : '—'}
                    </span>
                  </p>
                </div>
              )}
            </div>
            {directionAligned === totalReviews && (
              <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1.5 rounded mt-3">
                These reviews only include trades that matched the coaching direction.
                Counter-direction trades will appear as the platform captures more live data.
              </p>
            )}
            {alignedReviews.length >= 5 && notAlignedReviews.length >= 5 && alignedAvgR !== null && notAlignedAvgR !== null && (
              <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                {alignedAvgR > notAlignedAvgR
                  ? `Following coaching adds ${(alignedAvgR - notAlignedAvgR).toFixed(2)}R per trade on average.`
                  : alignedAvgR < notAlignedAvgR
                  ? `Diverging from coaching has added ${(notAlignedAvgR - alignedAvgR).toFixed(2)}R per trade — worth reviewing why.`
                  : 'No meaningful difference between aligned and non-aligned trades yet.'}
              </p>
            )}
          </div>
        </section>
      )}

      {/* 30-day trade log, with post-trade reviews merged in inline */}
      <section className="space-y-3">
        <TradeHistoryTable
          trades={tradesWithDetails}
          analystId={viewingAnalystId}
          disputesByTradeId={disputesByTradeId}
          reviewsByTradeId={reviewsByTradeId}
          currentUserRole={user.role as 'ANALYST' | 'MANAGER' | 'ADMIN'}
          currentUserDisplayName={user.displayName}
        />
      </section>
    </div>
  )
}

