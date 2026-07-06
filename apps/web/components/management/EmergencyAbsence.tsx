'use client'

import { useState } from 'react'

interface Analyst {
  analyst_id: string
  display_name: string
}

interface Props {
  analysts: Analyst[]
}

const SESSIONS = ['EUROPEAN', 'US', 'APAC']

export function EmergencyAbsence({ analysts }: Props) {
  const [open, setOpen] = useState(false)
  const [analystId, setAnalystId] = useState('')
  const [session, setSession] = useState('EUROPEAN')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit() {
    if (!analystId) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/absence/emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analystId, session }),
      })
      if (res.ok) {
        setDone(true)
        setTimeout(() => { setOpen(false); setDone(false); setAnalystId('') }, 2000)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <button onClick={() => setOpen(!open)}
        className="text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 transition-colors">
        Emergency absence
      </button>

      {open && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
          <p className="text-sm font-medium text-red-800">Mark analyst absent — today only</p>
          <p className="text-xs text-red-700">
            This will immediately mark the analyst as unavailable for the selected session today.
            Re-run the engine after confirming to redistribute their markets.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Analyst</p>
              <select value={analystId} onChange={e => setAnalystId(e.target.value)}
                className="w-full text-sm px-2.5 py-2 rounded-md border border-border bg-background">
                <option value="">Select analyst</option>
                {analysts.map(a => <option key={a.analyst_id} value={a.analyst_id}>{a.display_name}</option>)}
              </select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Session</p>
              <select value={session} onChange={e => setSession(e.target.value)}
                className="w-full text-sm px-2.5 py-2 rounded-md border border-border bg-background">
                {SESSIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {done
            ? <p className="text-xs text-green-700 font-medium">✓ Marked absent. Re-run the engine to redistribute markets.</p>
            : (
              <div className="flex gap-2">
                <button onClick={handleSubmit} disabled={!analystId || submitting}
                  className="text-xs px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                  {submitting ? 'Saving...' : 'Confirm absence'}
                </button>
                <button onClick={() => setOpen(false)}
                  className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
                  Cancel
                </button>
              </div>
            )
          }
        </div>
      )}
    </div>
  )
}
