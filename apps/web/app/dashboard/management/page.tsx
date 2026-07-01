import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function ManagementWorkspacePage() {
  const user = await getCurrentUser()

  if (!['MANAGER', 'ADMIN'].includes(user.role)) {
    redirect('/dashboard')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Allocation, team workload, and coaching review oversight
        </p>
      </div>

      {/* TODO Phase 1.7: Session allocation view */}
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-sm font-medium mb-4">Today's Allocation</h2>
        <p className="text-sm text-muted-foreground">
          Analyst assignments and workload for the current session will appear here.
        </p>
      </section>

      {/* TODO Phase 1.7: Stale / DO_NOT_USE_RECALCULATE exceptions */}
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-sm font-medium mb-4">Exceptions</h2>
        <p className="text-sm text-muted-foreground">
          Recommendations requiring attention (stale, zone changed, do not use) will appear here.
        </p>
      </section>

      {/* TODO Phase 1.7: Team coaching review overview */}
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-sm font-medium mb-4">Coaching Reviews</h2>
        <p className="text-sm text-muted-foreground">
          Team post-trade review status will appear here.
        </p>
      </section>
    </div>
  )
}
