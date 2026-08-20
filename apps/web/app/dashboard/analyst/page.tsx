import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
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

  const { rows, recommendationsReady, opportunitiesCount, marketsWithEventRisk, yesterdayR, closedYesterdayCount, recommendationsGeneratedToday } = await getWorkspaceData(user.analystId)

  // Day-start coverage forecast (preallocateDay.ts, written 04:20 UTC -- before
  // any session's real engine run). Advisory only -- opportunities.assigned_analyst_id
  // (opportunitiesCount, from getWorkspaceData()) is the authoritative real engine
  // allocation once at least one session has run today; this query's row list still
  // drives the grouped-by-session display below regardless, since that's useful for
  // seeing APAC/US markets before their engine runs even when EUROPEAN's real
  // allocation already exists -- see migrations/049_daily_coverage_plan.sql's comment.
  const supabase = await createClient()
  const today = new Date().toISOString().slice(0, 10)
  const { data: coveragePlan } = await supabase
    .from('daily_coverage_plan')
    .select('market:market_id ( symbol, asset_class ), session')
    .eq('date', today)
    .eq('analyst_id', user.analystId)
    .order('session')

  // Use actual engine allocation when available, fall back to the advisory plan
  // (and, failing that, to however many recommendations have generated so far).
  const marketsToday = (opportunitiesCount ?? 0) > 0
    ? opportunitiesCount!
    : coveragePlan?.length ?? recommendationsReady

  const coverageBySession = new Map<string, string[]>()
  for (const row of (coveragePlan ?? []) as any[]) {
    const symbol = row.market?.symbol
    if (!symbol) continue
    if (!coverageBySession.has(row.session)) coverageBySession.set(row.session, [])
    coverageBySession.get(row.session)!.push(symbol)
  }

  // Other analysts out today, so this analyst knows why their own coverage might be
  // wider than usual (unfilled markets get redistributed by the analyst-first scoring
  // in runEngineSession.ts / the workload-balanced fallback allocation). adminDb
  // required: migrations/058_analyst_availability_rls.sql scopes ANALYST to
  // analyst_id = current_analyst_id() only, which the .neq() below would otherwise
  // filter down to nothing -- there's no "team sees names only" RLS tier, so this
  // deliberately bypasses RLS the same way coaching_recommendations does elsewhere in
  // this workspace (see workspaceData.ts's file header comment) rather than exposing
  // team-wide availability rows to the ANALYST role at the database layer.
  const adminDb = createAdminClient()
  const { data: todayAbsences } = await adminDb
    .from('analyst_availability')
    .select('analyst:analyst_id(display_name), reason')
    .eq('date', today)
    .eq('available', false)
    .neq('analyst_id', user.analystId)

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

      {/* Team absences today */}
      {todayAbsences && todayAbsences.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">
            Absent today:{' '}
            {(todayAbsences as any[]).map(a => a.analyst?.display_name).filter(Boolean).join(', ')}
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            Markets may be redistributed across the team.
          </p>
        </div>
      )}

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
