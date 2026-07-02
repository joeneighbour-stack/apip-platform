'use client'

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

interface TeamPerformanceGridProps {
  analysts: Analyst[]
  kpiData: KpiRow[]
  currentMonthStart: string
}

const TARGETS: Record<string, number> = {
  total_return_r: 0,
  win_rate: 0.45,
  triggered_rate: 0.35,
  max_drawdown: -10,
}

const MONTH_LABELS: Record<string, string> = {
  '2026-05-01': 'May', '2026-06-01': 'Jun', '2026-07-01': 'Jul',
  '2026-08-01': 'Aug', '2026-09-01': 'Sep', '2026-10-01': 'Oct',
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

function formatKpi(name: string, value: number | null): string {
  if (value === null) return '—'
  if (name === 'total_return_r') return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`
  if (name === 'win_rate' || name === 'triggered_rate' || name === 'alignment_rate')
    return `${Math.round(value * 100)}%`
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

export function TeamPerformanceGrid({ analysts, kpiData, currentMonthStart }: TeamPerformanceGridProps) {
  // Index kpiData: analyst_id -> kpi_name -> period_start -> value
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

  // Return trend data for a given analyst + kpi
  function trendData(analystId: string, kpiName: string) {
    const rows = index.get(analystId)?.get(kpiName) ?? []
    return rows
      .sort((a, b) => a.period_start.localeCompare(b.period_start))
      .map(r => ({ month: MONTH_LABELS[r.period_start] ?? r.period_start.slice(0, 7), value: getValue(r) }))
  }

  return (
    <div className="space-y-8">

      {/* Team summary row */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Team Summary — This Month</h2>
        <div className="grid grid-cols-5 gap-3">
          {KPI_COLS.map(col => {
            const vals = teamAgg[col.name] ?? []
            const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
            const onTarget = avg !== null ? isOnTarget(col.name, avg) : null
            return (
              <div key={col.name} className={`rounded-lg border p-4 ${
                onTarget === true ? 'border-green-200 bg-green-50/30' :
                onTarget === false ? 'border-red-200 bg-red-50/30' :
                'border-border bg-card'
              }`}>
                <p className="text-xs text-muted-foreground">{col.label}</p>
                <p className="text-xl font-semibold mt-1 tabular-nums">
                  {formatKpi(col.name, avg)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Team avg</p>
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
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">3-Month Return</th>
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
                  return { col, val, hit: val !== null ? isOnTarget(col.name, val) : null }
                })
                const allHit = currentKpis.every(k => k.hit === true)
                const anyMissed = currentKpis.some(k => k.hit === false)
                const hasData = currentKpis.some(k => k.val !== null)
                const returnTrend = trendData(analyst.analyst_id, 'total_return_r')

                return (
                  <tr key={analyst.analyst_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{analyst.display_name}</td>
                    {currentKpis.map(({ col, val, hit }) => (
                      <td key={col.name} className="px-4 py-3 tabular-nums">
                        <span className={
                          hit === true ? 'text-green-700 font-medium' :
                          hit === false ? 'text-red-700 font-medium' :
                          'text-muted-foreground'
                        }>
                          {formatKpi(col.name, val)}
                        </span>
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
    </div>
  )
}
