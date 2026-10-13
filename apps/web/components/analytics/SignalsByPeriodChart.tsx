'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

interface Props {
  title: string
  data: { key: string; avgR: number | null }[]
}

// Shared by the All Signals tab's By Day of Week and By Month of Year charts (Fix 3/4) --
// both are the same shape (a short, fixed category axis + avg R), just a different
// category list, so one small bar chart covers both rather than two near-duplicates.
// Same green/red-by-sign Cell convention as ContributionChart.tsx.
export function SignalsByPeriodChart({ title, data }: Props) {
  if (data.length === 0) return null
  const chartData = data.map(d => ({ key: d.key, avgR: d.avgR ?? 0, hasData: d.avgR !== null }))

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">{title}</p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="key" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v > 0 ? '+' : ''}${v}R`} width={44} />
            <Tooltip
              formatter={(value: any, _name: any, item: any) => [item?.payload?.hasData ? `${Number(value).toFixed(2)}R` : 'No data', 'Avg R']}
              contentStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <Bar dataKey="avgR" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={!d.hasData ? 'hsl(var(--muted))' : d.avgR >= 0 ? '#22c55e' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
