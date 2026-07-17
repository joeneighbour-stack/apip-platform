import { getCurrentUser } from '@/lib/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MarketNews } from '@/components/analyst/MarketNews'

function SessionStatus() {
  const now = new Date()
  const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }), 10)
  let label = ''
  let open = false
  if (ukHour >= 5 && ukHour < 12) { label = 'European session open'; open = true }
  else if (ukHour >= 12 && ukHour < 17) { label = 'US session open'; open = true }
  else if (ukHour >= 17 && ukHour < 22) { label = 'APAC session opening soon'; open = false }
  else { label = 'European session opens at 05:00 UK'; open = false }
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${open ? 'bg-green-500' : 'bg-amber-400'}`} />
      <span className="text-xs text-muted-foreground">{label}</span>
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
    .replace('Treat this as a coaching range rather than an instruction; execution judgement remains important.', '')
    .trim()
}

function volatilityLabel(state: string | null): { label: string; color: string } {
  switch (state) {
    case 'LOW_VOL':     return { label: 'Low volatility',     color: 'text-green-700' }
    case 'NORMAL_VOL':  return { label: 'Normal volatility',  color: 'text-muted-foreground' }
    case 'HIGH_VOL':    return { label: 'High volatility',    color: 'text-amber-600' }
    case 'EXTREME_VOL': return { label: 'Extreme volatility', color: 'text-red-600' }
    default:            return { label: '',                   color: 'text-muted-foreground' }
  }
}

function trendLabel(state: string | null): string {
  switch (state) {
    case 'TRENDING_UP':   return 'Trending up'
    case 'TRENDING_DOWN': return 'Trending down'
    case 'RANGING':       return 'Ranging'
    case 'CHOPPY':        return 'Choppy'
    default:              return ''
  }
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

  const { data: allRecs } = await supabase
    .from('coaching_recommendations')
    .select(`
      recommendation_id, entry_range_low, entry_range_high,
      risk_range, target_range, trigger_probability, expected_r,
      coaching_note, shown_at,
      opportunity:opportunity_id (
        analyst_action, direction, current_zone, preferred_entry_zone,
        market:market_id ( symbol, market_id )
      ),
      recommendation_version:active_recommendation_version_id (
        recommendation_validity_status, volatility_warning, requires_refresh
      )
    `)
    .eq('analyst_id', user.analystId)
    .gte('shown_at', today + 'T00:00:00Z')
    .order('shown_at', { ascending: false })

  const seenSymbols = new Set<string>()
  const recommendations = (allRecs ?? []).filter((rec: any) => {
    const symbol = rec.opportunity?.market?.symbol
    if (!symbol || seenSymbols.has(symbol)) return false
    seenSymbols.add(symbol)
    return true
  })

  const marketIds = recommendations.map((r: any) => r.opportunity?.market?.market_id).filter(Boolean)

  const { data: eventRisks } = marketIds.length > 0
    ? await adminDb
        .from('market_event_risk')
        .select(`market_id, event:event_id ( event_name, impact, event_time_uk, currency )`)
        .in('market_id', marketIds)
        .eq('event_risk_status', 'HIGH_RISK')
    : { data: [] }

  const todayEventsByMarket = new Map<string, any[]>()
  for (const er of (eventRisks ?? []) as any[]) {
    const event = er.event
    if (!event || event.event_time_uk?.slice(0, 10) !== today) continue
    if (!todayEventsByMarket.has(er.market_id)) todayEventsByMarket.set(er.market_id, [])
    const existing = todayEventsByMarket.get(er.market_id)!
    if (!existing.find((e: any) => e.event.event_name === event.event_name)) {
      existing.push({ ...er, event })
    }
  }

  const { data: regimeRows } = marketIds.length > 0
    ? await adminDb
        .from('market_regime_state')
        .select('market_id, trend_state, volatility_state, captured_at')
        .in('market_id', marketIds)
        .order('captured_at', { ascending: false })
    : { data: [] }

  const regimeByMarket = new Map<string, any>()
  for (const row of (regimeRows ?? []) as any[]) {
    if (!regimeByMarket.has(row.market_id)) regimeByMarket.set(row.market_id, row)
  }

  const { data: marketHistoryRows } = marketIds.length > 0
    ? await supabase
        .from('actual_trades')
        .select('market_id, result_r, triggered')
        .eq('analyst_id', user.analystId)
        .in('market_id', marketIds)
        .eq('triggered', true)
        .not('result_r', 'is', null)
    : { data: [] }

  const marketHistoryByMarket = new Map<string, { trades: number; wins: number; totalR: number }>()
  for (const t of (marketHistoryRows ?? []) as any[]) {
    const existing = marketHistoryByMarket.get(t.market_id) ?? { trades: 0, wins: 0, totalR: 0 }
    existing.trades++
    if (Number(t.result_r) > 0) existing.wins++
    existing.totalR += Number(t.result_r)
    marketHistoryByMarket.set(t.market_id, existing)
  }

  const { data: yesterdayTrades } = await supabase
    .from('actual_trades')
    .select('result_r, triggered')
    .eq('analyst_id', user.analystId)
    .gte('published_at', yesterday + 'T00:00:00Z')
    .lt('published_at', today + 'T00:00:00Z')

  const closedYesterday = (yesterdayTrades ?? []).filter((t: any) => t.result_r !== null)
  const yesterdayR = closedYesterday.reduce((s: number, t: any) => s + Number(t.result_r), 0)
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
          <div className="mt-1.5"><SessionStatus /></div>
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
          {recommendations.map((rec: any) => {
            const symbol = rec.opportunity?.market?.symbol ?? '—'
            const direction = rec.opportunity?.direction
            const marketId = rec.opportunity?.market?.market_id
            const hasEventRisk = marketId && todayEventsByMarket.has(marketId)
            return (
              <span key={rec.recommendation_id}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${
                  direction === 'BUY' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                {symbol}
                {hasEventRisk && <span className="text-amber-500">&#9888;</span>}
              </span>
            )
          })}
        </div>
      )}

      {/* Recommendation cards */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Today&apos;s Recommendations</h2>
        {recommendations.length === 0 ? (
          <div className="rounded-lg border border-border p-6">
            <p className="text-sm text-muted-foreground">No recommendations for today&apos;s session yet.</p>
          </div>
        ) : (
          recommendations.map((rec: any) => {
            const opp = rec.opportunity
            const rv = rec.recommendation_version
            const symbol = opp?.market?.symbol ?? '—'
            const direction = opp?.direction ?? null
            const action = opp?.analyst_action ?? ''
            const validity = rv?.recommendation_validity_status ?? 'VALID'
            const isDoNotUse = validity === 'DO_NOT_USE_RECALCULATE'
            const isEntryPassed = validity === 'ENTRY_ALREADY_PASSED'
            const isStale = ['STALE_PRICE', 'ZONE_CHANGED', 'CAUTION_VOLATILITY'].includes(validity)
            const marketId = opp?.market?.market_id
            const events = marketId ? (todayEventsByMarket.get(marketId) ?? []) : []
            const regime = marketId ? regimeByMarket.get(marketId) : null
            const hist = marketId ? marketHistoryByMarket.get(marketId) : null
            const vol = volatilityLabel(regime?.volatility_state ?? null)
            const trend = trendLabel(regime?.trend_state ?? null)

            // Group events by time slot
            const eventsByTime = new Map<string, string[]>()
            for (const er of events) {
              const time = new Date(er.event.event_time_uk).toLocaleTimeString('en-GB', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'
              })
              if (!eventsByTime.has(time)) eventsByTime.set(time, [])
              eventsByTime.get(time)!.push(er.event.event_name)
            }

            return (
              <div key={rec.recommendation_id}
                className={`rounded-lg border p-5 ${isDoNotUse ? 'border-red-200 bg-red-50/20 opacity-70' : 'border-border bg-card'}`}>

                {/* 1. RECOMMENDATION */}
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold">{symbol}</span>
                      {direction && (
                        <span className={`text-sm font-bold px-3 py-0.5 rounded-full ${
                          direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {direction}
                        </span>
                      )}
                      {action === 'ENTER_NOW' && !isDoNotUse && (
                        <span className="text-xs font-medium text-green-700">&#9889; Enter Now</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Trigger <span className="font-medium text-foreground">{rec.trigger_probability ? `${Math.round(rec.trigger_probability * 100)}%` : '—'}</span></span>
                      <span>·</span>
                      <span>Expected R <span className={`font-medium ${(rec.expected_r ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>{rec.expected_r != null ? `${Number(rec.expected_r) > 0 ? '+' : ''}${Number(rec.expected_r).toFixed(2)}R` : '—'}</span></span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {isDoNotUse && <span className="text-xs font-medium text-red-700">Levels outdated</span>}
                    {isEntryPassed && <span className="text-xs font-medium text-amber-700">Price beyond entry range</span>}
                    {isStale && <span className="text-xs font-medium text-amber-600">High volatility</span>}
                  </div>
                </div>

                {/* 2. TODAY'S CONTEXT */}
                <div className="mb-4 pb-4 border-b border-border/60 space-y-2">
                  {regime && (vol.label || trend) && (
                    <p className="text-xs text-muted-foreground">
                      {trend && <span className="text-foreground font-medium">{trend}</span>}
                      {trend && vol.label && ' · '}
                      {vol.label && <span className={`font-medium ${vol.color}`}>{vol.label}</span>}
                    </p>
                  )}
                  {eventsByTime.size > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {[...eventsByTime.entries()].map(([time, names], i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800">
                          &#9888; {time} UK &mdash; {names.join(', ')}
                        </span>
                      ))}
                    </div>
                  )}
                  <MarketNews symbols={[symbol]} />
                </div>

                {/* 3. TRADING LEVELS */}
                {!isDoNotUse && (
                  <div className="mb-4 pb-4 border-b border-border/60">
                    {isEntryPassed && (
                      <p className="text-xs text-amber-700 mb-2">Price has moved beyond the entry range. Levels shown for reference — apply judgement before acting.</p>
                    )}
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Entry</p>
                        <p className="text-sm font-medium tabular-nums">
                          {Number(rec.entry_range_low).toFixed(4)} &ndash; {Number(rec.entry_range_high).toFixed(4)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Risk</p>
                        <p className="text-sm font-medium tabular-nums">{rec.risk_range ?? '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Target</p>
                        <p className="text-sm font-medium tabular-nums">{rec.target_range ?? '—'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. WHY THIS ALLOCATION */}
                {rec.coaching_note && !isDoNotUse && (
                  <div className="mb-3 pb-3 border-b border-border/60">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Why this allocation?</p>
                    <p className="text-sm text-foreground leading-relaxed">{personaliseNote(rec.coaching_note)}</p>
                  </div>
                )}

                {/* 5. HISTORICAL PERFORMANCE */}
                {hist && hist.trades >= 5 && (
                  <div className="flex items-center gap-5">
                    <p className="text-[10px] text-muted-foreground">Your record</p>
                    <span className="text-xs text-muted-foreground">{hist.trades} trades</span>
                    <span className={`text-xs font-medium ${Math.round(hist.wins / hist.trades * 100) >= 50 ? 'text-green-700' : 'text-muted-foreground'}`}>
                      {Math.round(hist.wins / hist.trades * 100)}% win rate
                    </span>
                    <span className={`text-xs font-medium ${hist.totalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {hist.totalR > 0 ? '+' : ''}{hist.totalR.toFixed(2)}R total
                    </span>
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
