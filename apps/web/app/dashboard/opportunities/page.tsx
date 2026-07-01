import { getCurrentUser } from '@/lib/auth'

export default async function OpportunityCentrePage() {
  const user = await getCurrentUser()

  // All roles that reach this page see it -- but the data shown differs.
  // Analysts: their assigned opportunities only (enforced by RLS + query filter)
  // Managers/Admin: full cross-analyst view
  const isManager = ['MANAGER', 'ADMIN'].includes(user.role)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Opportunity Centre</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isManager
            ? 'All active opportunities for the current session'
            : 'Your assigned opportunities for the current session'}
        </p>
      </div>

      {/* TODO Phase 1.7: Opportunity list with status, expected R, action */}
      <section className="rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium">Active Opportunities</h2>
          {isManager && (
            <span className="text-xs text-muted-foreground">All analysts</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Opportunities with ENTER_NOW and WAIT_FOR_PREFERRED_ZONE status will appear here,
          filtered to {isManager ? 'the full team' : 'your assigned markets'}.
        </p>
      </section>
    </div>
  )
}
