import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AbsenceBooking } from '@/components/analyst/AbsenceBooking'
import { DYNAMIC_ALLOCATION_START, calcHours, getMonthRange } from '@/lib/hoursTracker'

export default async function AnalystAvailabilityPage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/login')
  if (!user.analystId) redirect('/dashboard/analyst')

  const supabase = await createClient()

  const { data: absences, error: absencesError } = await supabase
    .from('analyst_availability')
    .select('availability_id, date, session, status, reason')
    .eq('analyst_id', user.analystId)
    .gte('date', new Date().toISOString().slice(0, 10))
    .order('date', { ascending: true })
  if (absencesError) console.error('[AnalystAvailabilityPage] Failed to fetch analyst_availability:', absencesError.message)

  // This month's coverage hours -- each ACUITY_PERFORMANCE_API publication is
  // one 15-minute market coverage slot, tracked from DYNAMIC_ALLOCATION_START
  // onward.
  const now = new Date()
  const { start: monthStart, end: monthEnd } = getMonthRange(now.getFullYear(), now.getMonth() + 1)
  const { count: monthPubCount, error: monthPubError } = await supabase
    .from('analyst_publications')
    .select('publication_id', { count: 'exact', head: true })
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .eq('analyst_id', user.analystId)
    .gte('published_at', monthStart)
    .lte('published_at', monthEnd + 'T23:59:59Z')
  if (monthPubError) console.error('[AnalystAvailabilityPage] Failed to fetch this month analyst_publications:', monthPubError.message)
  const monthHours = calcHours(monthPubCount ?? 0)

  // Previous month only becomes meaningful once it falls within the valid
  // data window -- DYNAMIC_ALLOCATION_START (2026-09-01) is the first month
  // with any real data, so "previous month" only exists from October 2026.
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const showPrevMonth = prevMonthDate.toISOString().slice(0, 10) >= DYNAMIC_ALLOCATION_START
  let prevMonthHours: ReturnType<typeof calcHours> | null = null
  if (showPrevMonth) {
    const { start: prevStart, end: prevEnd } = getMonthRange(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1)
    const { count: prevPubCount, error: prevPubError } = await supabase
      .from('analyst_publications')
      .select('publication_id', { count: 'exact', head: true })
      .eq('source_system', 'ACUITY_PERFORMANCE_API')
      .eq('analyst_id', user.analystId)
      .gte('published_at', prevStart)
      .lte('published_at', prevEnd + 'T23:59:59Z')
    if (prevPubError) console.error('[AnalystAvailabilityPage] Failed to fetch previous month analyst_publications:', prevPubError.message)
    prevMonthHours = calcHours(prevPubCount ?? 0)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">My Availability</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Book planned absences for approval by your manager
          </p>
        </div>
        <a href="/dashboard/analyst"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Workspace
        </a>
      </div>

      <AbsenceBooking
        analystId={user.analystId}
        existingAbsences={absences ?? []}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-4 space-y-1">
          <h3 className="text-sm font-medium">This Month&apos;s Coverage</h3>
          <p className="text-xs text-muted-foreground">
            {now.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}
          </p>
          <div className="flex items-baseline gap-3 mt-2">
            <span className="text-2xl font-semibold">{monthHours.display}</span>
            <span className="text-sm text-muted-foreground">{monthHours.markets} markets</span>
          </div>
        </div>
        {showPrevMonth && prevMonthHours && (
          <div className="rounded-lg border border-border p-4 space-y-1">
            <h3 className="text-sm font-medium">Previous Month</h3>
            <p className="text-xs text-muted-foreground">
              {prevMonthDate.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}
            </p>
            <div className="flex items-baseline gap-3 mt-2">
              <span className="text-2xl font-semibold">{prevMonthHours.display}</span>
              <span className="text-sm text-muted-foreground">{prevMonthHours.markets} markets</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
