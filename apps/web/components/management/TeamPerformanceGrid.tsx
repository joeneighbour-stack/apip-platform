'use client'
import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import { formatDateShort } from '@/lib/format'

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
  shadow_trade: { rr: number; generated_at?: string } | null
}
interface ActualTrade {
  result_r: number | null
  triggered: boolean
  published_at?: string
  analyst_id?: string
  source_system?: string
}
interface TeamPerformanceGridProps {
  analysts: Analyst[]
  kpiData: KpiRow[]
  currentMonthStart: string
  lastMonthStart: string
  shadowOutcomes: ShadowOutcome[]
  actualTrades: ActualTrade[]
  // Last 30 days of shadow_trade_outcomes, live -- feeds the "Shadow System Performance"
  // tiles + trend below, in place of the old executive_kpis(kpi_visibility='INTERNAL_ONLY')
  // read (which showed the current month as 0R until the shadow KPI batch caught up).
  shadowOutcomesRecent: ShadowOutcome[]
  lastWeekPublications?: { analyst_id: string; reconciliation_status: string }[]
  lastWeekStart: string
  lastWeekEnd: string
  thisMonthPublications?: { analyst_id: string; reconciliation_status: string }[]
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

// A triggered_rate row with a zero numerator (kpi_value.triggered === 0) isn't a meaningful
// "0%" signal -- it's indistinguishable from no data yet, so it displays the same as a missing
// row ("--"), not "0%".
function getValue(kpi: KpiRow | undefined): number | null {
  if (!kpi) return null
  const v = kpi.kpi_value
  if (typeof v === 'object') {
    if (kpi.kpi_name === 'triggered_rate' && v?.triggered === 0) return null
    return v.value ?? null
  }
  return Number(v)
}

// Compare against the same rounded precision the tile/table actually displays
// (Math.round(value*100) for rate-based KPIs) -- otherwise a value like 0.3488 that *displays*
// as "35%" (rounds up) can fail a raw >= 0.35 check and read as "Missed targets" right next to a
// badge showing 35%, which looks like a contradiction.
function isOnTarget(name: string, value: number): boolean {
  const t = TARGETS[name]
  if (t === undefined) return true
  const isRate = name === 'win_rate' || name === 'triggered_rate'
  const compareValue = isRate ? Math.round(value * 100) / 100 : value
  return compareValue >= t
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

// Prefer ACUITY_PERFORMANCE_API rows over MANUAL_BACKFILL for the same analyst+date --
// the two sources do genuinely overlap on some dates (backfill re-imports of trades the
// live webhook already captured), so counting both unconditionally double-counts. But the
// live feed has real outage gaps (e.g. all of July 2026) where NO API rows exist at all for
// a date that still has real backfill-sourced trades -- a blanket "API only" filter (the
// previous fix for the overlap problem) silently zeroes out those weeks instead. This picks
// the correct source per analyst+day rather than a single global rule.
//
// A day only counts as "API-covered" if the API row actually triggered -- most published
// API setups never trigger (triggered=false, result_r=null), and those aren't the same
// event as a MANUAL_BACKFILL row recording a real executed trade. Marking a day covered off
// an untriggered API row was discarding every real backfill trade for that day (confirmed:
// 132 of 136 API rows for 2026-07-27..07-31 were untriggered, so this was zeroing out 77 real
// backfill trades down to the 4 API rows that did trigger).
function preferApiPerDay(trades: ActualTrade[]): ActualTrade[] {
  const apiDatesByAnalyst = new Map<string, Set<string>>()
  for (const t of trades) {
    if (t.source_system === 'ACUITY_PERFORMANCE_API' && t.triggered && t.analyst_id && t.published_at) {
      const date = t.published_at.slice(0, 10)
      if (!apiDatesByAnalyst.has(t.analyst_id)) apiDatesByAnalyst.set(t.analyst_id, new Set())
      apiDatesByAnalyst.get(t.analyst_id)!.add(date)
    }
  }
  return trades.filter(t => {
    if (t.source_system === 'ACUITY_PERFORMANCE_API') return true
    if (!t.analyst_id || !t.published_at) return true
    const apiDates = apiDatesByAnalyst.get(t.analyst_id)
    return !apiDates?.has(t.published_at.slice(0, 10))
  })
}

function shadowResultR(outcome: ShadowOutcome): number | null {
  if (outcome.result_r !== null) return outcome.result_r
  if (outcome.trade_outcome_status === 'TARGET_HIT') return outcome.shadow_trade?.rr ?? null
  if (outcome.trade_outcome_status === 'STOP_HIT') return -1
  if (outcome.trade_outcome_status === 'CLOSED_PROFIT' || outcome.trade_outcome_status === 'CLOSED_LOSS') return outcome.result_r
  return null
}

export function TeamPerformanceGrid({
  analysts, kpiData, currentMonthStart, lastMonthStart, shadowOutcomes, actualTrades, shadowOutcomesRecent,
  lastWeekPublications = [], lastWeekStart, lastWeekEnd, thisMonthPublications = []
}: TeamPerformanceGridProps) {
  const [period, setPeriod] = useState<Period>('THIS_MONTH')

  const activePeriodStart = period === 'LAST_MONTH' ? lastMonthStart : currentMonthStart

  // Filter trades by period. This Month and Last Week are live/in-progress periods computed
  // directly from actualTrades; Last Month is closed and read from the pre-aggregated
  // executive_kpis table via kpiData. Last Week used to hard-restrict to ACUITY_PERFORMANCE_API
  // only (on the assumption it's always within the live-feed-covered window), which silently
  // zeroed out any week that fell inside a live-feed outage (confirmed: all of July 2026 has
  // zero API-sourced actual_trades rows despite real MANUAL_BACKFILL trades existing) --
  // preferApiPerDay() picks the right source per analyst+day instead of one global rule, so
  // outage weeks still show their real (backfill-sourced) data.
  const periodTrades = period === 'LAST_WEEK'
    ? preferApiPerDay(actualTrades.filter(t =>
        t.published_at && t.published_at.slice(0, 10) >= lastWeekStart && t.published_at.slice(0, 10) <= lastWeekEnd
      ))
    : period === 'THIS_MONTH'
    ? actualTrades.filter(t => t.published_at && t.published_at.slice(0, 10) >= currentMonthStart)
    : actualTrades

  const periodPublications = period === 'LAST_WEEK' ? lastWeekPublications : thisMonthPublications

  const index = new Map<string, Map<string, KpiRow[]>>()
  for (const row of kpiData) {
    if (!index.has(row.analyst_id)) index.set(row.analyst_id, new Map())
    const byName = index.get(row.analyst_id)!
    if (!byName.has(row.kpi_name)) byName.set(row.kpi_name, [])
    byName.get(row.kpi_name)!.push(row)
  }

  // Team aggregate
  const teamAgg: Record<string, number[]> = {}
  const liveTeamAgg: Record<string, number[]> = {}

  if (period === 'LAST_MONTH') {
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
    // This Month / Last Week: compute live from raw trades per analyst. Total R and win rate
    // use all triggered trades regardless of source. Trigger rate numerator is restricted to
    // ACUITY_PERFORMANCE_API triggered trades for This Month (periodTrades there is an
    // unfiltered source mix); for Last Week, periodTrades has already been through
    // preferApiPerDay(), so `triggered` there IS the correct per-day-best-source set already
    // -- re-restricting to API-only on top of that would zero out the numerator for any week
    // that fell back to backfill data, undoing the fix above.
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
      const apiTriggered = period === 'LAST_WEEK' ? triggered : triggered.filter(t => t.source_system === 'ACUITY_PERFORMANCE_API')
      const pubTotal = periodPublications.filter(p => p.analyst_id === analyst.analyst_id).length
      const trigRate = pubTotal > 0 ? apiTriggered.length / pubTotal : null
      if (triggered.length > 0) {
        if (!liveTeamAgg['total_return_r']) liveTeamAgg['total_return_r'] = []
        liveTeamAgg['total_return_r'].push(totalR)
        if (winRate !== null) {
          if (!liveTeamAgg['win_rate']) liveTeamAgg['win_rate'] = []
          liveTeamAgg['win_rate'].push(winRate)
        }
        if (trigRate !== null) {
          if (!liveTeamAgg['triggered_rate']) liveTeamAgg['triggered_rate'] = []
          liveTeamAgg['triggered_rate'].push(trigRate)
        }
      }
    }
  }

  const displayAgg = period === 'LAST_MONTH' ? teamAgg : liveTeamAgg

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

  // Shadow System Performance (last 30 days) -- live from shadow_trade_outcomes, same status
  // membership as the Shadow Benchmark card above and ShadowMonitoringPanel.tsx, in place of
  // the old executive_kpis(kpi_visibility='INTERNAL_ONLY') read (that showed 0R for the
  // current month whenever the shadow KPI batch hadn't run yet that month).
  const shadowRecentSafe = shadowOutcomesRecent ?? []
  const shadowRecentTriggered = shadowRecentSafe.filter(o =>
    ['TARGET_HIT', 'STOP_HIT', 'CLOSED_PROFIT', 'CLOSED_LOSS'].includes(o.trade_outcome_status)
  )
  const shadowRecentWins = shadowRecentSafe.filter(o =>
    o.trade_outcome_status === 'TARGET_HIT' ||
    o.trade_outcome_status === 'CLOSED_PROFIT' ||
    (o.result_r !== null && Number(o.result_r) > 0)
  )
  const shadowRecentWinRate = shadowRecentTriggered.length > 0 ? shadowRecentWins.length / shadowRecentTriggered.length : null
  const shadowRecentTriggerRate = shadowRecentSafe.length > 0 ? shadowRecentTriggered.length / shadowRecentSafe.length : null
  const shadowRecentTotalR = shadowRecentTriggered.reduce((s, o) => s + (shadowResultR(o) ?? 0), 0)

  // Max drawdown over the same 30-day triggered sequence, ordered by date -- same
  // peak-to-trough method as lib/metrics.ts's maxDrawdown(), inlined here for the
  // ShadowOutcome shape rather than MetricsTrade.
  const shadowRecentSorted = [...shadowRecentTriggered].sort((a, b) =>
    (a.shadow_trade?.generated_at ?? '').localeCompare(b.shadow_trade?.generated_at ?? '')
  )
  let shadowRecentEquity = 0, shadowRecentPeak = 0, shadowRecentDrawdown = 0
  for (const o of shadowRecentSorted) {
    shadowRecentEquity += shadowResultR(o) ?? 0
    if (shadowRecentEquity > shadowRecentPeak) shadowRecentPeak = shadowRecentEquity
    else if (shadowRecentEquity - shadowRecentPeak < shadowRecentDrawdown) shadowRecentDrawdown = shadowRecentEquity - shadowRecentPeak
  }

  const shadowRecentTiles: Record<string, number | null> = {
    total_return_r: shadowRecentTotalR,
    win_rate: shadowRecentWinRate,
    triggered_rate: shadowRecentTriggerRate,
    max_drawdown: shadowRecentDrawdown,
  }

  // Daily cumulative R trend for the last 30 days -- replaces the old monthly
  // executive_kpis trend, since the live calculation only has this rolling window to draw
  // from rather than multiple months of pre-aggregated history.
  const shadowReturnTrend = (() => {
    const byDate = new Map<string, number>()
    for (const o of shadowRecentTriggered) {
      const date = o.shadow_trade?.generated_at?.slice(0, 10)
      if (!date) continue
      byDate.set(date, (byDate.get(date) ?? 0) + (shadowResultR(o) ?? 0))
    }
    const sortedDates = [...byDate.keys()].sort()
    let cumulative = 0
    return sortedDates.map(date => {
      cumulative += byDate.get(date) ?? 0
      return { month: formatDateShort(date), value: cumulative }
    })
  })()

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
                const returnTrend = trendData(analyst.analyst_id, 'total_return_r')

                if (period !== 'LAST_MONTH') {
                  const trades = periodTrades.filter(t => t.analyst_id === analyst.analyst_id)
                  const triggered = trades.filter(t => t.triggered && t.result_r !== null)
                  const wins = triggered.filter(t => (t.result_r ?? 0) > 0)
                  const totalR = triggered.reduce((s, t) => s + (t.result_r ?? 0), 0)
                  const winRate = triggered.length > 0 ? wins.length / triggered.length : null
                  const apiTriggered = period === 'LAST_WEEK' ? triggered : triggered.filter(t => t.source_system === 'ACUITY_PERFORMANCE_API')
                  const pubTotal = periodPublications.filter(p => p.analyst_id === analyst.analyst_id).length
                  const trigRate = pubTotal > 0 ? apiTriggered.length / pubTotal : null
                  const liveVals: Record<string, number | null> = {
                    total_return_r: triggered.length > 0 ? totalR : null,
                    win_rate: winRate,
                    triggered_rate: trigRate,
                    max_drawdown: null,
                    alignment_rate: null,
                  }
                  hasData = triggered.length > 0
                  analystKpis = KPI_COLS.map(col => {
                    const val = liveVals[col.name] ?? null
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

      {/* Shadow System Performance (last 30 days) */}
      {shadowRecentSafe.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Shadow System Performance <span className="text-xs font-normal text-muted-foreground">(Last 30 Days)</span></h2>
            <p className="text-xs text-muted-foreground mt-0.5">Internal benchmark &mdash; not visible to analysts</p>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {(['total_return_r', 'win_rate', 'triggered_rate', 'max_drawdown'] as const).map(kpiName => {
              const value = shadowRecentTiles[kpiName] ?? null
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
            <p className="text-xs text-muted-foreground mb-3">Daily Return (R) &mdash; Shadow System (Last 30 Days)</p>
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
