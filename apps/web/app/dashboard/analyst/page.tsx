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
  const today = new Date().toISOString().slice(0, 10)

  const { data: allRecs } = await supabase
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
    .gte('shown_at', today + 'T00:00:00Z')
    .order('shown_at', { ascending: false })

  // Deduplicate: keep only the most recent recommendation per market symbol
  const seenSymbols = new Set<string>()
  const recommendations = (allRecs ?? []).filter(rec => {
    const symbol = (rec.opportunity as any)?.market?.symbol
    if (!symbol || seenSymbols.has(symbol)) return false
    seenSymbols.add(symbol)
    return true
  })

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
        {recommendations.length === 0 ? (
          <div className="rounded-lg border border-border p-6">
            <p className="text-sm text-muted-foreground">
              No coaching recommendations for today's session yet.
            </p>
          </div>
        ) : (
          recommendations.map((rec) => {
            const opp = rec.opportunity as any
            const rv = rec.recommendation_version as any
            const symbol = opp?.market?.symbol ?? '—'
            const direction = opp?.direction ?? null
            const action = opp?.analyst_action ?? ''
            const validity = rv?.recommendation_validity_status ?? 'VALID'
            const isDoNotUse = validity === 'DO_NOT_USE_RECALCULATE'
            const isStale = validity !== 'VALID' && !isDoNotUse

            return (
              <div key={rec.recommendation_id}
                className={`rounded-lg border p-5 space-y-4 ${
                  isDoNotUse
                    ? 'border-red-200 bg-red-50/30 opacity-60'
                    : 'border-border bg-card'
                }`}>

                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-base">{symbol}</span>
                    {direction && (
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        direction === 'BUY'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {direction}
                      </span>
                    )}
                    {!isDoNotUse && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        action === 'ENTER_NOW'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}>
                        {action === 'ENTER_NOW' ? 'Enter Now' : 'Wait for Preferred Zone'}
                      </span>
                    )}
                    {isDoNotUse && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                        Levels outdated
                      </span>
                    )}
                    {validity === 'ENTRY_ALREADY_PASSED' && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700">
                        Entry Out of Range
                      </span>
                    )}
                    {validity === 'STALE_PRICE' && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                        Levels may be stale
                      </span>
                    )}
                    {validity === 'ZONE_CHANGED' && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">
                        Zone changed
                      </span>
                    )}
                    {validity === 'CAUTION_VOLATILITY' && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700">
                        Elevated volatility
                      </span>
                    )}
                  </div>
                  <RecommendationStats
                    triggerProbability={rec.trigger_probability ?? 0}
                    expectedR={rec.expected_r ?? 0}
                  />
                </div>

                {/* DO_NOT_USE banner */}
                {isDoNotUse && (
                  <div className="rounded-md bg-red-100 border border-red-200 px-3 py-2">
                    <p className="text-xs text-red-800 font-medium">
                      Market has moved significantly since these levels were generated. Do not act on these levels — updated levels will be available at the next session.
                    </p>
                  </div>
                )}

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

                {/* Stale warning */}
                {isStale && rv?.volatility_warning && (
                  <div className="rounded-md bg-amber-50 border border-amber-100 px-3 py-2">
                    <p className="text-xs text-amber-800">{rv.volatility_warning}</p>
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
            </div>
          ))
        )}
      </section>
    </div>
  )
}
