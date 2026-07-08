'use client'

import { useState } from 'react'

interface Analyst {
  analyst_id: string
  display_name: string
  active: boolean
  sessions: string[] | null
}

const ALL_SESSIONS = ['EUROPEAN', 'US', 'APAC']

export function AnalystManagementPanel({ analysts }: { analysts: Analyst[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [sessionChanges, setSessionChanges] = useState<Record<string, string[]>>({})
  const [activeChanges, setActiveChanges] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function toggleSession(analystId: string, session: string, currentSessions: string[]) {
    const current = sessionChanges[analystId] ?? currentSessions
    const updated = current.includes(session)
      ? current.filter(s => s !== session)
      : [...current, session]
    setSessionChanges(prev => ({ ...prev, [analystId]: updated }))
  }

  async function handleSave(analyst: Analyst) {
    setSaving(analyst.analyst_id)
    setMessage(null)
    const newSessions = sessionChanges[analyst.analyst_id] ?? analyst.sessions ?? []
    const newActive = activeChanges[analyst.analyst_id] ?? analyst.active

    try {
      const res = await fetch('/api/admin/analysts/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analystId: analyst.analyst_id, sessions: newSessions, active: newActive }),
      })
      const data = await res.json()
      setMessage(res.ok ? `Updated ${analyst.display_name}` : data.error ?? 'Failed')
      if (res.ok) setEditing(null)
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Analyst Management</h2>
        <span className="text-xs text-muted-foreground">{analysts.filter(a => a.active).length} active</span>
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
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Analyst</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Sessions</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {analysts.map(analyst => {
              const currentSessions = sessionChanges[analyst.analyst_id] ?? analyst.sessions ?? []
              const isActive = activeChanges[analyst.analyst_id] ?? analyst.active
              return (
                <tr key={analyst.analyst_id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{analyst.display_name}</td>
                  <td className="px-4 py-2.5">
                    {editing === analyst.analyst_id ? (
                      <button
                        onClick={() => setActiveChanges(prev => ({ ...prev, [analyst.analyst_id]: !isActive }))}
                        className={`text-xs font-medium px-2 py-0.5 rounded-full transition-colors ${
                          isActive ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {isActive ? 'Active' : 'Inactive'}
                      </button>
                    ) : (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        analyst.active ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'
                      }`}>
                        {analyst.active ? 'Active' : 'Inactive'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {editing === analyst.analyst_id ? (
                      <div className="flex items-center gap-2">
                        {ALL_SESSIONS.map(s => (
                          <button
                            key={s}
                            onClick={() => toggleSession(analyst.analyst_id, s, analyst.sessions ?? [])}
                            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                              currentSessions.includes(s)
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'border-border text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {(analyst.sessions ?? []).map(s => (
                          <span key={s} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{s}</span>
                        ))}
                        {(!analyst.sessions || analyst.sessions.length === 0) && (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {editing === analyst.analyst_id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleSave(analyst)}
                          disabled={saving === analyst.analyst_id}
                          className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          {saving === analyst.analyst_id ? 'Saving...' : 'Save'}
                        </button>
                        <button onClick={() => setEditing(null)}
                          className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setEditing(analyst.analyst_id)}
                        className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors">
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
