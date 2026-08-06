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
  session: string
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
              const isExpanded = expandedAnalystId === analystId
              return (
                <div
                  key={analystId}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    atCap ? 'border-amber-200 bg-amber-50' :
                    isExpanded ? 'border-primary bg-primary/5' :
                    'border-border bg-card'
                  }`}
                >
                  <p className="text-xs text-muted-foreground truncate">{name}</p>
                  <p className="text-2xl font-semibold mt-1">{allocs.length}</p>
                  <p className="text-xs text-muted-foreground">
                    {cap !== null ? `of ${cap} max` : 'markets'}
                  </p>
                  {atCap && <p className="text-xs text-amber-700 mt-1 font-medium">At capacity</p>}
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={() => toggle(analystId, 'view')}
                      className={`text-xs hover:underline ${isExpanded && expandedPanel === 'view' ? 'font-medium text-primary' : 'text-primary'}`}
                    >
                      View
                    </button>
                    <button
                      onClick={() => toggle(analystId, 'profile')}
                      className={`text-xs hover:underline ${isExpanded && expandedPanel === 'profile' ? 'font-medium text-primary' : 'text-primary'}`}
                    >
                      Profile
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Inline expand: View (workspace coverage strip) or Profile (KPI summary) */}
          {expandedAnalystId && expandedPanel && byAnalyst.has(expandedAnalystId) && (
            <div className="rounded-lg border border-primary/20 bg-card overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
                <p className="text-xs font-medium">
                  {byAnalyst.get(expandedAnalystId)!.name} &mdash; {expandedPanel === 'view' ? 'Workspace' : 'Profile'}
                </p>
              </div>
              <div className="p-4">
                {expandedPanel === 'view' ? (
                  <InlineAnalystWorkspace analystId={expandedAnalystId} />
                ) : (
                  <InlineAnalystProfile analystId={expandedAnalystId} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
