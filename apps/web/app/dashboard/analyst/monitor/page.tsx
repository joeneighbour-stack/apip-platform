import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TradeHistoryTable } from '@/components/analyst/TradeHistoryTable'
import { CompliancePanel } from '@/components/analyst/CompliancePanel'

export default async function AnalystMonitorPage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/login')
  if (!user.analystId) redirect('/dashboard/analyst')

  const supabase = await createClient()

  // Yesterday / last working day
  const yesterday = new Date(Date.now() - 86400000)
  if (yesterday.getDay() === 0) yesterday.setDate(yesterday.getDate() - 1)
  if (yesterday.getDay() === 6) yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)

  const { data: yesterdayTrades } = await supabase
    .from('actual_trades')
    .select('trade_id, result_r, triggered, direction, market:market_id ( symbol )')
    .eq('analyst_id', user.analystId)
    .gte('published_at', yesterdayStr + 'T00:00:00Z')
    .lt('published_at', yesterdayStr + 'T23:59:59Z')

  const ytrades = (yesterdayTrades ?? []) as any[]
  const yTriggered = ytrades.filter(t => t.triggered)
  const yClosed = ytrades.filter(t => t.result_r !== null)
  const yWins = yClosed.filter(t => Number(t.result_r) > 0)
  const yReturn = yClosed.reduce((s, t) => s + Number(t.result_r), 0)
  const yWinRate = yClosed.length > 0 ? Math.round(yWins.length / yClosed.length * 100) : null
  const yTriggerRate = ytrades.length > 0 ? Math.round(yTriggered.length / ytrades.length * 100) : null

  // Last 30 days trades for trade log
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: recentTrades } = await supabase
    .from('actual_trades')
    .select(`
      trade_id, direction, result_r, triggered,
      published_at, historical_backfill,
      market:market_id ( symbol, asset_class )
    `)
    .eq('analyst_id', user.analystId)
    .gte('published_at', thirtyDaysAgo + 'T00:00:00Z')
    .order('published_at', { ascending: false })

  const tradeIds = (recentTrades ?? []).map((t: any) => t.trade_id)

  const { data: tradeDetails } = tradeIds.length > 0
    ? await supabase
        .from('actual_trades')
        .select('trade_id, entry, stop, target, session')
        .in('trade_id', tradeIds)
    : { data: [] }

  const detailsByTradeId = new Map((tradeDetails ?? []).map((t: any) => [t.trade_id, t]))
  const tradesWithDetails = (recentTrades ?? []).map((t: any) => ({
    ...t,
    ...(detailsByTradeId.get(t.trade_id) ?? {}),
  }))

  // Post-trade reviews
  const { data: reviews } = await supabase
    .from('post_trade_reviews')
    .select('review_id, market, session, direction_alignment, entry_alignment, alignment_score, review_status, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  // Existing disputes
  const { data: disputes } = await supabase
    .from('trade_disputes')
    .select('trade_id, status, dispute_type')
    .eq('raised_by_analyst_id', user.analystId)

  const disputesByTradeId = new Map(
    (disputes ?? []).map((d: any) => [d.trade_id, d])
  )

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">My Monitor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recent activity, coaching compliance, and trade log
          </p>
        </div>
        <a href="/dashboard/analyst"
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
                {yTriggered.length}
                {yTriggerRate !== null && (
                  <span className="text-sm font-normal text-muted-foreground ml-1">{yTriggerRate}%</span>
                )}
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

      {/* Coaching compliance */}
      <CompliancePanel reviews={reviews ?? []} />

      {/* 30-day trade log */}
      <section className="space-y-3">
        <TradeHistoryTable
          trades={tradesWithDetails}
          analystId={user.analystId!}
          disputesByTradeId={disputesByTradeId}
        />
      </section>
    </div>
  )
}

