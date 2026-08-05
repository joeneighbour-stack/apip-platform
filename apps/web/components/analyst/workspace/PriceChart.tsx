'use client'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine } from 'recharts'
import { chartDateLabel } from '@/lib/workspaceUtils'
import type { PriceBar } from './types'

interface Props {
  data: PriceBar[]
  entryLow: number | null
  entryHigh: number | null
  stopMid: number | null
  targetMid: number | null
  displayPrecision: number | null
}

function CustomTooltip({ active, payload, label, precision }: any) {
  if (!active || !payload?.length) return null
  const bar: PriceBar = payload[0].payload
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] tabular-nums shadow-sm">
      <p className="font-medium text-foreground">{chartDateLabel(label)}</p>
      <p className="text-muted-foreground">
        O <span className="text-foreground">{bar.open.toFixed(precision)}</span>{'  '}
        H <span className="text-foreground">{bar.high.toFixed(precision)}</span>{'  '}
        L <span className="text-foreground">{bar.low.toFixed(precision)}</span>{'  '}
        C <span className="text-foreground">{bar.close.toFixed(precision)}</span>
      </p>
    </div>
  )
}

export function PriceChart({ data, entryLow, entryHigh, stopMid, targetMid, displayPrecision }: Props) {
  const precision = displayPrecision ?? 4

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No price history available.</p>
  }

  const values = data.map(d => d.close)
  const candidates = [...values, entryLow, entryHigh, stopMid, targetMid].filter((v): v is number => v != null)
  const min = Math.min(...candidates)
  const max = Math.max(...candidates)
  const pad = (max - min) * 0.05 || Math.abs(max) * 0.01 || 1

  return (
    <div style={{ height: 160, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={chartDateLabel}
            tick={{ fontSize: 10 }}
            minTickGap={24}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickLine={false}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => v.toFixed(precision)}
            width={precision > 2 ? 60 : 44}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip precision={precision} />} />
          {entryLow != null && entryHigh != null && (
            <ReferenceArea y1={entryLow} y2={entryHigh} fill="#16a34a" fillOpacity={0.12} strokeOpacity={0} />
          )}
          {stopMid != null && (
            <ReferenceLine y={stopMid} stroke="#dc2626" strokeDasharray="4 3" strokeWidth={1} />
          )}
          {targetMid != null && (
            <ReferenceLine y={targetMid} stroke="#2563eb" strokeDasharray="4 3" strokeWidth={1} />
          )}
          <Line type="monotone" dataKey="close" stroke="currentColor" strokeWidth={1.5} dot={false} className="text-foreground" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
