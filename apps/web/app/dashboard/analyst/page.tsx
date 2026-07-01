import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function AnalystWorkspacePage() {
  const user = await getCurrentUser()

  // Analysts only -- managers/executives should use their own workspace.
  // This is a belt-and-suspenders check; RLS also enforces data scoping.
  if (user.role !== 'ANALYST') {
    redirect('/dashboard')
  }

  if (!user.analystId) {
    // Authenticated as ANALYST role but no analyst record linked -- config error.
    return (
      <div className="rounded-lg border border-border p-6">
        <p className="text-sm text-muted-foreground">
          Your account is not yet linked to an analyst profile. Contact your administrator.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">My Workspace</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Today's coaching recommendations and post-trade reviews
        </p>
      </div>

      {/* TODO Phase 1.7: Today's coaching recommendations */}
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-sm font-medium mb-4">Today's Markets</h2>
        <p className="text-sm text-muted-foreground">
          Coaching recommendations will appear here once the engine has run for today's session.
        </p>
      </section>

      {/* TODO Phase 1.7: Post-trade reviews pending acknowledgement */}
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-sm font-medium mb-4">Pending Reviews</h2>
        <p className="text-sm text-muted-foreground">
          Post-trade reviews requiring your acknowledgement will appear here.
        </p>
      </section>
    </div>
  )
}
