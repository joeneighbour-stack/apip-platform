import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CoverageStrip } from '@/components/analyst/workspace/CoverageStrip'
import { getWorkspaceData } from '@/lib/workspaceData'

const SESSION_LABELS: Record<string, string> = { EUROPEAN: 'European', US: 'US', APAC: 'APAC' }
const SESSION_ORDER = ['EUROPEAN', 'US', 'APAC']

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

  const { rows, recommendationsReady, marketsWithEventRisk, yesterdayR, closedYesterdayCount, recommendationsGeneratedToday } = await getWorkspaceData(user.analystId)

  // Day-start coverage forecast (preallocateDay.ts, written 04:20 UTC -- before
  // any session's real engine run). Advisory, not authoritative: today's actual
  // recommendations (rows/CoverageStrip below) come from each session's own live
  // run and can genuinely differ once real intraday data exists -- see
  // migrations/049_daily_coverage_plan.sql's comment for why. Shown whenever
  // available rather than only pre-recommendations, since a market can be in
  // the day's plan for a session that hasn't run yet even after another
  // session's real recommendations already exist.
  //
  // Single query doubles as the source for both the grouped-by-session list
  // below AND the header tile's marketsToday count (total allocated markets,
  // one row per market+session) -- getWorkspaceData() no longer runs its own
  // separate daily_coverage_plan query for the count.
  const supabase = await createClient()
  const today = new Date().toISOString().slice(0, 10)
  const { data: coveragePlan } = await supabase
    .from('daily_coverage_plan')
    .select('market:market_id ( symbol, asset_class ), session')
    .eq('date', today)
    .eq('analyst_id', user.analystId)
    .order('session')

  // Falls back to recommendationsReady when no plan row exists yet (e.g. before
  // 04:20 UTC, or a day preallocateDay.ts didn't run for).
  const marketsToday = coveragePlan?.length ?? recommendationsReady

  const coverageBySession = new Map<string, string[]>()
  for (const row of (coveragePlan ?? []) as any[]) {
    const symbol = row.market?.symbol
    if (!symbol) continue
    if (!coverageBySession.has(row.session)) coverageBySession.set(row.session, [])
    coverageBySession.get(row.session)!.push(symbol)
  }

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
            <p className="text-2xl font-semibold">{marketsToday}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {recommendationsReady} of {marketsToday} ready
            </p>
          </div>
          {marketsWithEventRisk > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center min-w-[80px]">
              <p className="text-2xl font-semibold text-amber-700">{marketsWithEventRisk}</p>
              <p className="text-xs text-amber-600 mt-0.5">Event risk</p>
            </div>
          )}
          {closedYesterdayCount > 0 && (
            <div className={`rounded-lg border px-4 py-3 text-center min-w-[80px] ${yesterdayR >= 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-xs mb-0.5 ${yesterdayR >= 0 ? 'text-green-600' : 'text-red-600'}`}>Yesterday</p>
              <p className={`text-2xl font-semibold tabular-nums ${yesterdayR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {yesterdayR > 0 ? '+' : ''}{yesterdayR.toFixed(1)}R
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Day-start coverage plan -- available from 04:20 UTC, before any session's
          real recommendations exist */}
      {coverageBySession.size > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Today&apos;s Coverage Plan</h2>
          <div className="rounded-lg border border-border bg-card p-4 space-y-1.5">
            {SESSION_ORDER.filter(s => coverageBySession.has(s)).map(session => {
              const hasRecommendations = rows.some(r => r.session === session)
              const sessionTime = session === 'APAC' ? '14:05 UK' : session === 'US' ? '09:49 UK' : null

              return (
                <div key={session} className="space-y-0.5">
                  <p className="text-sm">
                    <span className="font-medium">{SESSION_LABELS[session]}:</span>{' '}
                    <span className="text-muted-foreground">
                      {coverageBySession.get(session)!.join(', ')}
                    </span>
                  </p>
                  {!hasRecommendations && sessionTime && (
                    <p className="text-xs text-muted-foreground/60">
                      Full details available from {sessionTime}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Coverage strip */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Today&apos;s Recommendations</h2>
        <CoverageStrip rows={rows} recommendationsGeneratedToday={recommendationsGeneratedToday} />
      </section>
    </div>
  )
}
