'use client'

import { useState } from 'react'

interface AbsenceRequest {
  availability_id: string
  date: string
  session: string | null
  status: string
  analyst: { display_name: string; analyst_id: string } | null
}

interface Props {
  requests: AbsenceRequest[]
}

export function AbsenceQueue({ requests }: Props) {
  const [processing, setProcessing] = useState<string | null>(null)
  const [localRequests, setLocalRequests] = useState(requests)

  const pending = localRequests.filter(r => r.status === 'PENDING')
  const upcoming = localRequests.filter(r => r.status === 'APPROVED' && r.date >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10)

  async function handleAction(availabilityId: string, action: 'approve' | 'reject') {
    setProcessing(availabilityId)
    try {
      const res = await fetch('/api/absence/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availabilityId, action }),
      })
      if (res.ok) {
        setLocalRequests(prev => prev.map(r =>
          r.availability_id === availabilityId
            ? { ...r, status: action === 'approve' ? 'APPROVED' : 'REJECTED' }
            : r
        ))
      }
    } finally {
      setProcessing(null)
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium">Absence Management</h2>

      {/* Pending requests */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{pending.length} pending request{pending.length !== 1 ? 's' : ''}</p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-amber-100/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Analyst</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Session</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {pending.map(req => (
                  <tr key={req.availability_id}>
                    <td className="px-4 py-2.5 font-medium">{req.analyst?.display_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{formatDate(req.date)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{req.session ?? 'All sessions'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleAction(req.availability_id, 'approve')}
                          disabled={processing === req.availability_id}
                          className="text-xs px-3 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleAction(req.availability_id, 'reject')}
                          disabled={processing === req.availability_id}
                          className="text-xs px-3 py-1 rounded-md border border-border hover:bg-muted disabled:opacity-50 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Upcoming approved absences */}
      {upcoming.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Upcoming approved absences</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Analyst</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Session</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {upcoming.map(req => (
                  <tr key={req.availability_id}>
                    <td className="px-4 py-2.5 font-medium">{req.analyst?.display_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{formatDate(req.date)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{req.session ?? 'All sessions'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pending.length === 0 && upcoming.length === 0 && (
        <div className="rounded-lg border border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">No pending requests or upcoming absences.</p>
        </div>
      )}
    </div>
  )
}
