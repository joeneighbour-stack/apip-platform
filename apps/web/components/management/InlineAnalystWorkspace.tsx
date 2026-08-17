'use client'
import { useEffect, useState } from 'react'
import { CoverageStrip } from '@/components/analyst/workspace/CoverageStrip'
import type { WorkspaceRow } from '@/components/analyst/workspace/types'

interface Props {
  analystId: string
}

// Lazily fetched on mount -- only rendered while the "View" panel is open (see
// WorkloadPanel.tsx), so this never fetches until the manager actually expands it.
export function InlineAnalystWorkspace({ analystId }: Props) {
  const [state, setState] = useState<
    | { status: 'loading' } | { status: 'error' }
    | { status: 'ready'; rows: WorkspaceRow[]; recommendationsGeneratedToday: number }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    fetch(`/api/management/analyst/${analystId}/workspace`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load')
        return res.json()
      })
      .then(data => {
        if (!cancelled) setState({ status: 'ready', rows: data.rows ?? [], recommendationsGeneratedToday: data.recommendationsGeneratedToday ?? 0 })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => { cancelled = true }
  }, [analystId])

  return (
    <div className="space-y-4">
      {state.status === 'loading' && (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Loading workspace&hellip;</p>
        </div>
      )}
      {state.status === 'error' && (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load workspace data.</p>
        </div>
      )}
      {state.status === 'ready' && (
        <CoverageStrip rows={state.rows} recommendationsGeneratedToday={state.recommendationsGeneratedToday} readOnly />
      )}
    </div>
  )
}
