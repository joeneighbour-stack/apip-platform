'use client'

import { useState } from 'react'

interface EngineRun {
  engine_run_id: string
  session: string
  status: string
  started_at: string
  finished_at: string | null
  error_summary: string | null
  idempotency_key: string
}

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  RUNNING: 'bg-blue-100 text-blue-800',
  PARTIAL_SUCCESS: 'bg-amber-100 text-amber-800',
}

export function EngineRunsPanel({ runs }: { runs: EngineRun[] }) {
  const [retrying, setRetrying] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function handleRetry(run: EngineRun) {
    setRetrying(run.engine_run_id)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/engine/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engineRunId: run.engine_run_id, idempotencyKey: run.idempotency_key }),
      })
      const data = await res.json()
      setMessage(res.ok ? `Retry triggered for ${run.session}` : data.error ?? 'Failed')
    } finally {
      setRetrying(null)
    }
  }

  function duration(run: EngineRun): string {
    if (!run.finished_at) return 'Running...'
    const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
    return `${Math.round(ms / 1000)}s`
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    })
  }

  const failed = runs.filter(r => r.status === 'FAILED').length
  const running = runs.filter(r => r.status === 'RUNNING').length

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Engine Runs</h2>
        <div className="flex items-center gap-3">
          {running > 0 && <span className="text-xs text-blue-600 font-medium">{running} running</span>}
          {failed > 0 && <span className="text-xs text-red-600 font-medium">{failed} failed</span>}
        </div>
      </div>

      {message && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2">
          <p className="text-xs text-blue-800">{message}</p>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Key</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Session</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Started</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Duration</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Error</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {runs.map(run => (
              <tr key={run.engine_run_id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{run.idempotency_key}</td>
                <td className="px-4 py-2.5 font-medium">{run.session}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[run.status] ?? 'bg-muted text-muted-foreground'}`}>
                    {run.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(run.started_at)}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs tabular-nums">{duration(run)}</td>
                <td className="px-4 py-2.5 text-xs text-red-700 max-w-xs truncate">
                  {run.error_summary ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {run.status === 'FAILED' && (
                    <button
                      onClick={() => handleRetry(run)}
                      disabled={retrying === run.engine_run_id}
                      className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted disabled:opacity-50 transition-colors"
                    >
                      {retrying === run.engine_run_id ? 'Retrying...' : 'Retry'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
