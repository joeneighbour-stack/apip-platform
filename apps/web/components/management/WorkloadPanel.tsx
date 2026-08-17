interface AllocationOpportunity {
  analyst_action: string | null
  direction: string | null
  expected_r: number | null
  trigger_probability: number | null
  current_zone: string | null
  preferred_entry_zone: string | null
  market: { symbol: string; asset_class: string } | null
}

interface Allocation {
  allocation_id: string
  analyst: { analyst_id: string; display_name: string } | null
  opportunity: AllocationOpportunity | null
}

interface Availability {
  analyst_id: string
  available: boolean
  workload_cap: number | null
  session: string | null
}

interface WorkloadPanelProps {
  allocations: Allocation[]
  // No longer read here (the per-analyst capacity indicator was dropped along with the
  // card/inline-expand layout), kept in the signature so callers don't need to change.
  availability: Availability[]
}

export function WorkloadPanel({ allocations }: WorkloadPanelProps) {
  // Count and group allocations per analyst
  const byAnalyst = new Map<string, { name: string; allocs: Allocation[] }>()
  for (const alloc of allocations) {
    if (!alloc.analyst) continue
    const { analyst_id, display_name } = alloc.analyst
    const existing = byAnalyst.get(analyst_id)
    if (existing) existing.allocs.push(alloc)
    else byAnalyst.set(analyst_id, { name: display_name, allocs: [alloc] })
  }

  const entries = [...byAnalyst.entries()].sort((a, b) => b[1].allocs.length - a[1].allocs.length)

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Team Workload Today</h2>
      {entries.length === 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">No allocations yet for today&apos;s session.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border">
          {entries.map(([analystId, { name, allocs }]) => (
            <div key={analystId} className="flex items-center justify-between px-4 py-2">
              <span className="font-medium text-sm">{name}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">{allocs.length} markets</span>
                <a href={`/dashboard/management/analyst/${analystId}/workspace`}
                  className="text-xs text-accent hover:underline">
                  View workspace &rarr;
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
