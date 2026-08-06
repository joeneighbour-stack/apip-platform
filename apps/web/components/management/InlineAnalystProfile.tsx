'use client'
import { useEffect, useState } from 'react'
import { KpiSummary } from '@/components/analyst/KpiSummary'

interface Kpi {
  kpi_name: string
  kpi_value: any
  period_start: string
  period_end: string
}

interface Props {
  analystId: string
}

// Lazily fetched on mount -- only rendered while the "Profile" panel is open (see
// WorkloadPanel.tsx), so this never fetches until the manager actually expands it.
export function InlineAnalystProfile({ analystId }: Props) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; kpis: Kpi[]; kpiTrend: Kpi[] }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    fetch(`/api/management/analyst/${analystId}/kpis`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load')
        return res.json()
      })
      .then(data => {
        if (!cancelled) setState({ status: 'ready', kpis: data.kpis ?? [], kpiTrend: data.kpiTrend ?? [] })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => { cancelled = true }
  }, [analystId])

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <a href={`/dashboard/management/analyst/${analystId}`}
          className="text-sm text-primary hover:underline">
          Open full profile &#8599;
        </a>
      </div>
      {state.status === 'loading' && (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Loading KPIs&hellip;</p>
        </div>
      )}
      {state.status === 'error' && (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load KPI data.</p>
        </div>
      )}
      {state.status === 'ready' && <KpiSummary kpis={state.kpis} kpiTrend={state.kpiTrend} />}
    </div>
  )
}
