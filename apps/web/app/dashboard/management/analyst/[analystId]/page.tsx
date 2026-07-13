import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { KpiSummary } from '@/components/analyst/KpiSummary'
import { PerformanceBreakdown } from '@/components/analyst/PerformanceBreakdown'

export default async function AnalystDrillDownPage({
  params
}: {
  params: { analystId: string }
}) {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const supabase = await createClient()
  const { analystId } = params

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const thirtySixMonthsAgo = new Date(now.getFullYear() - 3, now.getMonth(), 1).toISOString().split('T')[0]
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString().split('T')[0]

  // Analyst info
  const { data: analyst } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active, sessions')
    .eq('analyst_id', analystId)
    .single()

  // KPIs -- 36 months
  const { data: kpiTrend } = await supabase
    .from('executive_kpis')
    .select('kpi_name, kpi_value, period_start, period_end')
    .eq('analyst_id', analystId)
    .gte('period_start', thirtySixMonthsAgo)
    .order('period_start', { ascending: true })

  const kpis = (kpiTrend ?? []).filter(k => k.period_start === monthStart)

  // Trades for breakdown -- paginated
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

    if (!batch?.length) {
      hasMore = false
    } else {
      allTrades.push(...batch)
      hasMore = batch.length === PAGE_SIZE
      page++
    }
  }

  // Post-trade reviews for this analyst
  const { data: reviews } = await supabase
    .from('post_trade_reviews')
    .select(`
      review_id, direction_alignment, entry_alignment,
      alignment_score, analyst_facing_review, created_at, market, session
    `)
    .in('trade_id', allTrades.map(t => t.trade_id).slice(0, 500))
    .order('created_at', { ascending: false })
    .limit(20)

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{analyst?.display_name ?? 'Analyst'}</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-muted-foreground">Performance detail — last 36 months</p>
            {(analyst?.sessions ?? []).map((s: string) => (
              <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{s}</span>
            ))}
          </div>
        </div>
        <a href="/dashboard/management/performance"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Team Performance
        </a>
      </div>

      <KpiSummary kpis={kpis} kpiTrend={kpiTrend ?? []} />
      <PerformanceBreakdown trades={allTrades} />

      {(reviews?.length ?? 0) > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Post-Trade Reviews</h2>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Market</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Session</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Direction</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Entry</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Score</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(reviews ?? []).map(review => (
                  <tr key={review.review_id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(review.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-xs">{review.market ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{review.session ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        review.direction_alignment === 'Aligned'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {review.direction_alignment}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        review.entry_alignment === 'High'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {review.entry_alignment}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-bold ${
                        review.alignment_score === 2 ? 'text-green-700' :
                        review.alignment_score === 1 ? 'text-amber-700' :
                        'text-red-700'
                      }`}>
                        {review.alignment_score}/2
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">
                      {review.analyst_facing_review}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
