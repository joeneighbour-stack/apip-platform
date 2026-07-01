import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RecommendationStats } from '@/components/analyst/RecommendationStats'

export default async function AnalystWorkspacePage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/dashboard')
  if (!user.analystId) {
    return (
      <div className="rounded-lg border border-border p-6">
        <p className="text-sm text-muted-foreground">
          Your account is not yet linked to an analyst profile. Contact your administrator.
        </p>
      </div>
    )
  }

  const supabase = await createClient()

  const { data: recommendations } = await supabase
    .from('coaching_recommendations')
    .select(`
      recommendation_id,
      entry_range_low,
      entry_range_high,
      risk_range,
      target_range,
      trigger_probability,
      expected_r,
      coaching_note,
      shown_at,
      opportunity:opportunity_id (
        analyst_action,
        direction,
        current_zone,
        preferred_entry_zone,
        market:market_id ( symbol )
      ),
      recommendation_version:active_recommendation_version_id (
        recommendation_validity_status,
        volatility_warning,
        requires_refresh
      )
    `)
    .eq('analyst_id', user.analystId)
    .order('shown_at', { ascending: false })

  const { data: reviews } = await supabase
    .from('post_trade_reviews')
    .select('review_id, market, session, direction_alignment, entry_alignment, alignment_score, analyst_facing_review, review_status, created_at')
    .in('review_status', ['GENERATED', 'PENDING'])
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">My Workspace</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Today's coaching recommendations and post-trade reviews
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Today's Markets</h2>
        {!recommendations || recommendations.length === 0 ? (
          <div className="rounded-lg border border-border p-6">
            <p className="text-sm text-muted-foreground">
              No coaching recommendations for today's session yet.
            </p>
          </div>
        ) : (
          recommendations.map((rec) => {
            const opp = rec.opportunity as any
            const rv = rec.recommendation_version as any
            const symbol = (opp?.market as any)?.symbol ?? '—'
            const action = opp?.analyst_action ?? ''
            const validity = rv?.recommendation_validity_status ?? 'VALID'
            const isStale = validity !== 'VALID'

            return (
              <div key={rec.recommendation_id}
                className="rounded-lg border border-border bg-card p-5 space-y-4">

                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-base">{symbol}</span>
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                      opp?.direction === 'BUY'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {opp?.direction ?? '—'}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      action === 'ENTER_NOW'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}>
                      {action === 'ENTER_NOW' ? 'Enter Now' : 'Wait for Preferred Zone'}
                    </span>
                    {isStale && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">
                        Condition Update
                      </span>
                    )}
                  </div>
                  <RecommendationStats
                    triggerProbability={rec.trigger_probability ?? 0}
                    expectedR={rec.expected_r ?? 0}
                  />
                </div>

                {/* Levels */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground mb-1">Entry range</p>
                    <p className="text-sm font-medium tabular-nums">
                      {Number(rec.entry_range_low).toFixed(4)} – {Number(rec.entry_range_high).toFixed(4)}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground mb-1">Risk area</p>
                    <p className="text-sm font-medium tabular-nums">{rec.risk_range}</p>
                  </div>
                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground mb-1">Target area</p>
                    <p className="text-sm font-medium tabular-nums">{rec.target_range}</p>
                  </div>
                </div>

                {/* Condition warning */}
                {isStale && rv?.volatility_warning && (
                  <div className="rounded-md bg-orange-50 border border-orange-100 px-3 py-2">
                    <p className="text-xs text-orange-800">{rv.volatility_warning}</p>
                  </div>
                )}

                {/* Coaching note */}
                <div className="rounded-md bg-muted/30 border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground mb-1 font-medium">Coaching note</p>
                  <p className="text-sm text-foreground leading-relaxed">{rec.coaching_note}</p>
                </div>
              </div>
            )
          })
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Pending Reviews</h2>
        {!reviews || reviews.length === 0 ? (
          <div className="rounded-lg border border-border p-6">
            <p className="text-sm text-muted-foreground">
              No post-trade reviews pending acknowledgement.
            </p>
          </div>
        ) : (
          reviews.map((review) => (
            <div key={review.review_id}
              className="rounded-lg border border-border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm">{review.market}</span>
                  <span className="text-xs text-muted-foreground">{review.session}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    review.direction_alignment === 'Aligned'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    Direction: {review.direction_alignment}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    review.entry_alignment === 'High'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    Entry: {review.entry_alignment}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Score: {review.alignment_score}/2
                  </span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{review.analyst_facing_review}</p>
              <button className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground">
                Acknowledge
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
