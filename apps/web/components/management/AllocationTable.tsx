'use client'

interface Allocation {
  allocation_id: string
  allocation_status: string
  allocation_score: number | null
  assigned_by_type: string | null
  assigned_at: string | null
  reason_summary: string | null
  opportunity: {
    analyst_action: string
    direction: string
    expected_r: number
    trigger_probability: number
    current_zone: string | null
    market: { symbol: string; asset_class: string } | null
  } | null
  analyst: { display_name: string } | null
}

interface AllocationTableProps {
  allocations: Allocation[]
}

export function AllocationTable({ allocations }: AllocationTableProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Today's Allocation</h2>
      {allocations.length === 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">No allocations for today's session yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Market</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Class</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Dir</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Action</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Expected R</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Analyst</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">By</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allocations.map((alloc) => {
                const opp = alloc.opportunity
                const market = opp?.market
                return (
                  <tr key={alloc.allocation_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{market?.symbol ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{market?.asset_class ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        opp?.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>{opp?.direction ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        opp?.analyst_action === 'ENTER_NOW' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {opp?.analyst_action === 'ENTER_NOW' ? 'Enter Now' : 'Wait'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{opp ? `${Number(opp.expected_r).toFixed(2)}R` : '—'}</td>
                    <td className="px-4 py-2.5">{alloc.analyst?.display_name ?? 'Unassigned'}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">
                      {alloc.assigned_by_type?.toLowerCase() ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground text-xs">
                      {alloc.allocation_score !== null ? Number(alloc.allocation_score).toFixed(2) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
