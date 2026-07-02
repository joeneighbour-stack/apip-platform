import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export default async function OpportunityCentrePage() {
  const user = await getCurrentUser()
  const supabase = await createClient()
  const isManager = ['MANAGER', 'ADMIN'].includes(user.role)
  const today = new Date().toISOString().split('T')[0]

  const { data: opportunities } = await supabase
    .from('opportunities')
    .select(`
      opportunity_id, direction, analyst_action,
      expected_r, trigger_probability,
      opportunity_lifecycle_status, current_zone,
      preferred_entry_zone, date, session,
      market:market_id ( symbol, asset_class ),
      analyst:assigned_analyst_id ( display_name )
    `)
    .eq('date', today)
    .order('expected_r', { ascending: false })

  // For analyst view -- fetch their coaching recommendations to get ranges
  let coachingByOpportunity: Map<string, any> = new Map()
  if (!isManager && user.analystId) {
    const { data: coaching } = await supabase
      .from('coaching_recommendations')
      .select(`
        opportunity_id, entry_range_low, entry_range_high,
        risk_range, target_range, trigger_probability,
        expected_r, coaching_note
      `)
      .eq('analyst_id', user.analystId)
    coachingByOpportunity = new Map(
      (coaching ?? []).map(c => [c.opportunity_id, c])
    )
  }

  function statusConfig(status: string) {
    if (status === 'SHOWN') return { label: 'Active', cls: 'bg-green-50 text-green-700' }
    if (status === 'ASSIGNED') return { label: 'Assigned', cls: 'bg-blue-50 text-blue-700' }
    if (status === 'GENERATED') return { label: 'Generated', cls: 'bg-purple-50 text-purple-700' }
    if (status === 'CLOSED') return { label: 'Closed', cls: 'bg-muted text-muted-foreground' }
    return { label: status, cls: 'bg-muted text-muted-foreground' }
  }

  function actionConfig(action: string | null) {
    if (action === 'ENTER_NOW') return { label: 'Enter Now', cls: 'bg-green-50 text-green-700' }
    if (action === 'WAIT_FOR_PREFERRED_ZONE') return { label: 'Wait', cls: 'bg-amber-50 text-amber-700' }
    if (action === 'REVIEW_ONLY') return { label: 'Review Only', cls: 'bg-muted text-muted-foreground' }
    return null
  }

  const dateLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Opportunity Centre</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isManager
              ? `All opportunities for today's session — ${opportunities?.length ?? 0} total`
              : `Your assigned opportunities for today`}
          </p>
        </div>
        <div className="text-xs text-muted-foreground">{dateLabel}</div>
      </div>

      {!opportunities || opportunities.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {isManager
              ? "No opportunities generated for today's session yet."
              : "No opportunities assigned to you for today's session yet."}
          </p>
        </div>
      ) : isManager ? (
        // ── MANAGER VIEW: compact table ──────────────────────────────────
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Market</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Class</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Dir</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Zone</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Action</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Expected R</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Trigger</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Analyst</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {opportunities.map((opp) => {
                const market = opp.market as any
                const analyst = opp.analyst as any
                const status = statusConfig(opp.opportunity_lifecycle_status)
                const action = actionConfig(opp.analyst_action)
                return (
                  <tr key={opp.opportunity_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{market?.symbol ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{market?.asset_class ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        opp.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>{opp.direction}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <span>{opp.current_zone}</span>
                      {opp.preferred_entry_zone !== opp.current_zone && (
                        <span className="ml-1 text-amber-600">→ {opp.preferred_entry_zone}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {action ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${action.cls}`}>
                          {action.label}
                        </span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums">{Number(opp.expected_r).toFixed(2)}R</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {Math.round(Number(opp.trigger_probability) * 100)}%
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.cls}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {analyst?.display_name ?? (
                        <span className="text-xs text-muted-foreground">Unassigned</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        // ── ANALYST VIEW: cards with entry/risk/target ranges ────────────
        <div className="space-y-3">
          {opportunities.map((opp) => {
            const market = opp.market as any
            const coaching = coachingByOpportunity.get(opp.opportunity_id)
            const action = actionConfig(opp.analyst_action)
            const status = statusConfig(opp.opportunity_lifecycle_status)

            return (
              <div key={opp.opportunity_id}
                className="rounded-lg border border-border bg-card p-5 space-y-4">

                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-base">{market?.symbol ?? '—'}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      opp.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>{opp.direction}</span>
                    {action && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${action.cls}`}>
                        {action.label}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.cls}`}>
                      {status.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    <span className="text-muted-foreground">
                      Trigger <span className="font-medium text-foreground">
                        {Math.round(Number(opp.trigger_probability) * 100)}%
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Expected R <span className="font-medium text-foreground">
                        {Number(opp.expected_r).toFixed(2)}R
                      </span>
                    </span>
                  </div>
                </div>

                {/* Ranges -- from coaching_recommendations if available */}
                {coaching ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground mb-1">Entry range</p>
                      <p className="text-sm font-medium tabular-nums">
                        {Number(coaching.entry_range_low).toFixed(4)} – {Number(coaching.entry_range_high).toFixed(4)}
                      </p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground mb-1">Risk area</p>
                      <p className="text-sm font-medium tabular-nums">{coaching.risk_range}</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground mb-1">Target area</p>
                      <p className="text-sm font-medium tabular-nums">{coaching.target_range}</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">
                      Coaching ranges not yet available for this opportunity.
                    </p>
                  </div>
                )}

                {/* Zone context */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Current: <span className="font-medium text-foreground">{opp.current_zone}</span></span>
                  {opp.preferred_entry_zone !== opp.current_zone && (
                    <span>Preferred: <span className="font-medium text-amber-700">{opp.preferred_entry_zone}</span></span>
                  )}
                </div>

                {/* Coaching note if available */}
                {coaching?.coaching_note && (
                  <div className="rounded-md bg-muted/30 border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground mb-1 font-medium">Coaching note</p>
                    <p className="text-sm text-foreground leading-relaxed">{coaching.coaching_note}</p>
                  </div>
                )}
              </div>
            )
          })}
          <p className="text-xs text-muted-foreground pt-1">
            Showing your assigned opportunities only. Contact your manager if you believe markets are missing.
          </p>
        </div>
      )}
    </div>
  )
}
