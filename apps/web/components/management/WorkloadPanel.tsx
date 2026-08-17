'use client'
import { useState } from 'react'
import { InlineAnalystProfile } from './InlineAnalystProfile'
import { InlineAnalystWorkspace } from './InlineAnalystWorkspace'

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
  availability: Availability[]
}

type Panel = 'view' | 'profile' | null

export function WorkloadPanel({ allocations, availability }: WorkloadPanelProps) {
  const [expandedAnalystId, setExpandedAnalystId] = useState<string | null>(null)
  const [expandedPanel, setExpandedPanel] = useState<Panel>(null)

  // Only one panel (View or Profile), for at most one analyst, is ever open at a time --
  // clicking a button for a different analyst (or the other button for the same one)
  // switches straight to that panel rather than requiring a separate collapse first.
  function toggle(analystId: string, panel: 'view' | 'profile') {
    if (expandedAnalystId === analystId && expandedPanel === panel) {
      setExpandedAnalystId(null)
      setExpandedPanel(null)
    } else {
      setExpandedAnalystId(analystId)
      setExpandedPanel(panel)
    }
  }

  // Count and group allocations per analyst
  const byAnalyst = new Map<string, { name: string; allocs: Allocation[] }>()
  for (const alloc of allocations) {
    if (!alloc.analyst) continue
    const { analyst_id, display_name } = alloc.analyst
    const existing = byAnalyst.get(analyst_id)
    if (existing) existing.allocs.push(alloc)
    else byAnalyst.set(analyst_id, { name: display_name, allocs: [alloc] })
  }

  // Per-analyst configured cap, not a fixed constant -- analysts without a workload_cap
  // set (null) never show the badge, same as before this row layout was simplified.
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
        <div className="rounded-lg border border-border px-4">
          {entries.map(([analystId, { name, allocs }]) => {
            const cap = capByAnalyst.get(analystId) ?? null
            const isAtCapacity = cap !== null && allocs.length >= cap
            const isExpanded = expandedAnalystId === analystId
            return (
              <div key={analystId} className="border-b border-border last:border-0">
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{name}</span>
                    {isAtCapacity && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        At capacity
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">{allocs.length} markets</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggle(analystId, 'view')}
                        className={`text-xs px-2 py-1 rounded border hover:bg-muted/30 ${
                          isExpanded && expandedPanel === 'view' ? 'border-primary text-primary font-medium' : 'border-border'
                        }`}
                      >
                        View
                      </button>
                      <button
                        onClick={() => toggle(analystId, 'profile')}
                        className={`text-xs px-2 py-1 rounded border hover:bg-muted/30 ${
                          isExpanded && expandedPanel === 'profile' ? 'border-primary text-primary font-medium' : 'border-border'
                        }`}
                      >
                        Profile
                      </button>
                    </div>
                  </div>
                </div>
                {isExpanded && expandedPanel && (
                  <div className="pb-3">
                    {expandedPanel === 'view' ? (
                      <InlineAnalystWorkspace analystId={analystId} />
                    ) : (
                      <InlineAnalystProfile analystId={analystId} />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
