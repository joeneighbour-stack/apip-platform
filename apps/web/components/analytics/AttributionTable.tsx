import type { AttributionRow } from '@/lib/metrics'
import { formatR, formatPercent, positivityClass } from '@/lib/format'

interface Props {
  title: string
  rows: AttributionRow[]
  minTrades?: number
  // Noun used in the "excluded" note beneath the table when minTrades filters rows out,
  // e.g. "Markets" -> "Markets with fewer than 10 triggered trades excluded."
  entityLabel?: string
  // Off for ranked best/worst lists, where the rows are already a pre-filtered,
  // pre-capped top/bottom N (Max DD isn't part of what's being ranked there).
  showMaxDD?: boolean
}

// Fully generic over the grouping dimension -- the caller decides what dimension() to
// pass to attributionBy() when building `rows`. This component has no analyst-specific
// logic at all; the anonymisation boundary lives at the call site (internal pages may
// pass an analyst-keyed dimension, the report builder's dimension picker never offers
// one).
export function AttributionTable({ title, rows, minTrades = 0, entityLabel = 'Rows', showMaxDD = true }: Props) {
  const visible = rows.filter(r => r.trades >= minTrades)
  const excludedCount = rows.length - visible.length
  const headers = showMaxDD
    ? ['', 'Trades', 'Win %', 'Total R', 'Avg R', 'Max DD', 'Profit Factor']
    : ['', 'Trades', 'Win %', 'Total R', 'Avg R', 'Profit Factor']
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">Insufficient data.</p>
      ) : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {headers.map((h, i) => (
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
                    {showMaxDD && <td className="px-4 py-2.5 tabular-nums text-red-700">{formatR(row.maxDD)}</td>}
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.profitFactor !== null ? row.profitFactor.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {minTrades > 0 && excludedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {entityLabel} with fewer than {minTrades} triggered trades excluded.
            </p>
          )}
        </>
      )}
    </div>
  )
}
