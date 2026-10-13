'use client'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { CombinedCumulativePoint } from '@/lib/combinedSignalAnalytics'
import { formatDateShort } from '@/lib/format'

interface Props {
  data: CombinedCumulativePoint[]
}

// Three lines sharing one axis -- mergeCumulativeSeries() (lib/combinedSignalAnalytics.ts)
// forward-fills each series onto a shared date axis, so a series is simply absent
// (null, undrawn) before that signal type's first ever closed result, rather than
// plotted as a misleading flat zero.
const SERIES: { key: 'analyst' | 'patterns' | 'ai'; label: string; color: string }[] = [
  { key: 'analyst', label: 'Analyst Signals', color: '#3b82f6' },
  { key: 'patterns', label: 'Pattern Signals', color: '#f59e0b' },
  { key: 'ai', label: 'AI Signals', color: '#8b5cf6' },
]

export function CombinedCumulativeChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No signals in the selected universe.
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Cumulative Performance by Signal Type (R)</p>
      <div className="h-72 print:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
              tickFormatter={formatDateShort} interval={Math.max(0, Math.floor(data.length / 10))} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v > 0 ? '+' : ''}${v}R`} width={44} />
            <Tooltip
              labelFormatter={(v: any) => formatDateShort(String(v))}
              formatter={(value: any, name: any) => [value !== null && value !== undefined ? `${Number(value).toFixed(2)}R` : '—', name]}
              contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            {SERIES.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
