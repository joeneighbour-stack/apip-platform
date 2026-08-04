import type { AttributionRow } from '@/lib/metrics'
import { formatR, formatPercent, positivityClass } from '@/lib/format'

interface Props {
  title: string
  rows: AttributionRow[]
  minTrades?: number
}

// Fully generic over the grouping dimension -- the caller decides what dimension() to
// pass to attributionBy() when building `rows`. This component has no analyst-specific
// logic at all; the anonymisation boundary lives at the call site (internal pages may
// pass an analyst-keyed dimension, the report builder's dimension picker never offers
// one).
export function AttributionTable({ title, rows, minTrades = 0 }: Props) {
  const visible = rows.filter(r => r.trades >= minTrades)
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">Insufficient data.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['', 'Trades', 'Win %', 'Total R', 'Avg R', 'Max DD', 'Profit Factor'].map((h, i) => (
                  <th key={i} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map(row => (
                <tr key={row.key} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 font-medium">{row.label}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.trades.toLocaleString()}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatPercent(row.winRate)}</td>
                  <td className={`px-4 py-2.5 tabular-nums font-medium ${positivityClass(row.totalR)}`}>{formatR(row.totalR)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{formatR(row.avgR)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-red-700">{formatR(row.maxDD)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.profitFactor !== null ? row.profitFactor.toFixed(2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
