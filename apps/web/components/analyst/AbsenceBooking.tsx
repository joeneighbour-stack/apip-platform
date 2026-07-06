'use client'

import { useState } from 'react'

interface Absence {
  availability_id: string
  date: string
  session: string | null
  status: string
}

interface Props {
  analystId: string
  existingAbsences: Absence[]
}

const SESSIONS = ['All sessions', 'EUROPEAN', 'US', 'APAC']

const STATUS_COLOURS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
}

export function AbsenceBooking({ analystId, existingAbsences }: Props) {
  const [absences, setAbsences] = useState(existingAbsences)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [session, setSession] = useState('All sessions')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    })
  }

  // Generate date range from fromDate to toDate
  function dateRange(from: string, to: string): string[] {
    const dates: string[] = []
    const current = new Date(from)
    const end = new Date(to)
    while (current <= end) {
      const day = current.getDay()
      if (day !== 0 && day !== 6) { // skip weekends
        dates.push(current.toISOString().slice(0, 10))
      }
      current.setDate(current.getDate() + 1)
    }
    return dates
  }

  async function handleSubmit() {
    if (!fromDate) { setError('Please select a start date'); return }
    const endDate = toDate || fromDate
    if (endDate < fromDate) { setError('End date must be on or after start date'); return }

    const dates = dateRange(fromDate, endDate)
    if (dates.length === 0) { setError('No working days in selected range'); return }
    if (dates.length > 30) { setError('Maximum 30 working days per request'); return }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/absence/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analystId,
          dates,
          session: session === 'All sessions' ? null : session,
        }),
      })

      if (!res.ok) {
        const body = await res.json()
        setError(body.error ?? 'Failed to submit request')
        return
      }

      const { created } = await res.json()
      setAbsences(prev => [...prev, ...created])
      setFromDate('')
      setToDate('')
      setSession('All sessions')
    } catch {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel(availabilityId: string) {
    const res = await fetch('/api/absence/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ availabilityId }),
    })
    if (res.ok) {
      setAbsences(prev => prev.filter(a => a.availability_id !== availabilityId))
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-6">
      {/* Booking form */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <p className="text-sm font-medium">Request absence</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">From date</p>
            <input type="date" value={fromDate} min={today}
              onChange={e => setFromDate(e.target.value)}
              className="w-full text-sm px-2.5 py-2 rounded-md border border-border bg-background" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">To date (optional)</p>
            <input type="date" value={toDate} min={fromDate || today}
              onChange={e => setToDate(e.target.value)}
              className="w-full text-sm px-2.5 py-2 rounded-md border border-border bg-background" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Session</p>
            <select value={session} onChange={e => setSession(e.target.value)}
              className="w-full text-sm px-2.5 py-2 rounded-md border border-border bg-background">
              {SESSIONS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button onClick={handleSubmit} disabled={submitting || !fromDate}
          className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {submitting ? 'Submitting...' : 'Submit request'}
        </button>

        <p className="text-xs text-muted-foreground">
          Weekends are automatically excluded. Your manager will be notified to approve.
        </p>
      </div>

      {/* Existing absences */}
      {absences.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Upcoming absence requests</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Session</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {absences.map(a => (
                  <tr key={a.availability_id}>
                    <td className="px-4 py-2.5">{formatDate(a.date)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.session ?? 'All sessions'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOURS[a.status] ?? ''}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {a.status === 'PENDING' && (
                        <button onClick={() => handleCancel(a.availability_id)}
                          className="text-xs text-muted-foreground hover:text-red-600 transition-colors">
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
