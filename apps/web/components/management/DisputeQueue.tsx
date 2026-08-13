'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { resolveDispute, rejectDispute } from '@/app/actions/disputes'

interface Trade {
  direction: string
  entry: number | null
  result_r: number | null
  triggered: boolean
  published_at: string
  market_id: string
  market: { symbol: string } | null
}

interface Dispute {
  dispute_id: string
  dispute_type: string
  analyst_note: string | null
  status: string
  created_at: string
  raised_by_analyst_id: string
  trade: Trade | null
  analyst: { display_name: string } | null
}

interface DisputeQueueProps {
  disputes: Dispute[]
}

const TYPE_LABELS: Record<string, string> = {
  MISSED_TRIGGER: 'Missed trigger',
  WRONG_ENTRY: 'Wrong entry',
  WRONG_OUTCOME: 'Wrong outcome',
  OTHER: 'Other',
}

function DisputeRow({ dispute, onResolved }: { dispute: Dispute; onResolved: (disputeId: string) => void }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [resultR, setResultR] = useState(dispute.trade?.result_r?.toString() ?? '')
  const [triggered, setTriggered] = useState(dispute.trade?.triggered ?? false)
  const [adminNote, setAdminNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trade = dispute.trade
  const date = new Date(dispute.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  const tradeDate = trade ? new Date(trade.published_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null

  async function handleResolve() {
    if (!adminNote.trim()) { setError('Admin note is required for resolution'); return }
    setSubmitting(true)
    setError(null)
    const overrides: { result_r?: number; triggered?: boolean } = { triggered }
    if (resultR.trim() !== '') overrides.result_r = Number(resultR)
    const result = await resolveDispute(dispute.dispute_id, adminNote, overrides)
    if (!result.success) { setError(result.error ?? 'Failed to resolve'); setSubmitting(false); return }
    onResolved(dispute.dispute_id)
    router.refresh()
  }

  async function handleReject() {
    if (!adminNote.trim()) { setError('Admin note is required for rejection'); return }
    setSubmitting(true)
    setError(null)
    const result = await rejectDispute(dispute.dispute_id, adminNote)
    if (!result.success) { setError(result.error ?? 'Failed to reject'); setSubmitting(false); return }
    onResolved(dispute.dispute_id)
    router.refresh()
  }

  const prefillHref = trade ? `/dashboard/admin?prefill=${encodeURIComponent(JSON.stringify({
    analystId: dispute.raised_by_analyst_id,
    marketId: trade.market_id,
    direction: trade.direction,
    date: trade.published_at.slice(0, 10),
  }))}` : null

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="font-medium text-sm">{dispute.analyst?.display_name ?? 'Unknown'}</span>
          {trade?.market?.symbol && <span className="text-sm text-muted-foreground">{trade.market.symbol}</span>}
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
            {TYPE_LABELS[dispute.dispute_type] ?? dispute.dispute_type}
          </span>
          <span className="text-xs text-muted-foreground">{date}</span>
        </div>
        <span className="text-xs text-muted-foreground">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {trade && (
            <div className="rounded-md bg-muted/50 p-3 text-xs grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><p className="text-muted-foreground">Direction</p><p className="font-medium">{trade.direction}</p></div>
              <div><p className="text-muted-foreground">Trade date</p><p className="font-medium">{tradeDate}</p></div>
              <div><p className="text-muted-foreground">Current result R</p><p className="font-medium">{trade.result_r != null ? `${Number(trade.result_r).toFixed(2)}R` : '—'}</p></div>
              <div><p className="text-muted-foreground">Current triggered</p><p className="font-medium">{trade.triggered ? 'Yes' : 'No'}</p></div>
            </div>
          )}

          {dispute.analyst_note && (
            <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
              <p className="text-xs text-blue-800">
                <span className="font-medium">Analyst note: </span>{dispute.analyst_note}
              </p>
            </div>
          )}

          {dispute.dispute_type === 'MISSED_TRIGGER' && prefillHref && (
            <a href={prefillHref} className="text-xs text-primary hover:underline inline-block">
              Add manual trade entry &rarr;
            </a>
          )}

          <div className="space-y-2 pt-1 border-t border-border">
            <p className="text-xs font-medium">Apply override (optional) &amp; resolve</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Corrected result R</label>
                <input
                  type="number"
                  step="0.001"
                  value={resultR}
                  onChange={e => setResultR(e.target.value)}
                  placeholder="e.g. 1.063"
                  className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Triggered</label>
                <button
                  type="button"
                  onClick={() => setTriggered(v => !v)}
                  className={`w-full text-xs py-1.5 rounded border transition-colors ${
                    triggered
                      ? 'bg-green-100 text-green-800 border-green-200'
                      : 'bg-muted text-muted-foreground border-border'
                  }`}
                >
                  {triggered ? 'Yes — triggered' : 'No — not triggered'}
                </button>
              </div>
            </div>
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
                {submitting ? 'Saving...' : 'Apply override & resolve'}
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
        </div>
      )}
    </div>
  )
}

export function DisputeQueue({ disputes: initialDisputes }: DisputeQueueProps) {
  const [disputes, setDisputes] = useState(initialDisputes)

  function handleResolved(disputeId: string) {
    setDisputes(prev => prev.filter(d => d.dispute_id !== disputeId))
  }

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
            <DisputeRow key={d.dispute_id} dispute={d} onResolved={handleResolved} />
          ))}
        </div>
      )}
    </section>
  )
}
