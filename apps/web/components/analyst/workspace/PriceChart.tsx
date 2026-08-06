'use client'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine } from 'recharts'
import { chartDateLabel, type ZoneBoundaries } from '@/lib/workspaceUtils'
import type { PriceBar } from './types'

interface Props {
  data: PriceBar[]
  direction: 'BUY' | 'SELL' | null
  zoneBoundaries: ZoneBoundaries | null
  yDomain: [number, number] | null
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

export function PriceChart({ data, direction, zoneBoundaries, yDomain, entryLow, entryHigh, stopMid, targetMid, displayPrecision }: Props) {
  const precision = displayPrecision ?? 4

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No price history available.</p>
  }

  const lastClose = data[data.length - 1]?.close ?? null

  // yDomain is computed once (shared with the ladder, so the two visually
  // line up) from the same zone boundaries; fall back to an auto-scale around
  // close/entry/stop/target when there isn't enough recent history to
  // establish a zone range at all.
  let domain: [number, number]
  if (yDomain) {
    domain = yDomain
  } else {
    const values = data.map(d => d.close)
    const candidates = [...values, entryLow, entryHigh, stopMid, targetMid].filter((v): v is number => v != null)
    const min = Math.min(...candidates)
    const max = Math.max(...candidates)
    const pad = (max - min) * 0.05 || Math.abs(max) * 0.01 || 1
    domain = [min - pad, max + pad]
  }

  // BUY: cheap zones (1-2) are the opportunity (green), stretched (4) is the
  // danger (red). SELL inverts which end is shaded which colour.
  const opportunityArea = zoneBoundaries && direction === 'BUY'
    ? { y1: zoneBoundaries.zone1.min, y2: zoneBoundaries.zone2.max }
    : zoneBoundaries && direction === 'SELL'
    ? { y1: zoneBoundaries.zone4.min, y2: zoneBoundaries.tooHigh.min }
    : null
  const dangerArea = zoneBoundaries && direction === 'BUY'
    ? { y1: zoneBoundaries.zone4.min, y2: zoneBoundaries.tooHigh.min }
    : zoneBoundaries && direction === 'SELL'
    ? { y1: zoneBoundaries.zone1.min, y2: zoneBoundaries.zone2.max }
    : null

  return (
    <div style={{ height: 220, width: '100%' }}>
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
            domain={domain}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => v.toFixed(precision)}
            width={precision > 2 ? 60 : 44}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip precision={precision} />} />
          {opportunityArea && (
            <ReferenceArea y1={opportunityArea.y1} y2={opportunityArea.y2} fill="#22c55e" fillOpacity={0.08} strokeOpacity={0} />
          )}
          {dangerArea && (
            <ReferenceArea y1={dangerArea.y1} y2={dangerArea.y2} fill="#ef4444" fillOpacity={0.08} strokeOpacity={0} />
          )}
          {entryLow != null && entryHigh != null && (
            <ReferenceArea y1={entryLow} y2={entryHigh} fill="#16a34a" fillOpacity={0.18} strokeOpacity={0} />
          )}
          {stopMid != null && (
            <ReferenceLine y={stopMid} stroke="#dc2626" strokeDasharray="4 3" strokeWidth={1} />
          )}
          {targetMid != null && (
            <ReferenceLine y={targetMid} stroke="#2563eb" strokeDasharray="4 3" strokeWidth={1} />
          )}
          {lastClose != null && (
            <ReferenceLine
              y={lastClose}
              stroke="#9ca3af"
              strokeDasharray="2 3"
              strokeWidth={1}
              label={{ value: `Close ${lastClose.toFixed(precision)}`, position: 'insideBottomRight', fontSize: 9, fill: '#9ca3af' }}
            />
          )}
          <Line type="monotone" dataKey="close" stroke="currentColor" strokeWidth={1.5} dot={false} className="text-foreground" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
