'use client'

import { useState } from 'react'

interface Dispute {
  dispute_id: string
  status: string
  dispute_type: string
  analyst_note: string | null
  original_values: any
  override_values: any
  created_at: string
  trade: {
    trade_id: string
    entry: number | null
    stop: number | null
    target: number | null
    triggered: boolean
    result_r: number | null
    published_at: string
    market: { symbol: string } | null
    direction: string
  }
  analyst: { display_name: string } | null
}

const DISPUTE_TYPE_LABELS: Record<string, string> = {
  MISSED_TRIGGER: 'Missed trigger',
  WRONG_ENTRY: 'Wrong entry',
  WRONG_OUTCOME: 'Wrong outcome',
  OTHER: 'Other',
}

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-800',
  UNDER_REVIEW: 'bg-blue-100 text-blue-800',
  RESOLVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
}

interface OverrideFields {
  triggered: boolean
  result_r: string
  exit_price: string
  admin_note: string
}

export function DisputeResolutionPanel({ disputes }: { disputes: Dispute[] }) {
  const [resolving, setResolving] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, OverrideFields>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function getOverride(disputeId: string, trade: Dispute['trade']): OverrideFields {
    return overrides[disputeId] ?? {
      triggered: trade.triggered,
      result_r: trade.result_r?.toString() ?? '',
      exit_price: '',
      admin_note: '',
    }
  }

  function updateOverride(disputeId: string, field: keyof OverrideFields, value: any) {
    setOverrides(prev => ({
      ...prev,
      [disputeId]: { ...getOverride(disputeId, disputes.find(d => d.dispute_id === disputeId)!.trade), [field]: value }
    }))
  }

  async function handleResolve(dispute: Dispute) {
    setSaving(dispute.dispute_id)
    setMessage(null)
    const o = getOverride(dispute.dispute_id, dispute.trade)

    try {
      const res = await fetch('/api/admin/disputes/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disputeId: dispute.dispute_id,
          tradeId: dispute.trade.trade_id,
          triggered: o.triggered,
          result_r: o.result_r ? Number(o.result_r) : null,
          exit_price: o.exit_price ? Number(o.exit_price) : null,
          admin_note: o.admin_note,
        }),
      })
      const data = await res.json()
      setMessage(res.ok
        ? `Resolved: ${dispute.trade.market?.symbol} override applied`
        : data.error ?? 'Failed')
      if (res.ok) setResolving(null)
    } finally {
      setSaving(null)
    }
  }

  async function handleReject(dispute: Dispute) {
    setSaving(dispute.dispute_id)
    setMessage(null)
    const o = getOverride(dispute.dispute_id, dispute.trade)
    try {
      const res = await fetch('/api/admin/disputes/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disputeId: dispute.dispute_id, admin_note: o.admin_note }),
      })
      const data = await res.json()
      setMessage(res.ok ? 'Dispute rejected' : data.error ?? 'Failed')
      if (res.ok) setResolving(null)
    } finally {
      setSaving(null)
    }
  }

  const open = disputes.filter(d => ['OPEN', 'UNDER_REVIEW'].includes(d.status))
  const resolved = disputes.filter(d => ['RESOLVED', 'REJECTED'].includes(d.status))

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Trade Disputes</h2>
        <div className="flex items-center gap-3">
          {open.length > 0 && (
            <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
              {open.length} open
            </span>
          )}
          <span className="text-xs text-muted-foreground">{disputes.length} total</span>
        </div>
      </div>

      {message && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2">
          <p className="text-xs text-blue-800">{message}</p>
        </div>
      )}

      {disputes.length === 0 && (
        <div className="rounded-lg border border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">No disputes raised yet.</p>
        </div>
      )}

      {/* Open disputes */}
      {open.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Requires action</p>
          {open.map(dispute => {
            const o = getOverride(dispute.dispute_id, dispute.trade)
            const isResolving = resolving === dispute.dispute_id
            const date = new Date(dispute.trade.published_at).toLocaleDateString('en-GB', {
              day: '2-digit', month: 'short', year: 'numeric'
            })

            return (
              <div key={dispute.dispute_id} className="rounded-lg border border-amber-200 bg-amber-50/30 p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{dispute.trade.market?.symbol ?? '—'}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        dispute.trade.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>{dispute.trade.direction}</span>
                      <span className="text-xs text-muted-foreground">{date}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[dispute.status]}`}>
                        {dispute.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {dispute.analyst?.display_name} · {DISPUTE_TYPE_LABELS[dispute.dispute_type] ?? dispute.dispute_type}
                    </p>
                    {dispute.analyst_note && (
                      <p className="text-xs text-foreground mt-1 italic">"{dispute.analyst_note}"</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <p>Entry: {dispute.trade.entry != null ? Number(dispute.trade.entry).toFixed(4) : '—'}</p>
                    <p>Stop: {dispute.trade.stop != null ? Number(dispute.trade.stop).toFixed(4) : '—'}</p>
                    <p>Target: {dispute.trade.target != null ? Number(dispute.trade.target).toFixed(4) : '—'}</p>
                    <p>Current R: {dispute.trade.result_r != null ? `${Number(dispute.trade.result_r).toFixed(2)}R` : '—'}</p>
                  </div>
                </div>

                {!isResolving ? (
                  <button
                    onClick={() => setResolving(dispute.dispute_id)}
                    className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Review & resolve
                  </button>
                ) : (
                  <div className="space-y-3 pt-2 border-t border-border">
                    <p className="text-xs font-medium">Apply override values</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Exit price</label>
                        <input
                          type="number"
                          step="any"
                          value={o.exit_price}
                          onChange={e => updateOverride(dispute.dispute_id, 'exit_price', e.target.value)}
                          placeholder="e.g. 62144.42"
                          className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Result R</label>
                        <input
                          type="number"
                          step="0.001"
                          value={o.result_r}
                          onChange={e => updateOverride(dispute.dispute_id, 'result_r', e.target.value)}
                          placeholder="e.g. 1.063"
                          className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Triggered</label>
                        <button
                          onClick={() => updateOverride(dispute.dispute_id, 'triggered', !o.triggered)}
                          className={`w-full text-xs py-1.5 rounded border transition-colors ${
                            o.triggered
                              ? 'bg-green-100 text-green-800 border-green-200'
                              : 'bg-muted text-muted-foreground border-border'
                          }`}
                        >
                          {o.triggered ? 'Yes — triggered' : 'No — not triggered'}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Admin note</label>
                      <input
                        type="text"
                        value={o.admin_note}
                        onChange={e => updateOverride(dispute.dispute_id, 'admin_note', e.target.value)}
                        placeholder="Reason for override..."
                        className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleResolve(dispute)}
                        disabled={saving === dispute.dispute_id}
                        className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {saving === dispute.dispute_id ? 'Applying...' : 'Apply override & resolve'}
                      </button>
                      <button
                        onClick={() => handleReject(dispute)}
                        disabled={saving === dispute.dispute_id}
                        className="text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => setResolving(null)}
                        className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Resolved disputes */}
      {resolved.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Resolved</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Trade</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Analyst</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Override R</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resolved.map(dispute => (
                  <tr key={dispute.dispute_id} className="hover:bg-muted/30">
                    <td className="px-4 py-2 text-xs">
                      {dispute.trade.market?.symbol} {dispute.trade.direction} {' '}
                      {new Date(dispute.trade.published_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{dispute.analyst?.display_name}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{DISPUTE_TYPE_LABELS[dispute.dispute_type]}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[dispute.status]}`}>
                        {dispute.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs tabular-nums">
                      {dispute.override_values?.result_r != null
                        ? `${Number(dispute.override_values.result_r).toFixed(2)}R`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
