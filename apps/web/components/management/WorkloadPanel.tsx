'use client'
import { useState } from 'react'
import { InlineAnalystProfile } from './InlineAnalystProfile'

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

          {/* Inline expand: View (today's allocations) or Profile (KPI summary) */}
          {expandedAnalystId && expandedPanel && byAnalyst.has(expandedAnalystId) && (
            <div className="rounded-lg border border-primary/20 bg-card overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                <p className="text-xs font-medium">
                  {byAnalyst.get(expandedAnalystId)!.name} &mdash; {expandedPanel === 'view' ? "Today's Markets" : 'Profile'}
                </p>
                {expandedPanel === 'view' && (
                  <a href={`/dashboard/management/analyst/${expandedAnalystId}/workspace`}
                    className="text-xs text-primary hover:underline">
                    Open full workspace &#8599;
                  </a>
                )}
              </div>
              <div className={expandedPanel === 'profile' ? 'p-4' : ''}>
                {expandedPanel === 'view' ? (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Market</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Direction</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Zone</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Action</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Trigger %</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Exp R</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {byAnalyst.get(expandedAnalystId)!.allocs.map(alloc => {
                        const opp = alloc.opportunity as any
                        return (
                          <tr key={alloc.allocation_id} className="hover:bg-muted/20">
                            <td className="px-3 py-2 text-xs font-medium">{opp?.market?.symbol ?? '—'}</td>
                            <td className="px-3 py-2">
                              {opp?.direction ? (
                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${opp.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                  {opp.direction}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{opp?.current_zone ?? '—'}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{opp?.analyst_action?.replace('_', ' ') ?? '—'}</td>
                            <td className="px-3 py-2 text-xs tabular-nums">
                              {opp?.trigger_probability != null ? `${Math.round(Number(opp.trigger_probability) * 100)}%` : '—'}
                            </td>
                            <td className="px-3 py-2 text-xs tabular-nums">
                              {opp?.expected_r != null ? `${Number(opp.expected_r).toFixed(2)}R` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
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
