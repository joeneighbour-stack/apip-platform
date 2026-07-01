'use client'

import { useState } from 'react'
import { DisputeModal } from '@/components/analyst/DisputeModal'

interface Trade {
  trade_id: string
  direction: string
  entry: number
  result_r: number | null
  triggered: boolean
  published_at: string
  session: string | null
  historical_backfill: boolean
  market: { symbol: string } | null
}

interface Dispute {
  trade_id: string
  status: string
  dispute_type: string
}

interface TradeHistoryTableProps {
  trades: Trade[]
  disputesByTradeId: Map<string, Dispute>
  analystId: string
}

export function TradeHistoryTable({ trades, disputesByTradeId, analystId }: TradeHistoryTableProps) {
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)
  const [filterMarket, setFilterMarket] = useState('')
  const [filterDirection, setFilterDirection] = useState('')

  const markets = [...new Set(trades.map(t => t.market?.symbol).filter(Boolean))]

  const filtered = trades.filter(t => {
    if (filterMarket && t.market?.symbol !== filterMarket) return false
    if (filterDirection && t.direction !== filterDirection) return false
    return true
  })

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium">Trade History (last 90 days)</h2>
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
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Triggered</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Result R</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Source</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((trade) => {
                const dispute = disputesByTradeId.get(trade.trade_id)
                const date = new Date(trade.published_at).toLocaleDateString('en-GB', {
                  day: '2-digit', month: 'short'
                })

                return (
                  <tr key={trade.trade_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{date}</td>
                    <td className="px-4 py-2.5 font-medium">{trade.market?.symbol ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        trade.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {trade.direction}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{Number(trade.entry).toFixed(4)}</td>
                    <td className="px-4 py-2.5">
                      {trade.triggered
                        ? <span className="text-xs text-green-700">Yes</span>
                        : <span className="text-xs text-muted-foreground">No</span>}
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
                    <td className="px-4 py-2.5">
                      {dispute ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          dispute.status === 'RESOLVED' ? 'bg-green-50 text-green-700' :
                          dispute.status === 'REJECTED' ? 'bg-red-50 text-red-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {dispute.status}
                        </span>
                      ) : (
                        <button
                          onClick={() => setSelectedTrade(trade)}
                          className="text-xs px-2 py-1 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
                        >
                          Flag
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedTrade && (
        <DisputeModal
          trade={selectedTrade}
          analystId={analystId}
          onClose={() => setSelectedTrade(null)}
        />
      )}
    </section>
  )
}
