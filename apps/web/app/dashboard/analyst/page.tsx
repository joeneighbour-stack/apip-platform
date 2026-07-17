import { getCurrentUser } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RecommendationStats } from '@/components/analyst/RecommendationStats'

function SessionCountdown() {
  const now = new Date()
  const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }), 10)
  let sessionLabel = ''
  let sessionStatus = ''
  if (ukHour >= 5 && ukHour < 12) { sessionLabel = 'European session'; sessionStatus = 'Open' }
  else if (ukHour >= 12 && ukHour < 17) { sessionLabel = 'US session'; sessionStatus = 'Open' }
  else if (ukHour >= 17 && ukHour < 22) { sessionLabel = 'APAC session'; sessionStatus = 'Opening soon' }
  else { sessionLabel = 'European session'; sessionStatus = 'Opens at 05:00 UK' }
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${sessionStatus === 'Open' ? 'bg-green-500' : 'bg-amber-400'}`} />
      <span className="text-xs text-muted-foreground">{sessionLabel} — {sessionStatus}</span>
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getUTCHours() + 1
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function personaliseNote(note: string): string {
  return note
    .replace('The historical profile favours', 'Your historical profile suggests')
    .replace('the historical profile favours', 'your historical profile suggests')
}

export default async function AnalystWorkspacePage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/login')
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
  const adminDb = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  // All of today's coaching recommendations across all sessions
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
        market:market_id ( symbol, market_id )
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

  // Deduplicate by market symbol — keep latest per market
  const seenSymbols = new Set<string>()
  const recommendations = (allRecs ?? []).filter(rec => {
    const symbol = (rec.opportunity as any)?.market?.symbol
    if (!symbol || seenSymbols.has(symbol)) return false
    seenSymbols.add(symbol)
    return true
  })

  // Market IDs for event risk lookup
  const marketIds = recommendations
    .map(r => (r.opportunity as any)?.market?.market_id)
    .filter(Boolean)

  // High-impact event risk — use admin client to bypass RLS
  const { data: eventRisks } = marketIds.length > 0
    ? await adminDb
        .from('market_event_risk')
        .select(`
          market_id,
          analyst_warning,
          risk_score,
          event_risk_status,
          event:event_id (
            event_name,
            impact,
            event_time_uk,
            currency
          )
        `)
        .in('market_id', marketIds)
        .eq('event_risk_status', 'HIGH_RISK')
    : { data: [] }

  // Filter to today's events only
  const todayEventsByMarket = new Map<string, any[]>()
  for (const er of (eventRisks ?? [])) {
    const event = er.event as any
    if (!event) continue
    const eventDate = event.event_time_uk?.slice(0, 10)
    if (eventDate !== today) continue
    if (!todayEventsByMarket.has(er.market_id)) todayEventsByMarket.set(er.market_id, [])
    // Deduplicate events by name
    const existing = todayEventsByMarket.get(er.market_id)!
    if (!existing.find((e: any) => e.event.event_name === event.event_name)) {
      existing.push({ ...er, event })
    }
  }

  // Yesterday's closed P&L
  const { data: yesterdayTrades } = await supabase
    .from('actual_trades')
    .select('result_r, triggered')
    .eq('analyst_id', user.analystId)
    .gte('published_at', yesterday + 'T00:00:00Z')
    .lt('published_at', today + 'T00:00:00Z')

  const closedYesterday = (yesterdayTrades ?? []).filter(t => t.result_r !== null)
  const yesterdayR = closedYesterday.reduce((s, t) => s + Number(t.result_r), 0)
  const marketsWithEventRisk = marketIds.filter(id => todayEventsByMarket.has(id)).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{getGreeting()}, {user.displayName?.split(' ')[0]}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <div className="mt-1.5">
            <SessionCountdown />
          </div>
        </div>
        <div className="flex gap-3 flex-wrap justify-end">
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-center min-w-[80px]">
            <p className="text-2xl font-semibold">{recommendations.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Markets today</p>
          </div>
          {marketsWithEventRisk > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center min-w-[80px]">
              <p className="text-2xl font-semibold text-amber-700">{marketsWithEventRisk}</p>
              <p className="text-xs text-amber-600 mt-0.5">Event risk</p>
            </div>
          )}
          {closedYesterday.length > 0 && (
            <div className={`rounded-lg border px-4 py-3 text-center min-w-[80px] ${yesterdayR >= 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-2xl font-semibold ${yesterdayR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {yesterdayR > 0 ? '+' : ''}{yesterdayR.toFixed(1)}R
              </p>
              <p className={`text-xs mt-0.5 ${yesterdayR >= 0 ? 'text-green-600' : 'text-red-600'}`}>Yesterday</p>
            </div>
          )}
        </div>
      </div>

      {/* Market pill summary */}
      {recommendations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recommendations.map(rec => {
            const opp = rec.opportunity as any
            const symbol = opp?.market?.symbol ?? '—'
            const direction = opp?.direction
            const marketId = opp?.market?.market_id
            const hasEventRisk = marketId && todayEventsByMarket.has(marketId)
            return (
              <span key={rec.recommendation_id}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${
                  direction === 'BUY'
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                {symbol}
                {hasEventRisk && <span className="text-amber-500" title="High-impact event today">⚠</span>}
              </span>
            )
          })}
        </div>
      )}

      {/* Recommendations */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium">Today&apos;s Recommendations</h2>
        {recommendations.length === 0 ? (
          <div className="rounded-lg border border-border p-6">
            <p className="text-sm text-muted-foreground">No recommendations for today&apos;s session yet.</p>
          </div>
        ) : (
          recommendations.map(rec => {
            const opp = rec.opportunity as any
            const rv = rec.recommendation_version as any
            const symbol = opp?.market?.symbol ?? '—'
            const direction = opp?.direction ?? null
            const action = opp?.analyst_action ?? ''
            const validity = rv?.recommendation_validity_status ?? 'VALID'
            const isDoNotUse = validity === 'DO_NOT_USE_RECALCULATE'
            const isStale = validity !== 'VALID' && !isDoNotUse
            const marketId = opp?.market?.market_id
            const events = marketId ? (todayEventsByMarket.get(marketId) ?? []) : []

            return (
              <div key={rec.recommendation_id}
                className={`rounded-lg border p-5 space-y-4 ${
                  isDoNotUse ? 'border-red-200 bg-red-50/30 opacity-60' : 'border-border bg-card'
                }`}>

                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-base">{symbol}</span>
                    {direction && (
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        Suggested: {direction}
                      </span>
                    )}
                    {!isDoNotUse && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        action === 'ENTER_NOW' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {action === 'ENTER_NOW' ? '⚡ Enter Now' : 'Wait for Zone'}
                      </span>
                    )}
                    {isDoNotUse && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                        ⚠ Levels outdated
                      </span>
                    )}
                    {isStale && !isDoNotUse && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                        ⚠ Caution — high volatility detected
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

                {/* Event risk tags */}
                {events.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">High-impact events today</p>
                    <div className="flex flex-wrap gap-2">
                      {events.map((er: any, i: number) => {
                        const time = new Date(er.event.event_time_uk).toLocaleTimeString('en-GB', {
                          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'
                        })
                        return (
                          <span key={i} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 font-medium">
                            ⚠ {er.event.event_name} — {time} UK ({er.event.currency})
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Levels */}
                {!isDoNotUse && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground mb-1">Entry range</p>
                      <p className="text-sm font-medium tabular-nums">
                        {Number(rec.entry_range_low).toFixed(4)} – {Number(rec.entry_range_high).toFixed(4)}
                      </p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground mb-1">Risk area</p>
                      <p className="text-sm font-medium tabular-nums">{rec.risk_range ?? '—'}</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground mb-1">Target area</p>
                      <p className="text-sm font-medium tabular-nums">{rec.target_range ?? '—'}</p>
                    </div>
                  </div>
                )}

                {/* Coaching note — personalised */}
                {rec.coaching_note && !isDoNotUse && (
                  <div className="rounded-md bg-muted/30 border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground mb-1 font-medium">Your profile insight</p>
                    <p className="text-sm text-foreground leading-relaxed">{personaliseNote(rec.coaching_note)}</p>
                  </div>
                )}
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}
