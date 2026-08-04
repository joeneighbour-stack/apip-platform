'use client'
import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'

interface Analyst {
  analyst_id: string
  display_name: string
  active: boolean
}
interface KpiRow {
  analyst_id: string
  kpi_name: string
  kpi_value: any
  period_start: string
}
interface ShadowOutcome {
  trade_outcome_status: string
  result_r: number | null
  shadow_trade: { rr: number } | null
}
interface ActualTrade {
  result_r: number | null
  triggered: boolean
  published_at?: string
  analyst_id?: string
}
interface TeamPerformanceGridProps {
  analysts: Analyst[]
  kpiData: KpiRow[]
  currentMonthStart: string
  lastMonthStart: string
  shadowOutcomes: ShadowOutcome[]
  actualTrades: ActualTrade[]
  shadowKpiData: { kpi_name: string; kpi_value: any; period_start: string }[]
  lastWeekPublications?: { analyst_id: string; reconciliation_status: string }[]
}

type Period = 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_WEEK'

const TARGETS: Record<string, number> = {
  total_return_r: 0,
  win_rate: 0.45,
  triggered_rate: 0.35,
  max_drawdown: -10,
}

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
  return name === 'max_drawdown' ? value >= t : value >= t
}

function formatKpi(name: string, value: number | null, kpiValue?: any): string {
  if (value === null) return '\u2014'
  if (name === 'total_return_r') return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`
  if (name === 'win_rate' || name === 'triggered_rate') return `${Math.round(value * 100)}%`
  if (name === 'alignment_rate') return `${Math.round(value * 100)}%`
  if (name === 'max_drawdown') return `${value.toFixed(2)}R`
  return String(value)
}

const KPI_COLS = [
  { name: 'total_return_r', label: 'Return' },
  { name: 'win_rate', label: 'Win Rate' },
  { name: 'triggered_rate', label: 'Triggered' },
  { name: 'max_drawdown', label: 'Drawdown' },
  { name: 'alignment_rate', label: 'Alignment' },
]

function shadowResultR(outcome: ShadowOutcome): number | null {
  if (outcome.result_r !== null) return outcome.result_r
  if (outcome.trade_outcome_status === 'TARGET_HIT') return outcome.shadow_trade?.rr ?? null
  if (outcome.trade_outcome_status === 'STOP_HIT') return -1
  if (outcome.trade_outcome_status === 'CLOSED_PROFIT' || outcome.trade_outcome_status === 'CLOSED_LOSS') return outcome.result_r
  return null
}

export function TeamPerformanceGrid({
  analysts, kpiData, currentMonthStart, lastMonthStart, shadowOutcomes, actualTrades, shadowKpiData,
  lastWeekPublications = []
}: TeamPerformanceGridProps) {
  const [period, setPeriod] = useState<Period>('THIS_MONTH')

  // Last week date range (Mon-Fri of previous week)
  const now = new Date()
  const dayOfWeek = now.getUTCDay()
  const daysToLastMonday = (dayOfWeek + 6) % 7 + 7
  const monday = new Date(now)
  monday.setUTCDate(now.getUTCDate() - daysToLastMonday)
  monday.setUTCHours(0, 0, 0, 0)
  const friday = new Date(monday)
  friday.setUTCDate(monday.getUTCDate() + 4)
  friday.setUTCHours(23, 59, 59, 999)
  const lastWeekStart = monday.toISOString().slice(0, 10)
  const lastWeekEnd = friday.toISOString().slice(0, 10)

  const activePeriodStart = period === 'LAST_MONTH' ? lastMonthStart : currentMonthStart

  // Filter trades by period
  const periodTrades = period === 'LAST_WEEK'
    ? actualTrades.filter(t => t.published_at && t.published_at.slice(0, 10) >= lastWeekStart && t.published_at.slice(0, 10) <= lastWeekEnd)
    : actualTrades

  const index = new Map<string, Map<string, KpiRow[]>>()
  for (const row of kpiData) {
    if (!index.has(row.analyst_id)) index.set(row.analyst_id, new Map())
    const byName = index.get(row.analyst_id)!
    if (!byName.has(row.kpi_name)) byName.set(row.kpi_name, [])
    byName.get(row.kpi_name)!.push(row)
  }

  // Team aggregate for current/last month from KPIs
  const teamAgg: Record<string, number[]> = {}
  const weekTeamAgg: Record<string, number[]> = {}

  if (period !== 'LAST_WEEK') {
    for (const analyst of analysts) {
      const byName = index.get(analyst.analyst_id)
      if (!byName) continue
      for (const col of KPI_COLS) {
        const rows = byName.get(col.name) ?? []
        const current = rows.find(r => r.period_start === activePeriodStart)
        const val = getValue(current)
        if (val !== null) {
          if (!teamAgg[col.name]) teamAgg[col.name] = []
          teamAgg[col.name].push(val)
        }
      }
    }
  } else {
    // Last week: compute from raw trades per analyst
    const byAnalyst = new Map<string, ActualTrade[]>()
    for (const t of periodTrades) {
      if (!t.analyst_id) continue
      if (!byAnalyst.has(t.analyst_id)) byAnalyst.set(t.analyst_id, [])
      byAnalyst.get(t.analyst_id)!.push(t)
    }
    for (const analyst of analysts) {
      const trades = byAnalyst.get(analyst.analyst_id) ?? []
      const triggered = trades.filter(t => t.triggered && t.result_r !== null)
      const wins = triggered.filter(t => (t.result_r ?? 0) > 0)
      const totalR = triggered.reduce((s, t) => s + (t.result_r ?? 0), 0)
      const winRate = triggered.length > 0 ? wins.length / triggered.length : null
      const lwPubTotal = lastWeekPublications.filter(p => p.analyst_id === analyst.analyst_id).length
      const trigRate = lwPubTotal > 0 ? triggered.length / lwPubTotal : null

      if (totalR !== 0 || triggered.length > 0) {
        if (!weekTeamAgg['total_return_r']) weekTeamAgg['total_return_r'] = []
        weekTeamAgg['total_return_r'].push(totalR)
        if (winRate !== null) {
          if (!weekTeamAgg['win_rate']) weekTeamAgg['win_rate'] = []
          weekTeamAgg['win_rate'].push(winRate)
        }
        if (trigRate !== null) {
          if (!weekTeamAgg['triggered_rate']) weekTeamAgg['triggered_rate'] = []
          weekTeamAgg['triggered_rate'].push(trigRate)
        }
      }
    }
  }

  const displayAgg = period === 'LAST_WEEK' ? weekTeamAgg : teamAgg

  // Shadow summary
  const shadowOutcomesSafe = shadowOutcomes ?? []
  const shadowTriggered = shadowOutcomesSafe.filter(o =>
    ['TARGET_HIT', 'STOP_HIT', 'TRIGGERED', 'CLOSED_PROFIT', 'CLOSED_LOSS'].includes(o.trade_outcome_status)
  )
  const shadowWins = shadowOutcomesSafe.filter(o =>
    o.trade_outcome_status === 'TARGET_HIT' ||
    o.trade_outcome_status === 'CLOSED_PROFIT' ||
    (o.result_r !== null && Number(o.result_r) > 0)
  )
  const shadowWinRate = shadowTriggered.length > 0 ? shadowWins.length / shadowTriggered.length : null
  const shadowTriggerRate = shadowOutcomesSafe.length > 0 ? shadowTriggered.length / shadowOutcomesSafe.length : null
  const shadowTotalR = shadowTriggered.reduce((s, o) => s + (shadowResultR(o) ?? 0), 0)

  const shadowKpiDataSafe = shadowKpiData ?? []
  const shadowReturnTrend = shadowKpiDataSafe.length > 0
    ? shadowKpiDataSafe.filter(k => k.kpi_name === 'total_return_r').map(k => ({ month: monthLabel(k.period_start), value: k.kpi_value?.value ?? 0 }))
    : [{ month: 'Jul 26', value: 0 }]

  // Actual summary (30 days)
  const actualTriggered = actualTrades.filter(t => t.triggered && t.result_r !== null)
  const actualWins = actualTriggered.filter(t => (t.result_r ?? 0) > 0)
  const actualWinRate = actualTriggered.length > 0 ? actualWins.length / actualTriggered.length : null
  const actualTriggerRate = actualTrades.length > 0 ? actualTriggered.length / actualTrades.length : null
  const actualTotalR = actualTriggered.reduce((s, t) => s + (t.result_r ?? 0), 0)

  // Team long-term R trend
  const allMonths = [...new Set(kpiData
    .filter(k => k.kpi_name === 'total_return_r')
    .map(k => k.period_start)
  )].sort()
  const teamReturnTrend = allMonths.map(month => {
    const total = analysts.reduce((sum, analyst) => {
      const rows = index.get(analyst.analyst_id)?.get('total_return_r') ?? []
      const row = rows.find(r => r.period_start === month)
      return sum + (getValue(row) ?? 0)
    }, 0)
    return { month: monthLabel(month), value: total }
  })

  function trendData(analystId: string, kpiName: string) {
    const rows = index.get(analystId)?.get(kpiName) ?? []
    return rows
      .sort((a, b) => a.period_start.localeCompare(b.period_start))
      .slice(-6)
      .map(r => ({ month: monthLabel(r.period_start), value: getValue(r) }))
  }

  const periodLabel = period === 'THIS_MONTH' ? 'This Month' : period === 'LAST_MONTH' ? 'Last Month' : 'Last Week'

  return (
    <div className="space-y-8">

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

      {/* Team summary row */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Team Summary &mdash; {periodLabel}</h2>
        <div className="grid grid-cols-5 gap-3">
          {KPI_COLS.map(col => {
            const vals = displayAgg[col.name] ?? []
            const agg = vals.length > 0
              ? col.name === 'total_return_r'
                ? vals.reduce((a, b) => a + b, 0)
                : vals.reduce((a, b) => a + b, 0) / vals.length
              : null
            const onTarget = agg !== null ? isOnTarget(col.name, agg) : null
            return (
              <div key={col.name} className={`rounded-lg border p-4 ${
                onTarget === true ? 'border-green-200 bg-green-50/30' :
                onTarget === false ? 'border-red-200 bg-red-50/30' :
                'border-border bg-card'
              }`}>
                <p className="text-xs text-muted-foreground">{col.label}</p>
                <p className="text-xl font-semibold mt-1 tabular-nums">{formatKpi(col.name, agg)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {col.name === 'total_return_r' ? 'Team total' : 'Team avg'}
                </p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Per-analyst grid */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">By Analyst</h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground w-40">Analyst</th>
                {KPI_COLS.map(col => (
                  <th key={col.name} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                    {col.label}
                  </th>
                ))}
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Return Trend</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {analysts.map(analyst => {
                let analystKpis: { col: typeof KPI_COLS[0], val: number | null, kpiValue: any, hit: boolean | null }[]
                let hasData = false
                let returnTrend = trendData(analyst.analyst_id, 'total_return_r')

                if (period === 'LAST_WEEK') {
                  const trades = periodTrades.filter(t => t.analyst_id === analyst.analyst_id)
                  const triggered = trades.filter(t => t.triggered && t.result_r !== null)
                  const wins = triggered.filter(t => (t.result_r ?? 0) > 0)
                  const totalR = triggered.reduce((s, t) => s + (t.result_r ?? 0), 0)
                  const winRate = triggered.length > 0 ? wins.length / triggered.length : null
                  const lwPubTotal = lastWeekPublications.filter(p => p.analyst_id === analyst.analyst_id).length
                  const trigRate = lwPubTotal > 0 ? triggered.length / lwPubTotal : null
                  const weekVals: Record<string, number | null> = {
                    total_return_r: triggered.length > 0 ? totalR : null,
                    win_rate: winRate,
                    triggered_rate: trigRate,
                    max_drawdown: null,
                    alignment_rate: null,
                  }
                  hasData = triggered.length > 0
                  analystKpis = KPI_COLS.map(col => {
                    const val = weekVals[col.name] ?? null
                    return { col, val, kpiValue: null, hit: val !== null ? isOnTarget(col.name, val) : null }
                  })
                } else {
                  const byName = index.get(analyst.analyst_id)
                  analystKpis = KPI_COLS.map(col => {
                    const rows = byName?.get(col.name) ?? []
                    const current = rows.find(r => r.period_start === activePeriodStart)
                    const val = getValue(current)
                    const kpiValue = current?.kpi_value
                    return { col, val, kpiValue, hit: val !== null ? isOnTarget(col.name, val) : null }
                  })
                  hasData = analystKpis.some(k => k.val !== null)
                }

                const allHit = analystKpis.some(k => k.hit !== null) && analystKpis.filter(k => k.hit !== null).every(k => k.hit === true)
                const anyMissed = analystKpis.some(k => k.hit === false)

                return (
                  <tr key={analyst.analyst_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <a href={`/dashboard/management/analyst/${analyst.analyst_id}`}
                        className="hover:text-primary hover:underline transition-colors">
                        {analyst.display_name}
                      </a>
                    </td>
                    {analystKpis.map(({ col, val, kpiValue, hit }) => (
                      <td key={col.name} className="px-4 py-3 tabular-nums">
                        {col.name === 'alignment_rate' && val !== null && kpiValue?.fully_aligned !== undefined ? (
                          <div>
                            <span className={hit === true ? 'text-green-700 font-medium' : hit === false ? 'text-red-700 font-medium' : ''}>
                              {formatKpi(col.name, val)}
                            </span>
                            <span className="text-xs text-muted-foreground ml-1">
                              ({kpiValue.fully_aligned}F/{kpiValue.partially_aligned ?? 0}P/{kpiValue.not_aligned ?? 0}N)
                            </span>
                          </div>
                        ) : (
                          <span className={
                            hit === true ? 'text-green-700 font-medium' :
                            hit === false ? 'text-red-700 font-medium' :
                            'text-muted-foreground'
                          }>
                            {formatKpi(col.name, val, kpiValue)}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <div className="h-10 w-32">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={returnTrend} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                            <ReferenceLine y={0} stroke="hsl(var(--border))" />
                            <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                              {returnTrend.map((entry, i) => (
                                <Cell key={i} fill={entry.value !== null && entry.value >= 0 ? '#22c55e' : '#ef4444'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {!hasData ? (
                        <span className="text-xs text-muted-foreground">No data</span>
                      ) : allHit ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">All targets</span>
                      ) : anyMissed ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700">Off target</span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Team long-term R trend */}
      {teamReturnTrend.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Team Total Return &mdash; Long Term</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamReturnTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                    interval={Math.floor(teamReturnTrend.length / 12)} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}R`} />
                  <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}R`, 'Team Return']}
                    contentStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                    {teamReturnTrend.map((entry, i) => (
                      <Cell key={i} fill={entry.value >= 0 ? '#22c55e' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {/* Shadow vs Actual comparison */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Shadow vs Actual Comparison</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shadow Benchmark</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Total setups</span><span className="font-medium">{shadowOutcomesSafe.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger rate</span><span className="font-medium">{shadowTriggerRate !== null ? `${Math.round(shadowTriggerRate * 100)}%` : '\u2014'}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate</span><span className="font-medium">{shadowWinRate !== null ? `${Math.round(shadowWinRate * 100)}%` : '\u2014'}</span></div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total R</span>
                <span className={`font-medium ${shadowTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {shadowTotalR > 0 ? '+' : ''}{shadowTotalR.toFixed(2)}R
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Analyst Actual (30 days)</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Total setups</span><span className="font-medium">{actualTrades.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger rate</span><span className="font-medium">{actualTriggerRate !== null ? `${Math.round(actualTriggerRate * 100)}%` : '\u2014'}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate</span><span className="font-medium">{actualWinRate !== null ? `${Math.round(actualWinRate * 100)}%` : '\u2014'}</span></div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total R</span>
                <span className={`font-medium ${actualTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {actualTotalR > 0 ? '+' : ''}{actualTotalR.toFixed(2)}R
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delta (Shadow &minus; Actual)</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate delta</span>
                <span className="font-medium">
                  {shadowWinRate !== null && actualWinRate !== null
                    ? `${((shadowWinRate - actualWinRate) * 100).toFixed(1)}pp` : '\u2014'}
                </span>
              </div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger delta</span>
                <span className="font-medium">
                  {shadowTriggerRate !== null && actualTriggerRate !== null
                    ? `${((shadowTriggerRate - actualTriggerRate) * 100).toFixed(1)}pp` : '\u2014'}
                </span>
              </div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Status</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {shadowTriggered.length < 30 ? `Accumulating (${shadowTriggered.length}/30)` : 'Ready'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Shadow System Monthly Performance */}
      {shadowReturnTrend.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Shadow System Performance</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Internal benchmark &mdash; not visible to analysts</p>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {(['total_return_r', 'win_rate', 'triggered_rate', 'max_drawdown'] as const).map(kpiName => {
              const latestKpi = shadowKpiDataSafe.filter(k => k.kpi_name === kpiName).at(-1)
              const value = latestKpi ? (latestKpi.kpi_value?.value ?? null) : null
              return (
                <div key={kpiName} className="rounded-lg border border-border bg-card p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {KPI_COLS.find(c => c.name === kpiName)?.label ?? kpiName}
                    <span className="ml-1 text-[10px] opacity-60">shadow</span>
                  </p>
                  <p className={`text-sm font-semibold tabular-nums ${
                    value === null ? 'text-muted-foreground' :
                    kpiName === 'total_return_r' ? (value >= 0 ? 'text-green-700' : 'text-red-700') :
                    kpiName === 'max_drawdown' ? (value >= -5 ? 'text-green-700' : 'text-red-700') :
                    'text-foreground'
                  }`}>{formatKpi(kpiName, value)}</p>
                </div>
              )
            })}
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-3">Monthly Return (R) &mdash; Shadow System</p>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={shadowReturnTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={v => `${v > 0 ? '+' : ''}${Number(v).toFixed(0)}R`} />
                  <Tooltip
                    formatter={(v: any) => [`${Number(v).toFixed(2)}R`, 'Shadow Return']}
                    contentStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                    {shadowReturnTrend.map((entry, i) => (
                      <Cell key={i} fill={entry.value >= 0 ? '#22c55e' : '#ef4444'} />
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
