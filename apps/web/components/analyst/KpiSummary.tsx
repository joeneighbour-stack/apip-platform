'use client'

import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts'

interface Kpi {
  kpi_name: string
  kpi_value: any
  period_start: string
  period_end: string
}

interface KpiSummaryProps {
  kpis: Kpi[]
  kpiTrend: Kpi[]
}

const TARGETS: Record<string, { target: number; direction: 'above' | 'below'; format: (v: number) => string; label: string }> = {
  total_return_r:  { target: 0,    direction: 'above', format: v => `${v > 0 ? '+' : ''}${v.toFixed(2)}R`, label: 'Target: >0R' },
  win_rate:        { target: 0.45, direction: 'above', format: v => `${Math.round(v * 100)}%`,             label: 'Target: >45%' },
  triggered_rate:  { target: 0.35, direction: 'above', format: v => `${Math.round(v * 100)}%`,             label: 'Target: >35%' },
  max_drawdown:    { target: -10,  direction: 'above', format: v => `${v.toFixed(2)}R`,                    label: 'Limit: >-10R' },
}

function isOnTarget(kpiName: string, value: number): boolean {
  const t = TARGETS[kpiName]
  if (!t) return true
  return t.direction === 'above' ? value >= t.target : value <= t.target
}

const MONTH_LABELS: Record<string, string> = {
  '2026-05-01': 'May', '2026-06-01': 'Jun', '2026-07-01': 'Jul',
  '2026-08-01': 'Aug', '2026-09-01': 'Sep', '2026-10-01': 'Oct',
  '2026-11-01': 'Nov', '2026-12-01': 'Dec', '2026-01-01': 'Jan',
  '2026-02-01': 'Feb', '2026-03-01': 'Mar', '2026-04-01': 'Apr',
}

function monthLabel(period_start: string) {
  return MONTH_LABELS[period_start] ?? period_start.slice(0, 7)
}

function getValue(kpi: Kpi | undefined): number | null {
  if (!kpi) return null
  const v = kpi.kpi_value
  return typeof v === 'object' ? (v.value ?? null) : Number(v)
}

function trendData(allKpis: Kpi[], name: string, limitMonths = 12) {
  const months = [...new Set(allKpis.map(k => k.period_start))].sort()
  const recentMonths = months.slice(-limitMonths)
  return recentMonths.map(month => {
    const kpi = allKpis.find(k => k.kpi_name === name && k.period_start === month)
    return { month: monthLabel(month), value: getValue(kpi) }
  })
}

interface KpiCardProps {
  kpiName: string
  label: string
  value: number | null
  formatted: string | null
  description: string
  chart: React.ReactNode
}

function KpiCard({ kpiName, label, value, formatted, description, chart }: KpiCardProps) {
  const onTarget = value !== null ? isOnTarget(kpiName, value) : null
  const target = TARGETS[kpiName]

  return (
    <div className={`rounded-lg border bg-card p-4 space-y-3 ${
      onTarget === true ? 'border-green-200' :
      onTarget === false ? 'border-red-200' :
      'border-border'
    }`}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          {onTarget !== null && (
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
              onTarget ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {onTarget ? '✓ On target' : '✗ Off target'}
            </span>
          )}
        </div>
        <p className={`text-2xl font-semibold tabular-nums mt-1 ${
          onTarget === false ? 'text-red-700' : onTarget === true ? 'text-green-700' : ''
        }`}>
          {formatted ?? <span className="text-muted-foreground text-lg">—</span>}
        </p>
        <p className="text-xs text-muted-foreground mt-1 leading-tight">{description}</p>
        {target && <p className="text-xs text-muted-foreground/70 mt-0.5">{target.label}</p>}
      </div>
      <div className="h-16">{chart}</div>
    </div>
  )
}

function KpiHistoryTable({ kpiTrend }: { kpiTrend: Kpi[] }) {
  const months = [...new Set(kpiTrend.map(k => k.period_start))].sort().reverse()
  const kpiNames = ['total_return_r', 'win_rate', 'triggered_rate', 'max_drawdown']
  const kpiLabels: Record<string, string> = {
    total_return_r: 'Return (R)', win_rate: 'Win Rate',
    triggered_rate: 'Triggered', max_drawdown: 'Drawdown'
  }

  if (months.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">KPI History</h2>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Month</th>
              {kpiNames.map(name => (
                <th key={name} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                  {kpiLabels[name]}
                </th>
              ))}
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {months.map(month => {
              const kpiMap = new Map(
                kpiTrend.filter(k => k.period_start === month).map(k => [k.kpi_name, k])
              )
              const results = kpiNames.map(name => {
                const val = getValue(kpiMap.get(name))
                const hit = val !== null ? isOnTarget(name, val) : null
                const t = TARGETS[name]
                return { name, val, hit, formatted: val !== null && t ? t.format(val) : '—' }
              })
              const allHit = results.every(r => r.hit === true)
              const anyMissed = results.some(r => r.hit === false)
              const hasData = results.some(r => r.val !== null)

              return (
                <tr key={month} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 font-medium">{monthLabel(month)}</td>
                  {results.map(r => (
                    <td key={r.name} className="px-4 py-2.5 tabular-nums">
                      <span className={r.hit === true ? 'text-green-700' : r.hit === false ? 'text-red-700' : 'text-muted-foreground'}>
                        {r.formatted}
                      </span>
                    </td>
                  ))}
                  <td className="px-4 py-2.5">
                    {!hasData ? (
                      <span className="text-xs text-muted-foreground">No data</span>
                    ) : allHit ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">All targets hit</span>
                    ) : anyMissed ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700">Missed targets</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Partial</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function KpiSummary({ kpis, kpiTrend }: KpiSummaryProps) {
  const latestMonth = kpiTrend.length > 0
    ? kpiTrend[kpiTrend.length - 1]!.period_start
    : null
  const currentMonthKpis = kpis.length > 0
    ? kpis
    : kpiTrend.filter(k => k.period_start === latestMonth)
  const byName = new Map(currentMonthKpis.map(k => [k.kpi_name, k]))

  const returnR   = getValue(byName.get('total_return_r'))
  const winRate   = getValue(byName.get('win_rate'))
  const triggered = getValue(byName.get('triggered_rate'))
  const drawdown  = getValue(byName.get('max_drawdown'))
  const hasData   = currentMonthKpis.length > 0
  const tradeCount = byName.get('total_return_r')?.kpi_value?.trade_count ?? null

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">This Month's KPIs</h2>
          {hasData && tradeCount &&
            <span className="text-xs text-muted-foreground">{tradeCount} trades this month</span>}
        </div>

        {!hasData ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">No trades recorded this month yet.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">KPIs will update once trades are imported for the current month.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">

            <KpiCard
              kpiName="total_return_r"
              label="Return (R)"
              value={returnR}
              formatted={returnR !== null ? `${returnR > 0 ? '+' : ''}${returnR.toFixed(2)}R` : null}
              description="Sum of all R-multiples this month"
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData(kpiTrend, 'total_return_r')} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}R`, 'Return']} contentStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke="hsl(var(--border))" />
                    <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                      {trendData(kpiTrend, 'total_return_r').map((entry, i) => (
                        <Cell key={i} fill={entry.value !== null && entry.value >= 0 ? '#22c55e' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              }
            />

            <KpiCard
              kpiName="win_rate"
              label="Win Rate"
              value={winRate}
              formatted={winRate !== null ? `${Math.round(winRate * 100)}%` : null}
              description={`${byName.get('win_rate')?.kpi_value?.wins ?? '—'} wins from ${byName.get('win_rate')?.kpi_value?.triggered ?? '—'} triggered trades`}
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData(kpiTrend, 'win_rate')} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis hide domain={[0, 1]} />
                    <Tooltip formatter={(v: any) => [`${Math.round(Number(v) * 100)}%`, 'Win Rate']} contentStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0.45} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              }
            />

            <KpiCard
              kpiName="triggered_rate"
              label="Triggered Rate"
              value={triggered}
              formatted={triggered !== null ? `${Math.round(triggered * 100)}%` : null}
              description={`${byName.get('triggered_rate')?.kpi_value?.triggered ?? '—'} of ${byName.get('triggered_rate')?.kpi_value?.total_setups ?? '—'} setups triggered`}
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData(kpiTrend, 'triggered_rate')} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis hide domain={[0, 1]} />
                    <Tooltip formatter={(v: any) => [`${Math.round(Number(v) * 100)}%`, 'Triggered']} contentStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0.35} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              }
            />

            <KpiCard
              kpiName="max_drawdown"
              label="Max Drawdown"
              value={drawdown}
              formatted={drawdown !== null ? `${drawdown.toFixed(2)}R` : null}
              description={`${byName.get('max_drawdown')?.kpi_value?.sequence_length ?? '—'} consecutive losses`}
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData(kpiTrend, 'max_drawdown')} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}R`, 'Drawdown']} contentStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={-10} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <ReferenceLine y={0} stroke="hsl(var(--border))" />
                    <Bar dataKey="value" radius={[2, 2, 0, 0]} fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              }
            />

          </div>
        )}
      </section>

      <KpiHistoryTable kpiTrend={kpiTrend} />
    </div>
  )
}
