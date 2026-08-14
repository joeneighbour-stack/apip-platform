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

interface AnalystAlignment {
  analyst_id: string
  display_name: string
  total: number
  aligned: number
  different: number
  pctAligned: number | null
  alignedAvgR: number | null
  differentAvgR: number | null
  fullAlignment: number
  fullAlignmentPct: number | null
}

interface Props {
  trades: Trade[]
  disputesByTradeId: Map<string, Dispute>
  reviewsByTradeId: Map<string, Review>
  activeAnalysts: ActiveAnalyst[]
  alignmentByAnalyst: AnalystAlignment[]
  currentUserRole: 'MANAGER' | 'ADMIN'
  currentUserDisplayName: string
}

// Same trade log analysts see on their own Monitor page, unified across the whole
// team with an analyst filter on top. Each trade already carries its own analyst_id
// (see Trade.analyst_id), so TradeHistoryTable's Flag button attributes disputes
// correctly even in the unfiltered "All analysts" view where no single analystId
// prop could be correct.
export function ManagementMonitor({
  trades, disputesByTradeId, reviewsByTradeId, activeAnalysts, alignmentByAnalyst, currentUserRole, currentUserDisplayName,
}: Props) {
  const [selectedAnalyst, setSelectedAnalyst] = useState<string>('all')

  const filteredTrades = selectedAnalyst === 'all'
    ? trades
    : trades.filter(t => t.analyst_id === selectedAnalyst)

  const filteredAlignment = selectedAnalyst === 'all'
    ? alignmentByAnalyst
    : alignmentByAnalyst.filter(a => a.analyst_id === selectedAnalyst)

  const selectedAnalystName = selectedAnalyst === 'all'
    ? null
    : activeAnalysts.find(a => a.analyst_id === selectedAnalyst)?.display_name ?? null

  return (
    <div className="space-y-4">
      {filteredAlignment.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium">
              Coaching alignment
              {selectedAnalystName && <span className="text-muted-foreground font-normal"> — {selectedAnalystName}</span>}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Direction alignment and performance vs coaching recommendations
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Analyst</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Reviews</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Dir. aligned</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Full alignment</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Avg R (aligned)</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Avg R (diverged)</th>
              </tr>
            </thead>
            <tbody>
              {[...filteredAlignment]
                .sort((a, b) => (b.pctAligned ?? 0) - (a.pctAligned ?? 0))
                .map(a => (
                <tr key={a.analyst_id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium">{a.display_name}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">{a.total}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`font-medium ${
                      (a.pctAligned ?? 0) >= 60 ? 'text-green-700' :
                      (a.pctAligned ?? 0) >= 40 ? 'text-foreground' :
                      'text-amber-700'
                    }`}>
                      {a.pctAligned ?? '—'}%
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">
                      {a.aligned}/{a.total}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-medium">{a.fullAlignmentPct ?? '—'}%</span>
                    <span className="text-xs text-muted-foreground ml-1">{a.fullAlignment}/{a.total}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {a.alignedAvgR !== null ? (
                      <span className={a.alignedAvgR >= 0 ? 'text-green-700' : 'text-red-600'}>
                        {a.alignedAvgR >= 0 ? '+' : ''}{a.alignedAvgR.toFixed(2)}R
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {a.differentAvgR !== null ? (
                      <span className={a.differentAvgR >= 0 ? 'text-green-700' : 'text-red-600'}>
                        {a.differentAvgR >= 0 ? '+' : ''}{a.differentAvgR.toFixed(2)}R
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium">
          Team Trade Monitor
          {selectedAnalystName && <span className="text-muted-foreground font-normal"> — {selectedAnalystName}</span>}
        </h2>
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
