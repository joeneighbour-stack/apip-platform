'use client'
import { ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine } from 'recharts'
import { chartDateLabel, parseGuidanceRange } from '@/lib/workspaceUtils'
import type { PriceBar, EventRiskItem } from './types'

const CHART_HEIGHT = 220

interface Props {
  data: PriceBar[]
  entryLow: number | null
  entryHigh: number | null
  riskRange: string | null
  targetRange: string | null
  currentPrice: number | null
  highImpactEvent: EventRiskItem | null
  displayPrecision: number | null
}

interface CandleDatum extends PriceBar {
  range: [number, number]
}

function CandleShape(props: any) {
  const { x, y, width, height, payload } = props
  const { open, high, low, close } = payload as PriceBar
  if (high === low || height <= 0) return <g />
  const isUp = close >= open
  const color = isUp ? '#16a34a' : '#dc2626'
  const scale = height / (high - low)
  const bodyTop = y + (high - Math.max(open, close)) * scale
  const bodyBottom = y + (high - Math.min(open, close)) * scale
  const bodyHeight = Math.max(bodyBottom - bodyTop, 1)
  const wickX = x + width / 2
  return (
    <g>
      <line x1={wickX} y1={y} x2={wickX} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={x} y={bodyTop} width={Math.max(width, 2)} height={bodyHeight} fill={color} />
    </g>
  )
}

function CandleTooltip({ active, payload, label, precision }: any) {
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

function eventTimeUk(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
}

// Section 3 -- compact trade context chart: candlesticks over the last 10 trading
// days, with the entry/stop/target zones and current price overlaid so the whole
// setup reads in one glance. No y-axis labels -- the overlays carry the price
// context, per spec.
export function TradeContextChart({
  data, entryLow, entryHigh, riskRange, targetRange, currentPrice, highImpactEvent, displayPrecision,
}: Props) {
  const precision = displayPrecision ?? 4

  if (data.length === 0) {
    return (
      <div style={{ height: CHART_HEIGHT }} className="flex items-center justify-center">
        <p className="text-xs text-muted-foreground">No price history available.</p>
      </div>
    )
  }

  const chartData: CandleDatum[] = data.map(d => ({ ...d, range: [d.low, d.high] }))
  const stopRange = parseGuidanceRange(riskRange)
  const targetRangeParsed = parseGuidanceRange(targetRange)

  const values = data.flatMap(d => [d.low, d.high])
  const candidates = [...values, entryLow, entryHigh, currentPrice, ...(stopRange ?? []), ...(targetRangeParsed ?? [])]
    .filter((v): v is number => v != null)
  const min = Math.min(...candidates)
  const max = Math.max(...candidates)
  const pad = (max - min) * 0.05 || 1
  const domain: [number, number] = [min - pad, max + pad]

  const lastDate = data[data.length - 1]!.date

  return (
    <div style={{ height: CHART_HEIGHT, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={chartDateLabel}
            tick={{ fontSize: 10 }}
            minTickGap={20}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickLine={false}
          />
          <YAxis domain={domain} hide />
          <Tooltip content={<CandleTooltip precision={precision} />} />

          {entryLow != null && entryHigh != null && (
            <ReferenceArea
              y1={entryLow} y2={entryHigh} fill="#16a34a" fillOpacity={0.15}
              stroke="#16a34a" strokeOpacity={0.5} strokeWidth={1}
              label={{ value: 'ENTRY', position: 'insideTopLeft', fontSize: 9, fill: '#16a34a', fontWeight: 600 }}
            />
          )}
          {stopRange && (
            <ReferenceArea
              y1={stopRange[0]} y2={stopRange[1]} fill="#dc2626" fillOpacity={0.08}
              stroke="#dc2626" strokeOpacity={0.4} strokeWidth={1}
              label={{ value: 'STOP', position: 'insideTopLeft', fontSize: 9, fill: '#dc2626', fontWeight: 600 }}
            />
          )}
          {targetRangeParsed && (
            <ReferenceArea
              y1={targetRangeParsed[0]} y2={targetRangeParsed[1]} fill="#2563eb" fillOpacity={0.08}
              stroke="#2563eb" strokeOpacity={0.4} strokeWidth={1}
              label={{ value: 'TARGET', position: 'insideTopLeft', fontSize: 9, fill: '#2563eb', fontWeight: 600 }}
            />
          )}
          {currentPrice != null && (
            <ReferenceLine
              y={currentPrice} stroke="currentColor" strokeDasharray="2 3" strokeWidth={1} className="text-foreground"
              label={{ value: currentPrice.toFixed(precision), position: 'right', fontSize: 9, fill: 'currentColor' }}
            />
          )}
          {highImpactEvent && (
            <ReferenceLine
              x={lastDate} stroke="#dc2626" strokeDasharray="3 3" strokeWidth={1}
              label={{
                value: `${eventTimeUk(highImpactEvent.eventTimeUk)} ${highImpactEvent.eventName} ⚠`,
                position: 'top', fontSize: 9, fill: '#dc2626',
              }}
            />
          )}

          <Bar dataKey="range" shape={CandleShape} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
