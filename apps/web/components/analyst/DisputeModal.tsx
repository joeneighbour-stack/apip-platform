'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Trade {
  trade_id: string
  direction: string
  entry: number
  result_r: number | null
  triggered: boolean
  published_at: string
  market: { symbol: string } | null
}

interface DisputeModalProps {
  trade: Trade
  analystId: string
  onClose: () => void
}

const DISPUTE_TYPES = [
  { value: 'MISSED_TRIGGER', label: 'Missed trigger — trade should have triggered but wasn\'t captured' },
  { value: 'WRONG_ENTRY', label: 'Wrong entry — the entry price recorded is incorrect' },
  { value: 'WRONG_OUTCOME', label: 'Wrong outcome — the result or triggered status is incorrect' },
  { value: 'OTHER', label: 'Other — describe in the note below' },
]

export function DisputeModal({ trade, analystId, onClose }: DisputeModalProps) {
  const [disputeType, setDisputeType] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const supabase = createClient()

  async function handleSubmit() {
    if (!disputeType) { setError('Please select a dispute type.'); return }
    setSubmitting(true)
    setError(null)

    // Snapshot the relevant fields at time of dispute
    const originalValues = {
      entry: trade.entry,
      triggered: trade.triggered,
      result_r: trade.result_r,
      direction: trade.direction,
      published_at: trade.published_at,
    }

    const { error: insertError } = await (supabase.from('trade_disputes') as any)
      .insert({
        trade_id: trade.trade_id,
        raised_by_analyst_id: analystId,
        dispute_type: disputeType,
        analyst_note: note.trim() || null,
        original_values: originalValues,
        status: 'OPEN',
      })

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    setSubmitted(true)
    setSubmitting(false)
    setTimeout(onClose, 1500)
  }

  const date = new Date(trade.published_at).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md bg-card rounded-xl border border-border shadow-lg p-6 space-y-4 mx-4">
        {submitted ? (
          <div className="text-center py-4 space-y-2">
            <p className="font-medium text-green-700">Dispute raised successfully</p>
            <p className="text-sm text-muted-foreground">Your manager will review and respond.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">Flag a trade</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {trade.market?.symbol ?? '—'} · {trade.direction} · {date}
                </p>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
                ✕
              </button>
            </div>

            <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
              <p>Entry: <span className="font-medium tabular-nums">{Number(trade.entry).toFixed(4)}</span></p>
              <p>Triggered: <span className="font-medium">{trade.triggered ? 'Yes' : 'No'}</span></p>
              <p>Result R: <span className="font-medium">{trade.result_r !== null ? `${Number(trade.result_r).toFixed(2)}R` : '—'}</span></p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">What's the issue?</label>
              <div className="space-y-2">
                {DISPUTE_TYPES.map(dt => (
                  <label key={dt.value} className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="radio"
                      name="disputeType"
                      value={dt.value}
                      checked={disputeType === dt.value}
                      onChange={() => setDisputeType(dt.value)}
                      className="mt-0.5 shrink-0"
                    />
                    <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                      {dt.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Additional note <span className="text-muted-foreground font-normal">(optional)</span></label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                placeholder="Describe what you believe is incorrect and what the correct value should be..."
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-2 px-4 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !disputeType}
                className="flex-1 py-2 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Submitting…' : 'Raise dispute'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
