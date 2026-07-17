'use client'
import { useState } from 'react'

interface Trade {
  trade_id: string
  direction: string
  entry: number
  stop: number | null
  target: number | null
  triggered: boolean
  result_r: number | null
  published_at: string
  analyst: { display_name: string } | null
  market: { symbol: string } | null
  recommended_dir: string | null
}

interface Props {
  trades: Trade[]
}

export function LiveTradesPanel({ trades }: Props) {
  const [filter, setFilter] = useState<'ALL' | 'TRIGGERED' | 'OPEN' | 'MISALIGNED'>('ALL')

  const filtered = trades.filter(t => {
    if (filter === 'TRIGGERED') return t.triggered
    if (filter === 'OPEN') return !t.triggered && t.result_r === null
    if (filter === 'MISALIGNED') return t.recommended_dir && t.direction !== t.recommended_dir
    return true
  })

  const triggered = trades.filter(t => t.triggered).length
  const misaligned = trades.filter(t => t.recommended_dir && t.direction !== t.recommended_dir).length
  const withResult = trades.filter(t => t.result_r !== null).length

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Today&apos;s Analyst Trades</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {trades.length} trades &bull; {triggered} triggered &bull; {withResult} closed &bull;
            {misaligned > 0 && <span className="text-amber-600 ml-1">{misaligned} direction misaligned</span>}
          </p>
        </div>
        <div className="flex gap-1">
          {(['ALL', 'TRIGGERED', 'OPEN', 'MISALIGNED'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-2 py-1 rounded ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
              {f === 'ALL' ? `All (${trades.length})` :
               f === 'TRIGGERED' ? `Triggered (${triggered})` :
               f === 'OPEN' ? `Open (${trades.length - triggered})` :
               `Misaligned (${misaligned})`}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Analyst</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Market</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Dir</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Rec</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Align</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Entry</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Result</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-muted-foreground">No trades match this filter</td></tr>
            )}
            {filtered.map(trade => {
              const aligned = !trade.recommended_dir || trade.direction === trade.recommended_dir
              const time = new Date(trade.published_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
              return (
                <tr key={trade.trade_id} className={`hover:bg-muted/30 transition-colors ${!aligned ? 'bg-amber-50/30' : ''}`}>
                  <td className="px-3 py-2 text-xs font-medium">{trade.analyst?.display_name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{trade.market?.symbol ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${trade.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {trade.direction}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {trade.recommended_dir ? (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${trade.recommended_dir === 'BUY' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {trade.recommended_dir}
                      </span>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {!trade.recommended_dir
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : aligned
                        ? <span className="text-xs text-green-700 font-medium">✓</span>
                        : <span className="text-xs text-amber-600 font-medium">✗</span>}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">{Number(trade.entry).toFixed(4)}</td>
                  <td className="px-3 py-2">
                    {trade.result_r !== null
                      ? <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${Number(trade.result_r) >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>Closed</span>
                      : trade.triggered
                        ? <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">Triggered</span>
                        : <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Open</span>}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    {trade.result_r !== null
                      ? <span className={Number(trade.result_r) >= 0 ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                          {Number(trade.result_r) > 0 ? '+' : ''}{Number(trade.result_r).toFixed(2)}R
                        </span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{time}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
