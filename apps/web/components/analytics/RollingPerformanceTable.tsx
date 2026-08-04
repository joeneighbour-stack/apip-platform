import type { RollingRow } from '@/lib/metrics'
import { formatR, formatPercent, positivityClass } from '@/lib/format'

interface Props {
  rows: RollingRow[]
}

export function RollingPerformanceTable({ rows }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Rolling Performance</p>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {['Period', 'Total R', 'Avg R / Trade', 'Win Rate', 'Max DD', 'Trades'].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(row => (
              <tr key={row.label} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">{row.label}</td>
                {row.insufficientData ? (
                  <td colSpan={5} className="px-4 py-2.5 text-xs text-muted-foreground">Insufficient data</td>
                ) : row.trades === 0 ? (
                  <td colSpan={5} className="px-4 py-2.5 text-xs text-muted-foreground">No triggered trades</td>
                ) : (
                  <>
                    <td className={`px-4 py-2.5 tabular-nums font-medium ${positivityClass(row.totalR)}`}>{formatR(row.totalR)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{formatR(row.avgR)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{formatPercent(row.winRate)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-red-700">{formatR(row.maxDD)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.trades.toLocaleString()}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
