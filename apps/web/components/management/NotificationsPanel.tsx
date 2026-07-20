'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Notification {
  notification_id: string
  severity: string
  notification_type: string
  notification_status: string
  title: string
  message: string
  related_table: string | null
  related_id: string | null
  sla_due_at: string | null
  escalated_at: string | null
  created_at: string
}

interface NotificationsPanelProps {
  notifications: Notification[]
  showAll?: boolean // admins see all, managers see WARNING/CRITICAL only
}

const SEVERITY_STYLES: Record<string, string> = {
  INFO:           'bg-blue-50 border-blue-200 text-blue-800',
  WARNING:        'bg-amber-50 border-amber-200 text-amber-800',
  CRITICAL:       'bg-red-50 border-red-200 text-red-800',
  SYSTEM_FAILURE: 'bg-red-100 border-red-300 text-red-900',
}

const SEVERITY_DOT: Record<string, string> = {
  INFO:           'bg-blue-400',
  WARNING:        'bg-amber-400',
  CRITICAL:       'bg-red-500',
  SYSTEM_FAILURE: 'bg-red-700',
}

const STATUS_STYLES: Record<string, string> = {
  OPEN:         'bg-red-50 text-red-700',
  ACKNOWLEDGED: 'bg-amber-50 text-amber-700',
  RESOLVED:     'bg-green-50 text-green-700',
  DISMISSED:    'bg-muted text-muted-foreground',
}

function formatSlaStatus(sla_due_at: string | null): { label: string; overdue: boolean } {
  if (!sla_due_at) return { label: '', overdue: false }
  const due = new Date(sla_due_at)
  const now = new Date()
  const diffMins = Math.round((due.getTime() - now.getTime()) / 60000)
  if (diffMins < 0) return { label: `Overdue by ${Math.abs(diffMins)}m`, overdue: true }
  if (diffMins < 60) return { label: `SLA: ${diffMins}m remaining`, overdue: false }
  return { label: `SLA: ${Math.round(diffMins / 60)}h remaining`, overdue: false }
}

export function NotificationsPanel({ notifications, showAll = false }: NotificationsPanelProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<string>('OPEN')
  const [actioning, setActioning] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const filtered = notifications.filter(n => {
    if (filter === 'ALL') return true
    return n.notification_status === filter
  })

  const openCount = notifications.filter(n => n.notification_status === 'OPEN').length
  const criticalCount = notifications.filter(n => n.severity === 'CRITICAL' && n.notification_status === 'OPEN').length

  async function handleAction(notificationId: string, action: 'acknowledge' | 'resolve' | 'dismiss') {
    setActioning(notificationId)
    try {
      const res = await fetch('/api/notifications/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId, action }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessage(`Notification ${action}d`)
        router.refresh()
      } else {
        setMessage(data.error ?? 'Failed')
      }
    } finally {
      setActioning(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium">Notifications</h2>
          {criticalCount > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
              {criticalCount} critical
            </span>
          )}
          {openCount > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
              {openCount} open
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ALL'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2">
          <p className="text-xs text-blue-800">{message}</p>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {filter === 'OPEN' ? 'No open notifications.' : 'No notifications found.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(n => {
            const sla = formatSlaStatus(n.sla_due_at)
            const isActioning = actioning === n.notification_id
            return (
              <div key={n.notification_id} className={`rounded-lg border p-4 ${SEVERITY_STYLES[n.severity] ?? 'bg-card border-border'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${SEVERITY_DOT[n.severity] ?? 'bg-muted'}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold">{n.title}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[n.notification_status] ?? ''}`}>
                          {n.notification_status}
                        </span>
                        <span className="text-xs text-muted-foreground">{n.severity}</span>
                        {sla.label && (
                          <span suppressHydrationWarning className={`text-xs ${sla.overdue ? 'text-red-700 font-medium' : 'text-muted-foreground'}`}>
                            {sla.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-1 opacity-80">{n.message}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs opacity-60">
                          {new Date(n.created_at).toLocaleString('en-GB', {
                            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                        {n.related_table && (
                          <span className="text-xs opacity-60">{n.related_table}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {n.notification_status === 'OPEN' && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleAction(n.notification_id, 'acknowledge')}
                        disabled={isActioning}
                        className="text-xs px-2 py-1 rounded border border-current opacity-70 hover:opacity-100 transition-opacity disabled:opacity-40"
                      >
                        {isActioning ? '...' : 'Acknowledge'}
                      </button>
                      <button
                        onClick={() => handleAction(n.notification_id, 'resolve')}
                        disabled={isActioning}
                        className="text-xs px-2 py-1 rounded border border-current opacity-70 hover:opacity-100 transition-opacity disabled:opacity-40"
                      >
                        Resolve
                      </button>
                      <button
                        onClick={() => handleAction(n.notification_id, 'dismiss')}
                        disabled={isActioning}
                        className="text-xs px-2 py-1 rounded opacity-50 hover:opacity-80 transition-opacity disabled:opacity-40"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {n.notification_status === 'ACKNOWLEDGED' && (
                    <button
                      onClick={() => handleAction(n.notification_id, 'resolve')}
                      disabled={isActioning}
                      className="text-xs px-2 py-1 rounded border border-current opacity-70 hover:opacity-100 shrink-0 transition-opacity disabled:opacity-40"
                    >
                      {isActioning ? '...' : 'Resolve'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}


