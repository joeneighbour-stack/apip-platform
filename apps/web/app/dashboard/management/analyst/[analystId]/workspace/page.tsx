import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { CoverageStrip } from '@/components/analyst/workspace/CoverageStrip'
import { getWorkspaceData } from '@/lib/workspaceData'

interface PageProps {
  params: Promise<{ analystId: string }>
}

// Read-only mirror of the analyst's own /dashboard/analyst workspace, scoped to an
// arbitrary analyst_id via getWorkspaceData() rather than the session user's own id.
// The workspace has no mutating actions to begin with (no trade entry, no dispute
// flows -- expand/collapse is the only interaction, and that's just local UI state), so
// reusing CoverageStrip/MarketDetailCard as-is already satisfies "read-only"; nothing
// needed to be stripped out of them for this view.
export default async function ManagementAnalystWorkspacePage({ params }: PageProps) {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const { analystId } = await params
  const supabase = await createClient()

  const { data: analystRaw, error: analystRawError } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active')
    .eq('analyst_id', analystId)
    .single()
  // PGRST116 ("no rows returned") just means analystId doesn't match any analyst -- the
  // normal path into notFound() below, not a failure worth logging.
  if (analystRawError && analystRawError.code !== 'PGRST116') {
    console.error('[ManagementAnalystWorkspacePage] Failed to fetch analyst:', analystRawError.message)
  }
  const analyst = analystRaw as { analyst_id: string; display_name: string; active: boolean } | null

  if (!analyst) notFound()

  const { rows, recommendationsReady, opportunitiesCount, marketsWithEventRisk, yesterdayR, closedYesterdayCount, recommendationsGeneratedToday } = await getWorkspaceData(analystId)

  // Total markets allocated today, mirroring the analyst's own /dashboard/analyst page
  // -- see that page's comment for the full reasoning. opportunitiesCount (from
  // getWorkspaceData()) is the real engine allocation and takes priority once at least
  // one session has run today; daily_coverage_plan (preallocateDay.ts's 04:20 UTC
  // day-start forecast) is advisory and only used as a fallback before that, or as a
  // last resort however many recommendations have generated so far.
  const today = new Date().toISOString().slice(0, 10)
  const { data: coveragePlan, error: coveragePlanError } = await supabase
    .from('daily_coverage_plan')
    .select('market_id')
    .eq('date', today)
    .eq('analyst_id', analystId)
  if (coveragePlanError) console.error('[ManagementAnalystWorkspacePage] Failed to fetch daily_coverage_plan:', coveragePlanError.message)
  const marketsToday = (opportunitiesCount ?? 0) > 0
    ? opportunitiesCount!
    : coveragePlan?.length ?? recommendationsReady

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{analyst.display_name} &mdash; Workspace</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}Read-only management view
          </p>
        </div>
        <a href="/dashboard/management"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0">
          &larr; Back to Management
        </a>
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

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Today&apos;s Recommendations</h2>
        <CoverageStrip rows={rows} recommendationsGeneratedToday={recommendationsGeneratedToday} />
      </section>
    </div>
  )
}
