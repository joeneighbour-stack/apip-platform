'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LineChart, Line } from 'recharts'

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
}

interface TeamPerformanceGridProps {
  analysts: Analyst[]
  kpiData: KpiRow[]
  currentMonthStart: string
  shadowOutcomes: ShadowOutcome[]
  actualTrades: ActualTrade[]
}

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
  if (value === null) return '—'
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
  return null
}

export function TeamPerformanceGrid({
  analysts, kpiData, currentMonthStart, shadowOutcomes, actualTrades
}: TeamPerformanceGridProps) {
  const index = new Map<string, Map<string, KpiRow[]>>()
  for (const row of kpiData) {
    if (!index.has(row.analyst_id)) index.set(row.analyst_id, new Map())
    const byName = index.get(row.analyst_id)!
    if (!byName.has(row.kpi_name)) byName.set(row.kpi_name, [])
    byName.get(row.kpi_name)!.push(row)
  }

  // Team aggregate for current month
  const teamAgg: Record<string, number[]> = {}
  for (const analyst of analysts) {
    const byName = index.get(analyst.analyst_id)
    if (!byName) continue
    for (const col of KPI_COLS) {
      const rows = byName.get(col.name) ?? []
      const current = rows.find(r => r.period_start === currentMonthStart)
      const val = getValue(current)
      if (val !== null) {
        if (!teamAgg[col.name]) teamAgg[col.name] = []
        teamAgg[col.name].push(val)
      }
    }
  }

  // Shadow summary
  const shadowTriggered = shadowOutcomes.filter(o =>
    ['TARGET_HIT', 'STOP_HIT', 'TRIGGERED'].includes(o.trade_outcome_status)
  )
  const shadowWins = shadowOutcomes.filter(o => o.trade_outcome_status === 'TARGET_HIT')
  const shadowWinRate = shadowTriggered.length > 0 ? shadowWins.length / shadowTriggered.length : null
  const shadowTriggerRate = shadowOutcomes.length > 0 ? shadowTriggered.length / shadowOutcomes.length : null
  const shadowTotalR = shadowTriggered.reduce((s, o) => s + (shadowResultR(o) ?? 0), 0)

  // Actual summary
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

  return (
    <div className="space-y-8">

      {/* Team summary row */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Team Summary — This Month</h2>
        <div className="grid grid-cols-5 gap-3">
          {KPI_COLS.map(col => {
            const vals = teamAgg[col.name] ?? []
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
                <p className="text-xl font-semibold mt-1 tabular-nums">
                  {formatKpi(col.name, agg)}
                </p>
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
                const byName = index.get(analyst.analyst_id)
                const currentKpis = KPI_COLS.map(col => {
                  const rows = byName?.get(col.name) ?? []
                  const current = rows.find(r => r.period_start === currentMonthStart)
                  const val = getValue(current)
                  const kpiValue = current?.kpi_value
                  return { col, val, kpiValue, hit: val !== null ? isOnTarget(col.name, val) : null }
                })
                const allHit = currentKpis.every(k => k.hit === true)
                const anyMissed = currentKpis.some(k => k.hit === false)
                const hasData = currentKpis.some(k => k.val !== null)
                const returnTrend = trendData(analyst.analyst_id, 'total_return_r')
                return (
                  <tr key={analyst.analyst_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <a href={`/dashboard/management/analyst/${analyst.analyst_id}`}
                        className="hover:text-primary hover:underline transition-colors">
                        {analyst.display_name}
                      </a>
                    </td>
                    {currentKpis.map(({ col, val, kpiValue, hit }) => (
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
          <h2 className="text-sm font-medium">Team Total Return — Long Term</h2>
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

      {/* Shadow vs Actual summary */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Shadow vs Actual Comparison</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shadow Benchmark</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Total setups</span><span className="font-medium">{shadowOutcomes.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger rate</span><span className="font-medium">{shadowTriggerRate !== null ? `${Math.round(shadowTriggerRate * 100)}%` : '—'}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate</span><span className="font-medium">{shadowWinRate !== null ? `${Math.round(shadowWinRate * 100)}%` : '—'}</span></div>
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
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger rate</span><span className="font-medium">{actualTriggerRate !== null ? `${Math.round(actualTriggerRate * 100)}%` : '—'}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate</span><span className="font-medium">{actualWinRate !== null ? `${Math.round(actualWinRate * 100)}%` : '—'}</span></div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total R</span>
                <span className={`font-medium ${actualTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {actualTotalR > 0 ? '+' : ''}{actualTotalR.toFixed(2)}R
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delta (Shadow − Actual)</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate delta</span>
                <span className="font-medium">
                  {shadowWinRate !== null && actualWinRate !== null
                    ? `${((shadowWinRate - actualWinRate) * 100).toFixed(1)}pp` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger delta</span>
                <span className="font-medium">
                  {shadowTriggerRate !== null && actualTriggerRate !== null
                    ? `${((shadowTriggerRate - actualTriggerRate) * 100).toFixed(1)}pp` : '—'}
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

    </div>
  )
}
