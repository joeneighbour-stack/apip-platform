'use client'

interface Allocation {
  analyst: { analyst_id: string; display_name: string } | null
}

interface Availability {
  analyst_id: string
  available: boolean
  workload_cap: number | null
  session: string
}

interface WorkloadPanelProps {
  allocations: Allocation[]
  availability: Availability[]
}

export function WorkloadPanel({ allocations, availability }: WorkloadPanelProps) {
  // Count allocations per analyst
  const countByAnalyst = new Map<string, { name: string; count: number }>()
  for (const alloc of allocations) {
    if (!alloc.analyst) continue
    const { analyst_id, display_name } = alloc.analyst
    const existing = countByAnalyst.get(analyst_id)
    if (existing) existing.count++
    else countByAnalyst.set(analyst_id, { name: display_name, count: 1 })
  }

  const capByAnalyst = new Map(availability.map(a => [a.analyst_id, a.workload_cap]))
  const entries = [...countByAnalyst.entries()].sort((a, b) => b[1].count - a[1].count)

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Team Workload Today</h2>
      {entries.length === 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">No allocations yet for today's session.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {entries.map(([analystId, { name, count }]) => {
            const cap = capByAnalyst.get(analystId) ?? null
            const atCap = cap !== null && count >= cap
            return (
              <div key={analystId} className={`rounded-lg border p-3 ${atCap ? 'border-amber-200 bg-amber-50' : 'border-border bg-card'}`}>
                <p className="text-xs text-muted-foreground truncate">{name}</p>
                <p className="text-2xl font-semibold mt-1">{count}</p>
                <p className="text-xs text-muted-foreground">
                  {cap !== null ? `of ${cap} max` : 'markets'}
                </p>
                {atCap && <p className="text-xs text-amber-700 mt-1 font-medium">At capacity</p>}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
