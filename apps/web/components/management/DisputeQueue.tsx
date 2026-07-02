'use client'

import { useState } from 'react'
import { resolveDispute, rejectDispute } from '@/app/actions/disputes'

interface Dispute {
  dispute_id: string
  dispute_type: string
  analyst_note: string | null
  status: string
  original_values: any
  created_at: string
  analyst: { display_name: string } | null
}

interface DisputeQueueProps {
  disputes: Dispute[]
  isAdmin: boolean
}

function DisputeRow({ dispute, isAdmin }: { dispute: Dispute; isAdmin: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [adminNote, setAdminNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const typeLabels: Record<string, string> = {
    MISSED_TRIGGER: 'Missed trigger',
    WRONG_ENTRY: 'Wrong entry',
    WRONG_OUTCOME: 'Wrong outcome',
    OTHER: 'Other',
  }

  async function handleResolve() {
    if (!adminNote.trim()) { setError('Admin note is required for resolution'); return }
    setSubmitting(true)
    setError(null)
    const result = await resolveDispute(dispute.dispute_id, adminNote, {})
    if (result.error) { setError(result.error); setSubmitting(false); return }
    setDone(true)
  }

  async function handleReject() {
    if (!adminNote.trim()) { setError('Admin note is required for rejection'); return }
    setSubmitting(true)
    setError(null)
    const result = await rejectDispute(dispute.dispute_id, adminNote)
    if (result.error) { setError(result.error); setSubmitting(false); return }
    setDone(true)
  }

  if (done) {
    return (
      <div className="px-4 py-3 bg-green-50 text-sm text-green-700 rounded">
        Dispute updated successfully.
      </div>
    )
  }

  const date = new Date(dispute.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="font-medium text-sm">{dispute.analyst?.display_name ?? 'Unknown'}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
            {typeLabels[dispute.dispute_type] ?? dispute.dispute_type}
          </span>
          <span className="text-xs text-muted-foreground">{date}</span>
        </div>
        <span className="text-xs text-muted-foreground">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div className="rounded-md bg-muted/50 p-3 text-xs space-y-2">
            <p className="font-medium text-muted-foreground">Original trade values</p>
            <pre className="text-foreground overflow-auto">
              {JSON.stringify(dispute.original_values, null, 2)}
            </pre>
          </div>

          {dispute.analyst_note && (
            <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
              <p className="text-xs text-blue-800">
                <span className="font-medium">Analyst note: </span>{dispute.analyst_note}
              </p>
            </div>
          )}

          {isAdmin && (
            <div className="space-y-2">
              <textarea
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                rows={2}
                placeholder="Admin note (required before resolving or rejecting)..."
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleResolve}
                  disabled={submitting}
                  className="px-3 py-1.5 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Saving...' : 'Resolve'}
                </button>
                <button
                  onClick={handleReject}
                  disabled={submitting}
                  className="px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function DisputeQueue({ disputes, isAdmin }: DisputeQueueProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Open Disputes</h2>
        {disputes.length > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
            {disputes.length} open
          </span>
        )}
      </div>
      {disputes.length === 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">No open disputes.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {disputes.map(d => (
            <DisputeRow key={d.dispute_id} dispute={d} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </section>
  )
}
