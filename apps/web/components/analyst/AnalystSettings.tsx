'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function AnalystSettings({ email }: { email: string }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setMessage({ text: 'Passwords do not match', ok: false })
      return
    }
    if (password.length < 8) {
      setMessage({ text: 'Password must be at least 8 characters', ok: false })
      return
    }
    setLoading(true)
    setMessage(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setMessage({ text: error.message, ok: false })
    else {
      setMessage({ text: 'Password updated successfully', ok: true })
      setPassword('')
      setConfirm('')
    }
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4 space-y-1">
        <p className="text-xs text-muted-foreground">Logged in as</p>
        <p className="text-sm font-medium">{email}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Change Password</h2>
        <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-4 space-y-3">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="New password (min 8 characters)"
            required
            className="w-full text-sm px-3 py-2 rounded-md border border-border bg-background"
          />
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            required
            className="w-full text-sm px-3 py-2 rounded-md border border-border bg-background"
          />
          {message && (
            <p className={`text-xs ${message.ok ? 'text-green-600' : 'text-red-600'}`}>
              {message.text}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || !password || !confirm}
            className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Updating...' : 'Update password'}
          </button>
        </form>
      </section>
    </div>
  )
}
