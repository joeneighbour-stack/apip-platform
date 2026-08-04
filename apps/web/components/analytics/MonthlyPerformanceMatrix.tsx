import type { MonthlyMatrixRow } from '@/lib/metrics'
import { formatR } from '@/lib/format'

interface Props {
  rows: MonthlyMatrixRow[]
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shade(value: number | null, maxAbs: number): { background: string; color: string } {
  if (value === null) return { background: 'transparent', color: 'inherit' }
  if (value === 0) return { background: 'hsl(var(--muted))', color: 'inherit' }
  const intensity = maxAbs > 0 ? Math.min(Math.abs(value) / maxAbs, 1) : 0
  const alpha = 0.12 + intensity * 0.38
  return value > 0
    ? { background: `rgba(34, 197, 94, ${alpha})`, color: '#15803d' }
    : { background: `rgba(239, 68, 68, ${alpha})`, color: '#b91c1c' }
}

export function MonthlyPerformanceMatrix({ rows }: Props) {
  if (rows.length === 0) return null
  const maxAbs = Math.max(0.01, ...rows.flatMap(r => r.months.map(m => m.totalR !== null ? Math.abs(m.totalR) : 0)))
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Monthly Performance (R)</p>
      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Year</th>
              {MONTH_LABELS.map(m => (
                <th key={m} className="text-right px-2 py-2 font-medium text-muted-foreground">{m}</th>
              ))}
              <th className="text-right px-3 py-2 font-medium text-muted-foreground border-l border-border">YTD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(row => (
              <tr key={row.year}>
                <td className="px-3 py-2 font-medium">{row.year}</td>
                {row.months.map((cell, i) => {
                  const s = shade(cell.totalR, maxAbs)
                  const tip = cell.trades > 0
                    ? `${cell.trades} trades${cell.winRate !== null ? `, ${Math.round(cell.winRate * 100)}% win rate` : ''}${cell.maxDD !== null ? `, ${formatR(cell.maxDD)} max DD` : ''}`
                    : undefined
                  return (
                    <td key={i} title={tip} className="text-right px-2 py-2 tabular-nums"
                      style={{ backgroundColor: s.background, color: s.color }}>
                      {cell.totalR !== null ? cell.totalR.toFixed(2) : ''}
                    </td>
                  )
                })}
                <td className="text-right px-3 py-2 tabular-nums font-semibold border-l border-border">
                  {row.ytd !== null ? formatR(row.ytd) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
