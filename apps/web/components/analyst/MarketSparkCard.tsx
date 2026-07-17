'use client'
import { BarChart, Bar, ResponsiveContainer, Cell, Tooltip } from 'recharts'

interface DayData {
  date: string
  close: number
  open: number
  atr20: number
  zone: string
}

interface Props {
  marketData: DayData[]
  trendState: string | null
  volatilityState: string | null
}

const TREND_LABELS: Record<string, { label: string; cls: string }> = {
  TRENDING_UP:   { label: '↑ Trending Up',   cls: 'bg-green-100 text-green-800' },
  TRENDING_DOWN: { label: '↓ Trending Down', cls: 'bg-red-100 text-red-800' },
  RANGING:       { label: '↔ Ranging',       cls: 'bg-blue-50 text-blue-700' },
  CHOPPY:        { label: '~ Choppy',        cls: 'bg-amber-50 text-amber-700' },
}

const VOL_LABELS: Record<string, { label: string; cls: string }> = {
  LOW_VOL:     { label: 'Low Vol',     cls: 'bg-green-50 text-green-700' },
  NORMAL_VOL:  { label: 'Normal Vol',  cls: 'bg-slate-100 text-slate-600' },
  HIGH_VOL:    { label: 'High Vol',    cls: 'bg-amber-100 text-amber-800' },
  EXTREME_VOL: { label: 'Extreme Vol', cls: 'bg-red-100 text-red-800' },
}

export function MarketSparkCard({ marketData, trendState, volatilityState }: Props) {
  const sorted = [...marketData].sort((a, b) => a.date.localeCompare(b.date)).slice(-10)

  const momentumData = sorted.map(d => ({
    date: d.date.slice(5),
    change: Number(d.close) - Number(d.open),
    up: Number(d.close) >= Number(d.open),
  }))

  const trend = trendState ? TREND_LABELS[trendState] : null
  const vol = volatilityState ? VOL_LABELS[volatilityState] : null

  return (
    <div className="space-y-3">
      {/* Regime badges */}
      <div className="flex items-center gap-2 flex-wrap">
        {trend && (
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${trend.cls}`}>
            {trend.label}
          </span>
        )}
        {vol && (
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${vol.cls}`}>
            {vol.label}
          </span>
        )}
      </div>

      {/* 10-day momentum bars */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1">Daily momentum — last 10 sessions</p>
        <div className="h-10">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={momentumData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <Tooltip
                contentStyle={{ fontSize: 10, padding: '2px 6px' }}
                formatter={(v: any) => [Number(v) >= 0 ? `+${Number(v).toFixed(4)}` : Number(v).toFixed(4), 'Day move']}
                labelFormatter={(l) => l}
              />
              <Bar dataKey="change" radius={[1, 1, 0, 0]}>
                {momentumData.map((entry, i) => (
                  <Cell key={i} fill={entry.up ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* News placeholder */}
      <div className="rounded-md bg-muted/40 border border-dashed border-border px-3 py-2.5">
        <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Latest market news</p>
        <p className="text-[10px] text-muted-foreground italic">
          Live headlines coming soon — Acuity MarketReader
        </p>
      </div>
    </div>
  )
}
