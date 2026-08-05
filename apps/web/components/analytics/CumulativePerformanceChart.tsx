'use client'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { CumulativePoint } from '@/lib/metrics'
import { formatDateShort } from '@/lib/format'

interface Props {
  data: CumulativePoint[]
}

// R is the only supported unit -- no NAV/equity baseline exists for "%" and no
// per-market pip-size metadata exists for "Pips" (see plan). Building toggles for
// either would either mislead or require data this app doesn't have.
export function CumulativePerformanceChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No triggered trades in the selected universe.
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Cumulative Performance (R)</p>
      <div className="h-64 print:h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} syncId="performance" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
              tickFormatter={formatDateShort} interval={Math.max(0, Math.floor(data.length / 10))} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v > 0 ? '+' : ''}${v}R`} width={44} />
            <Tooltip
              labelFormatter={(v: any) => formatDateShort(String(v))}
              formatter={(value: any) => [`${Number(value).toFixed(2)}R`, 'Cumulative R']}
              contentStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <Line type="monotone" dataKey="cumulativeR" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
