'use client'

interface Kpi {
  kpi_name: string
  kpi_value: any
  period_start: string
  period_end: string
  includes_historical_backfill: boolean
  requires_recommendation_version?: boolean
}

interface KpiSummaryProps {
  kpis: Kpi[]
  kpiTrend: Kpi[]
}

// KPIs we display on the analyst performance page -- in priority order
const KPI_CONFIG = [
  {
    name: 'average_r',
    label: 'Average R',
    format: (v: any) => `${Number(v).toFixed(2)}R`,
    description: 'Average R-multiple across all trades this month',
    requiresBackfill: false,
  },
  {
    name: 'win_rate',
    label: 'Win Rate',
    format: (v: any) => `${Math.round(Number(v) * 100)}%`,
    description: 'Percentage of triggered trades that closed in profit',
    requiresBackfill: false,
  },
  {
    name: 'alignment_rate',
    label: 'Alignment Rate',
    format: (v: any) => `${Math.round(Number(v) * 100)}%`,
    description: 'How often your trades matched the coaching recommendation shown',
    requiresBackfill: true, // only valid for post-platform trades
  },
  {
    name: 'max_drawdown',
    label: 'Max Drawdown',
    format: (v: any) => `${Number(v).toFixed(2)}R`,
    description: 'Largest peak-to-trough R loss sequence this month',
    requiresBackfill: false,
  },
]

function TrendIndicator({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return null
  const diff = current - previous
  if (Math.abs(diff) < 0.001) return <span className="text-xs text-muted-foreground">→</span>
  return diff > 0
    ? <span className="text-xs text-green-600">↑ {Math.abs(diff).toFixed(2)}</span>
    : <span className="text-xs text-red-600">↓ {Math.abs(diff).toFixed(2)}</span>
}

export function KpiSummary({ kpis, kpiTrend }: KpiSummaryProps) {
  // Index current month KPIs by name
  const kpiByName = new Map(kpis.map(k => [k.kpi_name, k]))

  // Get previous month value for each KPI from trend data
  function getPrevious(name: string): number | null {
    const history = kpiTrend.filter(k => k.kpi_name === name)
    if (history.length < 2) return null
    const prev = history[history.length - 2]
    const val = prev?.kpi_value
    if (val === null || val === undefined) return null
    return typeof val === 'object' ? val.value ?? null : Number(val)
  }

  const hasAnyData = kpis.length > 0

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">This Month's KPIs</h2>
        {!hasAnyData && (
          <span className="text-xs text-muted-foreground">
            Populates once the engine has run for this month
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {KPI_CONFIG.map((config) => {
          const kpi = kpiByName.get(config.name)
          const rawValue = kpi?.kpi_value
          const value = rawValue !== undefined && rawValue !== null
            ? (typeof rawValue === 'object' ? rawValue.value : rawValue)
            : null
          const previousValue = getPrevious(config.name)

          return (
            <div key={config.name}
              className="rounded-lg border border-border bg-card p-4 space-y-2">
              <p className="text-xs text-muted-foreground">{config.label}</p>
              {value !== null ? (
                <div className="flex items-end justify-between gap-2">
                  <p className="text-2xl font-semibold tabular-nums">
                    {config.format(value)}
                  </p>
                  <TrendIndicator current={Number(value)} previous={previousValue} />
                </div>
              ) : (
                <p className="text-lg text-muted-foreground">—</p>
              )}
              <p className="text-xs text-muted-foreground leading-tight">{config.description}</p>
              {config.requiresBackfill && (
                <p className="text-xs text-amber-600">Post-platform trades only</p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
