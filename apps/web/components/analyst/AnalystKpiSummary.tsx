'use client'
import { useState } from 'react'
import { BarChart, Bar, ResponsiveContainer, ReferenceLine, Tooltip, Cell } from 'recharts'

interface KpiRow {
  kpi_name: string
  kpi_value: any
  period_start: string
}
interface ActualTrade {
  result_r: number | null
  triggered: boolean
  published_at?: string
  source_system?: string
}
interface Publication {
  reconciliation_status: string
}
interface Props {
  kpiData: KpiRow[]
  currentMonthStart: string
  lastMonthStart: string
  actualTrades: ActualTrade[]
  lastWeekPublications: Publication[]
  lastWeekStart: string
  lastWeekEnd: string
  thisMonthPublications: Publication[]
}

type Period = 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_WEEK'

// Same thresholds as TeamPerformanceGrid.tsx's TARGETS -- this tab is a single-analyst
// view of the same KPI display, so the colouring must agree with what management sees.
const TARGETS: Record<string, number> = {
  total_return_r: 0,
  win_rate: 0.45,
  triggered_rate: 0.35,
  max_drawdown: -10,
}

const KPI_COLS = [
  { name: 'total_return_r', label: 'Return' },
  { name: 'win_rate', label: 'Win Rate' },
  { name: 'triggered_rate', label: 'Triggered' },
  { name: 'max_drawdown', label: 'Drawdown' },
  { name: 'alignment_rate', label: 'Alignment' },
]

function monthLabel(period_start: string) {
  const date = new Date(period_start + 'T12:00:00Z')
  return date.toLocaleString('en-GB', { month: 'short', year: '2-digit' })
}

function getValue(kpi: KpiRow | undefined): number | null {
  if (!kpi) return null
  const v = kpi.kpi_value
  return typeof v === 'object' ? (v.value ?? null) : Number(v)
}

function isOnTarget(name: string, value: number): boolean {
  const t = TARGETS[name]
  if (t === undefined) return true
  return value >= t
}

function formatKpi(name: string, value: number | null): string {
  if (value === null) return '—'
  if (name === 'total_return_r') return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`
  if (name === 'win_rate' || name === 'triggered_rate' || name === 'alignment_rate') return `${Math.round(value * 100)}%`
  if (name === 'max_drawdown') return `${value.toFixed(2)}R`
  return String(value)
}

// Same per-day source-preference rule as TeamPerformanceGrid.tsx's preferApiPerDay(): a
// triggered ACUITY_PERFORMANCE_API row wins over MANUAL_BACKFILL for the same day, but an
// untriggered API row doesn't count as "covering" that day -- backfill is kept where the
// live feed has no triggered row, so a feed outage doesn't zero out a real trading day.
function preferApiPerDay(trades: ActualTrade[]): ActualTrade[] {
  const apiDates = new Set<string>()
  for (const t of trades) {
    if (t.source_system === 'ACUITY_PERFORMANCE_API' && t.triggered && t.published_at) {
      apiDates.add(t.published_at.slice(0, 10))
    }
  }
  return trades.filter(t => {
    if (t.source_system === 'ACUITY_PERFORMANCE_API') return true
    if (!t.published_at) return true
    return !apiDates.has(t.published_at.slice(0, 10))
  })
}

export function AnalystKpiSummary({
  kpiData, currentMonthStart, lastMonthStart, actualTrades,
  lastWeekPublications, lastWeekStart, lastWeekEnd, thisMonthPublications,
}: Props) {
  const [period, setPeriod] = useState<Period>('THIS_MONTH')
  const activePeriodStart = period === 'LAST_MONTH' ? lastMonthStart : currentMonthStart

  const periodTrades = period === 'LAST_WEEK'
    ? preferApiPerDay(actualTrades.filter(t =>
        t.published_at && t.published_at.slice(0, 10) >= lastWeekStart && t.published_at.slice(0, 10) <= lastWeekEnd
      ))
    : period === 'THIS_MONTH'
    ? actualTrades.filter(t => t.published_at && t.published_at.slice(0, 10) >= currentMonthStart)
    : actualTrades

  const periodPublications = period === 'LAST_WEEK' ? lastWeekPublications : thisMonthPublications

  const byName = new Map<string, KpiRow[]>()
  for (const row of kpiData) {
    if (!byName.has(row.kpi_name)) byName.set(row.kpi_name, [])
    byName.get(row.kpi_name)!.push(row)
  }

  let kpis: { col: typeof KPI_COLS[0]; val: number | null; kpiValue: any; hit: boolean | null }[]
  let hasData: boolean

  if (period !== 'LAST_MONTH') {
    // This Month / Last Week: compute live from raw trades, same as TeamPerformanceGrid's
    // per-analyst row -- Total R and win rate use all triggered trades regardless of
    // source; trigger rate numerator is API-only for This Month (mixed-source period),
    // but for Last Week periodTrades has already been through preferApiPerDay(), so
    // `triggered` there is already the correct per-day-best-source set.
    const triggered = periodTrades.filter(t => t.triggered && t.result_r !== null)
    const wins = triggered.filter(t => (t.result_r ?? 0) > 0)
    const totalR = triggered.reduce((s, t) => s + (t.result_r ?? 0), 0)
    const winRate = triggered.length > 0 ? wins.length / triggered.length : null
    const apiTriggered = period === 'LAST_WEEK' ? triggered : triggered.filter(t => t.source_system === 'ACUITY_PERFORMANCE_API')
    const pubTotal = periodPublications.length
    const trigRate = pubTotal > 0 ? apiTriggered.length / pubTotal : null
    const liveVals: Record<string, number | null> = {
      total_return_r: triggered.length > 0 ? totalR : null,
      win_rate: winRate,
      triggered_rate: trigRate,
      max_drawdown: null,
      alignment_rate: null,
    }
    hasData = triggered.length > 0
    kpis = KPI_COLS.map(col => {
      const val = liveVals[col.name] ?? null
      return { col, val, kpiValue: null, hit: val !== null ? isOnTarget(col.name, val) : null }
    })
  } else {
    kpis = KPI_COLS.map(col => {
      const rows = byName.get(col.name) ?? []
      const current = rows.find(r => r.period_start === activePeriodStart)
      const val = getValue(current)
      const kpiValue = current?.kpi_value
      return { col, val, kpiValue, hit: val !== null ? isOnTarget(col.name, val) : null }
    })
    hasData = kpis.some(k => k.val !== null)
  }

  const allHit = kpis.some(k => k.hit !== null) && kpis.filter(k => k.hit !== null).every(k => k.hit === true)
  const anyMissed = kpis.some(k => k.hit === false)

  const returnTrend = (byName.get('total_return_r') ?? [])
    .sort((a, b) => a.period_start.localeCompare(b.period_start))
    .slice(-6)
    .map(r => ({ month: monthLabel(r.period_start), value: getValue(r) }))

  const periodLabel = period === 'THIS_MONTH' ? 'This Month' : period === 'LAST_MONTH' ? 'Last Month' : 'Last Week'

  return (
    <div className="space-y-6">
      {/* Period toggle */}
      <div className="flex gap-2">
        {(['THIS_MONTH', 'LAST_WEEK', 'LAST_MONTH'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              period === p
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:border-primary/50'
            }`}
          >
            {p === 'THIS_MONTH' ? 'This Month' : p === 'LAST_WEEK' ? 'Last Week' : 'Last Month'}
          </button>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">My KPIs &mdash; {periodLabel}</h2>
          {hasData && (
            allHit ? (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">All targets</span>
            ) : anyMissed ? (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700">Off target</span>
            ) : null
          )}
        </div>
        <div className="grid grid-cols-5 gap-3">
          {kpis.map(({ col, val, kpiValue, hit }) => (
            <div key={col.name} className={`rounded-lg border p-4 ${
              hit === true ? 'border-green-200 bg-green-50/30' :
              hit === false ? 'border-red-200 bg-red-50/30' :
              'border-border bg-card'
            }`}>
              <p className="text-xs text-muted-foreground">{col.label}</p>
              <p className="text-xl font-semibold mt-1 tabular-nums">{formatKpi(col.name, val)}</p>
              {col.name === 'alignment_rate' && val !== null && kpiValue?.fully_aligned !== undefined ? (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {kpiValue.fully_aligned}F/{kpiValue.partially_aligned ?? 0}P/{kpiValue.not_aligned ?? 0}N
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">&nbsp;</p>
              )}
            </div>
          ))}
        </div>
        {!hasData && <p className="text-xs text-muted-foreground">No data for this period.</p>}
      </section>

      {returnTrend.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Return Trend &mdash; Last 6 Months</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={returnTrend} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Tooltip formatter={(v: any) => [v !== null ? `${Number(v).toFixed(2)}R` : '—', 'Return']}
                    labelFormatter={(label: any) => label} contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                    {returnTrend.map((entry, i) => (
                      <Cell key={i} fill={entry.value !== null && entry.value >= 0 ? '#22c55e' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
