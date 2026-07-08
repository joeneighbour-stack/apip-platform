'use client'

import { useState } from 'react'

interface AppUser {
  app_user_id: string
  email: string
  display_name: string
  role: string
  analyst_id: string | null
  created_at: string
}

interface Analyst {
  analyst_id: string
  display_name: string
  active: boolean
}

const ROLES = ['ANALYST', 'MANAGER', 'EXECUTIVE', 'ADMIN', 'RESEARCH']

export function UserManagementPanel({ users, analysts, isAdmin }: {
  users: AppUser[]
  analysts: Analyst[]
  isAdmin: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [roleChanges, setRoleChanges] = useState<Record<string, string>>({})
  const [analystChanges, setAnalystChanges] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSave(user: AppUser) {
    setSaving(user.app_user_id)
    setMessage(null)
    const newRole = roleChanges[user.app_user_id] ?? user.role
    const newAnalystId = analystChanges[user.app_user_id] ?? user.analyst_id ?? ''

    try {
      const res = await fetch('/api/admin/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.app_user_id,
          role: newRole,
          analystId: newAnalystId || null,
        }),
      })
      const data = await res.json()
      setMessage(res.ok ? `Updated ${user.display_name}` : data.error ?? 'Failed')
      if (res.ok) setEditing(null)
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">User Management</h2>
        <span className="text-xs text-muted-foreground">{users.length} users</span>
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
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Email</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Role</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Linked Analyst</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map(user => (
              <tr key={user.app_user_id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium">{user.display_name}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{user.email}</td>
                <td className="px-4 py-2.5">
                  {editing === user.app_user_id ? (
                    <select
                      value={roleChanges[user.app_user_id] ?? user.role}
                      onChange={e => setRoleChanges(prev => ({ ...prev, [user.app_user_id]: e.target.value }))}
                      className="text-xs px-2 py-1 rounded border border-border bg-background"
                    >
                      {ROLES.map(r => <option key={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted">{user.role}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {editing === user.app_user_id ? (
                    <select
                      value={analystChanges[user.app_user_id] ?? user.analyst_id ?? ''}
                      onChange={e => setAnalystChanges(prev => ({ ...prev, [user.app_user_id]: e.target.value }))}
                      className="text-xs px-2 py-1 rounded border border-border bg-background"
                    >
                      <option value="">None</option>
                      {analysts.map(a => <option key={a.analyst_id} value={a.analyst_id}>{a.display_name}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {analysts.find(a => a.analyst_id === user.analyst_id)?.display_name ?? '—'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {editing === user.app_user_id ? (
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleSave(user)}
                        disabled={saving === user.app_user_id}
                        className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {saving === user.app_user_id ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditing(user.app_user_id)}
                      className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors"
                    >
                      Edit
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
