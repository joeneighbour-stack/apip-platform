'use client'
import { ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine, Customized } from 'recharts'
import { chartDateLabel, parseGuidanceRange } from '@/lib/workspaceUtils'
import type { PriceBar, EventRiskItem } from './types'

const CHART_HEIGHT = 140
const X_AXIS_HEIGHT = 16
const CHART_MARGIN = { top: 6, right: 8, bottom: 2, left: 4 }
const MIN_LABEL_GAP_PX = 11

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

interface ZoneLabelSpec {
  key: string
  anchor: number // the price value each label is anchored to (top edge of its zone)
  text: string
  color: string
}

// Renders ENTRY/STOP/TARGET labels itself, via Recharts' own y-scale (from
// yAxisMap), instead of ReferenceArea's built-in `label` prop -- that prop has no
// awareness of sibling labels, so when two zones sit close together (common once
// the domain is correctly auto-fit around real price levels) their labels can land
// right on top of each other. This sorts by actual pixel position and enforces a
// minimum gap, working off the real scale so it's correct for any asset class/
// price magnitude, not a hardcoded pixel offset per zone.
function ZoneLabels(props: any) {
  const { yAxisMap, offset, specs } = props as { yAxisMap: any; offset: any; specs: ZoneLabelSpec[] }
  const scale = yAxisMap?.[Object.keys(yAxisMap)[0]]?.scale
  if (!scale || !offset) return null

  const positioned = specs
    .map(s => ({ ...s, y: scale(s.anchor) }))
    .filter(s => Number.isFinite(s.y))
    .sort((a, b) => a.y - b.y)

  for (let i = 1; i < positioned.length; i++) {
    const prev = positioned[i - 1]!
    const cur = positioned[i]!
    if (cur.y - prev.y < MIN_LABEL_GAP_PX) cur.y = prev.y + MIN_LABEL_GAP_PX
  }
  // Keep the last label from being pushed below the plot area.
  const maxY = offset.top + offset.height - 2
  if (positioned.length > 0 && positioned[positioned.length - 1]!.y > maxY) {
    const overshoot = positioned[positioned.length - 1]!.y - maxY
    for (const p of positioned) p.y -= overshoot
  }

  return (
    <g>
      {positioned.map(p => (
        <text key={p.key} x={offset.left + 3} y={Math.max(p.y, offset.top + 8)} fontSize={9} fontWeight={600} fill={p.color}>
          {p.text}
        </text>
      ))}
    </g>
  )
}

// Compact trade context chart: candlesticks over the last 10 trading days, with
// the entry/stop/target zones and current price overlaid. No y-axis tick labels --
// the overlays carry the price context. Y-domain is fit to whatever price levels
// actually need to be visible (candles + entry/stop/target + current price), with
// allowDataOverflow so Recharts uses that domain exactly rather than silently
// widening it to also fit its own auto-computed data range.
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

  // Auto-fit around every price level that needs to be visible: candle highs/lows,
  // full entry/stop/target zones, current price. 7% padding above and below so the
  // highest/lowest relevant level sits near the plot edge without touching it.
  const values = data.flatMap(d => [d.low, d.high])
  const candidates = [...values, entryLow, entryHigh, currentPrice, ...(stopRange ?? []), ...(targetRangeParsed ?? [])]
    .filter((v): v is number => v != null)
  const min = Math.min(...candidates)
  const max = Math.max(...candidates)
  const pad = (max - min) * 0.07 || Math.abs(max || 1) * 0.01
  const domain: [number, number] = [min - pad, max + pad]

  const lastDate = data[data.length - 1]!.date

  const zoneLabelSpecs: ZoneLabelSpec[] = []
  if (entryLow != null && entryHigh != null) {
    zoneLabelSpecs.push({ key: 'entry', anchor: Math.max(entryLow, entryHigh), text: 'ENTRY', color: '#16a34a' })
  }
  if (stopRange) {
    zoneLabelSpecs.push({ key: 'stop', anchor: Math.max(stopRange[0], stopRange[1]), text: 'STOP', color: '#dc2626' })
  }
  if (targetRangeParsed) {
    zoneLabelSpecs.push({ key: 'target', anchor: Math.max(targetRangeParsed[0], targetRangeParsed[1]), text: 'TARGET', color: '#2563eb' })
  }

  return (
    <div style={{ height: CHART_HEIGHT, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={CHART_MARGIN}>
          <XAxis
            dataKey="date"
            tickFormatter={chartDateLabel}
            tick={{ fontSize: 10 }}
            minTickGap={20}
            height={X_AXIS_HEIGHT}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickLine={false}
          />
          <YAxis domain={domain} type="number" hide allowDataOverflow />
          <Tooltip content={<CandleTooltip precision={precision} />} />

          {entryLow != null && entryHigh != null && (
            <ReferenceArea
              y1={entryLow} y2={entryHigh} fill="#16a34a" fillOpacity={0.15}
              stroke="#16a34a" strokeOpacity={0.5} strokeWidth={1}
            />
          )}
          {stopRange && (
            <ReferenceArea
              y1={stopRange[0]} y2={stopRange[1]} fill="#dc2626" fillOpacity={0.08}
              stroke="#dc2626" strokeOpacity={0.4} strokeWidth={1}
            />
          )}
          {targetRangeParsed && (
            <ReferenceArea
              y1={targetRangeParsed[0]} y2={targetRangeParsed[1]} fill="#2563eb" fillOpacity={0.08}
              stroke="#2563eb" strokeOpacity={0.4} strokeWidth={1}
            />
          )}
          {currentPrice != null && (
            <ReferenceLine
              y={currentPrice} stroke="currentColor" strokeDasharray="5 3" strokeWidth={2} className="text-foreground"
              label={{ value: `Current ${currentPrice.toFixed(precision)}`, position: 'right', fontSize: 9, fontWeight: 700, fill: 'currentColor' }}
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
          <Customized component={(p: any) => <ZoneLabels {...p} specs={zoneLabelSpecs} />} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
