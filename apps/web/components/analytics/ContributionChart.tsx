'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { AttributionRow } from '@/lib/metrics'

interface Props {
  title: string
  rows: AttributionRow[]
  topN?: number
  bottomN?: number
}

// Large universes (dozens of markets) aren't dumped onto one chart -- truncate to top
// contributors / bottom detractors and say so; full detail belongs in AttributionTable.
export function ContributionChart({ title, rows, topN = 10, bottomN = 5 }: Props) {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b.totalR - a.totalR)
  const truncated = sorted.length > topN + bottomN
  const display = truncated ? [...sorted.slice(0, topN), ...sorted.slice(-bottomN)] : sorted
  const data = display.map(r => ({ label: r.label, totalR: r.totalR }))
  const height = Math.max(160, data.length * 26)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">
        {title}{truncated ? ` — Top ${topN} Contributors / Bottom ${bottomN} Detractors` : ''}
      </p>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v > 0 ? '+' : ''}${v}R`} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
            <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}R`, 'Contribution']} contentStyle={{ fontSize: 11 }} />
            <Bar dataKey="totalR" radius={[0, 2, 2, 0]} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.totalR >= 0 ? '#22c55e' : '#ef4444'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
