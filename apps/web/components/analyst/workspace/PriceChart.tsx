'use client'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine } from 'recharts'
import {
  chartDateLabel, zoneSemanticColour, zoneRangeFor, ZONE_COLOUR_HEX, ZONE_LADDER_ORDER,
  type ZoneBoundaries, type AtrZone,
} from '@/lib/workspaceUtils'
import type { PriceBar } from './types'

interface ZoneBand { zone: AtrZone; hex: string; y1: number; y2: number }

// Matches ZoneLadder.tsx's total height (4*52 + 2*20 + 20px axis spacer =
// 268) and its bottom spacer (20px) exactly, so the price-mapped plot area in
// both widgets occupies the same vertical span -- zero top/bottom chart
// margin plus a fixed (not auto) XAxis height means Recharts can't reserve a
// different amount of space than the ladder's spacer.
const CHART_HEIGHT = 268
const AXIS_HEIGHT = 20

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

  // The ladder's six zone bands, extended across the full chart width at the
  // same price boundaries and the same direction-aware colours, clamped to
  // the visible domain since Too High/Too Deep are unbounded on one side.
  // Zone 3 ("Fair Value") has no colour on either direction, so it renders
  // no band at all -- same as its plain bg-card treatment in the ladder.
  const zoneBands: ZoneBand[] = []
  if (zoneBoundaries) {
    for (const zone of ZONE_LADDER_ORDER) {
      const hex = ZONE_COLOUR_HEX[zoneSemanticColour(zone, direction)]
      if (!hex) continue
      const range = zoneRangeFor(zone, zoneBoundaries)
      const y1 = Math.max(range.min, domain[0])
      const y2 = Math.min(range.max, domain[1])
      if (!(y2 > y1)) continue
      zoneBands.push({ zone, hex, y1, y2 })
    }
  }

  return (
    <div style={{ height: CHART_HEIGHT, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={chartDateLabel}
            tick={{ fontSize: 10 }}
            minTickGap={24}
            height={AXIS_HEIGHT}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickLine={false}
          />
          {/* The ladder is the y-axis now -- this stays only to pin the chart's
              price scale to the shared domain (so zone bands/entry/stop/target
              line up with the ladder); hide suppresses all its visual chrome
              (ticks, labels, line) and width=0 stops it reserving any space,
              closing the horizontal gap a visible axis used to leave between
              the ladder and the plot area. */}
          <YAxis domain={domain} hide width={0} />
          <Tooltip content={<CustomTooltip precision={precision} />} />
          {zoneBands.map(b => (
            <ReferenceArea key={b.zone} y1={b.y1} y2={b.y2} fill={b.hex} fillOpacity={0.06} strokeOpacity={0} />
          ))}
          {entryLow != null && entryHigh != null && (
            <ReferenceArea
              y1={entryLow} y2={entryHigh} fill="#16a34a" fillOpacity={0.15}
              stroke="#16a34a" strokeOpacity={0.6} strokeWidth={1} strokeDasharray="3 2"
              label={{ value: 'Entry zone', position: 'insideTopRight', fontSize: 9, fill: '#16a34a' }}
            />
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
