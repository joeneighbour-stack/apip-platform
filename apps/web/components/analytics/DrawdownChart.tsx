'use client'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { DrawdownPoint } from '@/lib/metrics'
import { formatDateShort } from '@/lib/format'

interface Props {
  data: DrawdownPoint[]
}

// Shares syncId with CumulativePerformanceChart so hovering either chart shows the
// same date's crosshair/tooltip on both -- the requested "shared horizontal axis"
// effect. Both series are derived from the same sorted trade list, so they align by
// index.
export function DrawdownChart({ data }: Props) {
  if (data.length === 0) return null
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Drawdown (R)</p>
      <div className="h-32 print:h-28">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} syncId="performance" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
              tickFormatter={formatDateShort} interval={Math.max(0, Math.floor(data.length / 10))} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v}R`} width={44} />
            <Tooltip
              labelFormatter={(v: any) => formatDateShort(String(v))}
              formatter={(value: any) => [`${Number(value).toFixed(2)}R`, 'Drawdown']}
              contentStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <Area type="monotone" dataKey="drawdown" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
