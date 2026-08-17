'use client'

import { Fragment, useState } from 'react'
import { DisputeModal } from '@/components/analyst/DisputeModal'

interface Trade {
  trade_id: string
  direction: string
  entry: number
  result_r: number | null
  triggered: boolean
  expiry: string | null
  published_at: string
  session: string | null
  historical_backfill: boolean
  market: { symbol: string } | null
  // Present when this table mixes trades from multiple analysts (management Monitor
  // tab's "All analysts" view) -- lets the per-row Flag button attribute a dispute to
  // the trade's own analyst instead of the table-level analystId prop below, which has
  // no single correct value once trades from different analysts share one table.
  analyst_id?: string
}

interface Dispute {
  trade_id: string
  status: string
  dispute_type: string
}

interface Review {
  review_id: string
  trade_id: string
  market: string
  session: string
  direction_alignment: string
  entry_alignment: string
  stop_alignment: string
  target_alignment: string
  alignment_score: number
  review_status: string
  analyst_facing_review: string
  created_at: string
  trade?: { result_r: number | null; triggered: boolean; analyst_id?: string }
}

interface TradeHistoryTableProps {
  trades: Trade[]
  disputesByTradeId: Map<string, Dispute>
  // Optional -- absent means no reviews are shown at all (the badge column reads "—"
  // for every row), distinct from an empty-but-present Map.
  reviewsByTradeId?: Map<string, Review>
  // The analyst whose trade history this is -- always the analyst themselves when
  // currentUserRole is ANALYST, or the analyst being viewed when a manager/admin is
  // looking at someone else's profile. Falls back to each trade's own analyst_id
  // (when present) for the Flag button, so a mixed-analyst table still attributes
  // disputes correctly -- see Trade.analyst_id's comment.
  analystId: string
  currentUserRole: 'ANALYST' | 'MANAGER' | 'ADMIN'
  currentUserDisplayName: string
}

function tradeStatus(trade: Trade): {
  label: string
  color: string
} {
  if (trade.triggered && trade.result_r !== null) {
    if (Number(trade.result_r) > 0) return { label: 'Profit', color: 'text-green-700' }
    if (Number(trade.result_r) < 0) return { label: 'Loss', color: 'text-red-600' }
    return { label: 'Breakeven', color: 'text-muted-foreground' }
  }
  if (trade.triggered && trade.result_r === null) {
    return { label: 'Open', color: 'text-blue-600' }
  }
  // Not triggered
  if (trade.expiry) {
    const expired = new Date(trade.expiry) < new Date()
    if (expired) return { label: 'Expired', color: 'text-muted-foreground' }
  }
  return { label: 'Pending', color: 'text-amber-600' }
}

export function TradeHistoryTable({
  trades, disputesByTradeId, reviewsByTradeId, analystId, currentUserRole, currentUserDisplayName,
}: TradeHistoryTableProps) {
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)
  const [filterMarket, setFilterMarket] = useState('')
  const [filterDirection, setFilterDirection] = useState('')
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null)

  const markets = [...new Set(trades.map(t => t.market?.symbol).filter(Boolean))]
  // Analysts can flag their own trades; managers/admins can flag on behalf of the
  // analyst whose profile they're viewing (see DisputeModal's raiseDispute() call).
  const canFlag = (['ANALYST', 'MANAGER', 'ADMIN'] as const).includes(currentUserRole)

  const filtered = trades.filter(t => {
    if (filterMarket && t.market?.symbol !== filterMarket) return false
    if (filterDirection && t.direction !== filterDirection) return false
    return true
  })

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium">Trade History</h2>
        <div className="flex items-center gap-2">
          <select
            value={filterMarket}
            onChange={e => setFilterMarket(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-md border border-border bg-background text-foreground"
          >
            <option value="">All markets</option>
            {markets.map(m => <option key={m} value={m!}>{m}</option>)}
          </select>
          <select
            value={filterDirection}
            onChange={e => setFilterDirection(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-md border border-border bg-background text-foreground"
          >
            <option value="">All directions</option>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border p-6">
          <p className="text-sm text-muted-foreground">
            {trades.length === 0
              ? 'No trade history available. Trades appear once imported from the performance data source.'
              : 'No trades match the current filters.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Market</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Dir</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Entry</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Result R</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Source</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Review</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((trade) => {
                const dispute = disputesByTradeId.get(trade.trade_id)
                const review = reviewsByTradeId?.get(trade.trade_id)
                const isExpanded = expandedTrade === trade.trade_id
                const date = new Date(trade.published_at).toLocaleDateString('en-GB', {
                  day: '2-digit', month: 'short'
                })

                return (
                  <Fragment key={trade.trade_id}>
                    <tr
                      onClick={() => review && setExpandedTrade(isExpanded ? null : trade.trade_id)}
                      className={`transition-colors ${review ? 'cursor-pointer hover:bg-muted/30' : 'hover:bg-muted/30'}`}
                    >
                      <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{date}</td>
                      <td className="px-4 py-2.5 font-medium">{trade.market?.symbol ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          trade.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {trade.direction}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                        {trade.entry != null ? Number(trade.entry).toFixed(4) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {(() => {
                          const s = tradeStatus(trade)
                          return <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
                        })()}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {trade.result_r !== null
                          ? <span className={Number(trade.result_r) >= 0 ? 'text-green-700' : 'text-red-700'}>
                              {Number(trade.result_r).toFixed(2)}R
                            </span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {trade.historical_backfill
                          ? <span className="text-xs text-muted-foreground">Historical</span>
                          : <span className="text-xs text-blue-600">Live</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {review ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            review.alignment_score === 4 ? 'bg-green-50 text-green-700' :
                            review.alignment_score >= 3 ? 'bg-blue-50 text-blue-700' :
                            review.alignment_score >= 2 ? 'bg-amber-50 text-amber-700' :
                            'bg-red-50 text-red-700'
                          }`}>
                            {review.alignment_score}/4
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {dispute ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            dispute.status === 'RESOLVED' ? 'bg-green-50 text-green-700' :
                            dispute.status === 'REJECTED' ? 'bg-red-50 text-red-700' :
                            'bg-amber-50 text-amber-700'
                          }`}>
                            {dispute.status}
                          </span>
                        ) : canFlag ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedTrade(trade) }}
                            className="text-xs px-2 py-1 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
                          >
                            Flag
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {isExpanded && review && (
                      <tr>
                        <td colSpan={9} className="px-4 py-3 bg-muted/20 border-t border-border">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {review.analyst_facing_review}
                          </p>
                          {review.alignment_score === 4 && (
                            <p className="text-xs text-green-700 mt-2 font-medium">
                              ✓ Full alignment — direction, entry, stop and target all within coaching range.
                            </p>
                          )}
                          {review.alignment_score <= 2 && (
                            <p className="text-xs text-amber-700 mt-2 font-medium">
                              Review your entry and risk placement against the coaching suggestion.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedTrade && (
        <DisputeModal
          trade={selectedTrade}
          analystId={selectedTrade.analyst_id ?? analystId}
          currentUserRole={currentUserRole}
          currentUserDisplayName={currentUserDisplayName}
          onClose={() => setSelectedTrade(null)}
        />
      )}
    </section>
  )
}
