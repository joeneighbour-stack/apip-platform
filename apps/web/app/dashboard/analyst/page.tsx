import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { CoverageStrip } from '@/components/analyst/workspace/CoverageStrip'
import { getWorkspaceData } from '@/lib/workspaceData'

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

  const { rows, marketsToday, marketsWithEventRisk, yesterdayR, closedYesterdayCount } = await getWorkspaceData(user.analystId)

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
            <p className="text-xs text-muted-foreground mt-0.5">Markets today</p>
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

      {/* Coverage strip */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Today&apos;s Recommendations</h2>
        <CoverageStrip rows={rows} />
      </section>
    </div>
  )
}
