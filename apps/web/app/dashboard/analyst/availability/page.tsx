import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AbsenceBooking } from '@/components/analyst/AbsenceBooking'

export default async function AnalystAvailabilityPage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/dashboard')
  if (!user.analystId) redirect('/dashboard/analyst')

  const supabase = await createClient()

  const { data: absences } = await supabase
    .from('analyst_availability')
    .select('availability_id, date, session, status')
    .eq('analyst_id', user.analystId)
    .gte('date', new Date().toISOString().slice(0, 10))
    .order('date', { ascending: true })

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
          ← Back to Workspace
        </a>
      </div>

      <AbsenceBooking
        analystId={user.analystId}
        existingAbsences={absences ?? []}
      />
    </div>
  )
}
