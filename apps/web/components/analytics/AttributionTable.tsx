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
// Percentage widths, not px -- this component renders at two different container widths
// (full A4 width on the Attribution/Contribution report page, half A4 width side-by-side
// on the Best/Worst Performing Markets page), so a fixed px width would be generous at
// one and cramped at the other. table-layout: fixed makes the browser honour these
// exactly rather than shrinking columns to fit content, which is what let "Total R"
// values like "+116.30R" get clipped by the wrapping div's overflow-hidden in the first
// place -- an auto-layout table with enough columns can end up wider than its container.
// R-valued columns (Total R/Avg R/Max DD) are sized to fit the widest possible value,
// "+999.99R" (8 characters), with margin.
const COL_WIDTHS_WITH_MAX_DD = ['22%', '10%', '10%', '16%', '14%', '14%', '14%']
const COL_WIDTHS_NO_MAX_DD = ['26%', '12%', '12%', '18%', '16%', '16%']

export function AttributionTable({ title, rows, minTrades = 0, entityLabel = 'Rows', showMaxDD = true }: Props) {
  const visible = rows.filter(r => r.trades >= minTrades)
  const excludedCount = rows.length - visible.length
  const headers = showMaxDD
    ? ['', 'Trades', 'Win %', 'Total R', 'Avg R', 'Max DD', 'Profit Factor']
    : ['', 'Trades', 'Win %', 'Total R', 'Avg R', 'Profit Factor']
  const colWidths = showMaxDD ? COL_WIDTHS_WITH_MAX_DD : COL_WIDTHS_NO_MAX_DD
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">{title}</p>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">Insufficient data.</p>
      ) : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <thead className="bg-muted/50">
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((row, i) => (
                  <tr key={row.key} className={`hover:bg-muted/30 transition-colors ${i % 2 === 1 ? 'print:bg-black/[0.03]' : ''}`}>
                    <td className="px-4 py-2.5 font-medium truncate">{row.label}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.trades.toLocaleString()}</td>
                    <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatPercent(row.winRate)}</td>
                    <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${positivityClass(row.totalR)}`}>{formatR(row.totalR)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{formatR(row.avgR)}</td>
                    {showMaxDD && <td className="px-4 py-2.5 tabular-nums text-red-700 whitespace-nowrap">{formatR(row.maxDD)}</td>}
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.profitFactor !== null ? row.profitFactor.toFixed(2) : '—'}</td>
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
