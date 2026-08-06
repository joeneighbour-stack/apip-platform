'use client'
import Link from 'next/link'

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
  session: string
}

interface WorkloadPanelProps {
  allocations: Allocation[]
  availability: Availability[]
}

export function WorkloadPanel({ allocations, availability }: WorkloadPanelProps) {
  // Count and group allocations per analyst
  const byAnalyst = new Map<string, { name: string; allocs: Allocation[] }>()
  for (const alloc of allocations) {
    if (!alloc.analyst) continue
    const { analyst_id, display_name } = alloc.analyst
    const existing = byAnalyst.get(analyst_id)
    if (existing) existing.allocs.push(alloc)
    else byAnalyst.set(analyst_id, { name: display_name, allocs: [alloc] })
  }

  const capByAnalyst = new Map(availability.map(a => [a.analyst_id, a.workload_cap]))
  const entries = [...byAnalyst.entries()].sort((a, b) => b[1].allocs.length - a[1].allocs.length)

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Team Workload Today</h2>
      {entries.length === 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">No allocations yet for today&apos;s session.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {entries.map(([analystId, { name, allocs }]) => {
              const cap = capByAnalyst.get(analystId) ?? null
              const atCap = cap !== null && allocs.length >= cap
              return (
                <div
                  key={analystId}
                  className={`rounded-lg border p-3 text-left ${
                    atCap ? 'border-amber-200 bg-amber-50' : 'border-border bg-card'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs text-muted-foreground truncate">{name}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link href={`/dashboard/management/analyst/${analystId}/workspace`} className="text-xs text-primary hover:underline">View</Link>
                      <Link href={`/dashboard/management/analyst/${analystId}`} className="text-xs text-primary hover:underline">Profile</Link>
                    </div>
                  </div>
                  <p className="text-2xl font-semibold mt-1">{allocs.length}</p>
                  <p className="text-xs text-muted-foreground">
                    {cap !== null ? `of ${cap} max` : 'markets'}
                  </p>
                  {atCap && <p className="text-xs text-amber-700 mt-1 font-medium">At capacity</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}


