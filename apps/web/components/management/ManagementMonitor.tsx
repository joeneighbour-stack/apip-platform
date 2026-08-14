'use client'

import { useState } from 'react'
import { TradeHistoryTable } from '@/components/analyst/TradeHistoryTable'

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
  analyst_id: string
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

interface ActiveAnalyst {
  analyst_id: string
  display_name: string
}

interface Props {
  trades: Trade[]
  disputesByTradeId: Map<string, Dispute>
  reviewsByTradeId: Map<string, Review>
  activeAnalysts: ActiveAnalyst[]
  currentUserRole: 'MANAGER' | 'ADMIN'
  currentUserDisplayName: string
}

// Same trade log analysts see on their own Monitor page, unified across the whole
// team with an analyst filter on top. Each trade already carries its own analyst_id
// (see Trade.analyst_id), so TradeHistoryTable's Flag button attributes disputes
// correctly even in the unfiltered "All analysts" view where no single analystId
// prop could be correct.
export function ManagementMonitor({
  trades, disputesByTradeId, reviewsByTradeId, activeAnalysts, currentUserRole, currentUserDisplayName,
}: Props) {
  const [selectedAnalyst, setSelectedAnalyst] = useState<string>('all')

  const filteredTrades = selectedAnalyst === 'all'
    ? trades
    : trades.filter(t => t.analyst_id === selectedAnalyst)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium">Team Trade Monitor</h2>
        <select
          value={selectedAnalyst}
          onChange={e => setSelectedAnalyst(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md border border-border bg-background"
        >
          <option value="all">All analysts</option>
          {activeAnalysts.map(a => (
            <option key={a.analyst_id} value={a.analyst_id}>{a.display_name}</option>
          ))}
        </select>
      </div>
      <TradeHistoryTable
        trades={filteredTrades}
        disputesByTradeId={disputesByTradeId}
        reviewsByTradeId={reviewsByTradeId}
        analystId=""
        currentUserRole={currentUserRole}
        currentUserDisplayName={currentUserDisplayName}
      />
    </div>
  )
}
