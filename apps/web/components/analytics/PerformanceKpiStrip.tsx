import { Tooltip } from '@/components/ui/Tooltip'
import type { PerformanceSummary } from '@/lib/metrics'
import { formatR, formatPercent, positivityClass } from '@/lib/format'

interface Props {
  summary: PerformanceSummary
  previous: PerformanceSummary | null
  comparisonLabel: string
}

type MetricKey = 'totalR' | 'maxDrawdown' | 'avgR' | 'winRate' | 'triggeredCount' | 'profitFactor' | 'payoutRatio' | 'breakEvenWinRate'

const METRIC_DEFS: { key: MetricKey; label: string; tip: string }[] = [
  { key: 'totalR', label: 'Total R', tip: 'Sum of realised R across all triggered recommendations with a closed result.' },
  { key: 'maxDrawdown', label: 'Max Drawdown', tip: 'Largest peak-to-trough decline in cumulative R over the period.' },
  { key: 'avgR', label: 'Avg R / Trade', tip: 'Total R divided by the number of triggered trades.' },
  { key: 'winRate', label: 'Win Rate', tip: 'Share of triggered trades that closed with a positive result.' },
  { key: 'triggeredCount', label: 'Triggered Trades', tip: 'Recommendations that triggered and closed with a result in the period.' },
  { key: 'profitFactor', label: 'Profit Factor', tip: 'Gross gains divided by gross losses across triggered trades.' },
  { key: 'payoutRatio', label: 'Payout Ratio', tip: 'Average winning trade divided by average losing trade (absolute value). A ratio of 2.0 means winners are twice the size of losers.' },
  { key: 'breakEvenWinRate', label: 'Break-Even Win Rate', tip: 'Minimum win rate needed to be profitable at the current payout ratio. Your actual win rate above this line is your edge.' },
]

function formatValue(key: MetricKey, value: number | null): string {
  if (key === 'totalR' || key === 'maxDrawdown' || key === 'avgR') return formatR(value)
  if (key === 'winRate' || key === 'breakEvenWinRate') return formatPercent(value)
  if (key === 'triggeredCount') return value == null ? '—' : value.toLocaleString()
  return value == null ? '—' : value.toFixed(2)
}

function formatDelta(key: MetricKey, delta: number): string {
  if (key === 'totalR' || key === 'maxDrawdown' || key === 'avgR') return formatR(delta)
  if (key === 'winRate' || key === 'breakEvenWinRate') return `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}pp`
  if (key === 'triggeredCount') return `${delta >= 0 ? '+' : ''}${delta}`
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`
}

export function PerformanceKpiStrip({ summary, previous, comparisonLabel }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      {METRIC_DEFS.map(def => {
        const value = summary[def.key]
        const prevValue = previous ? previous[def.key] : null
        const delta = value != null && prevValue != null ? value - prevValue : null
        const isMagnitude = def.key === 'triggeredCount' || def.key === 'profitFactor' || def.key === 'payoutRatio'
        const colourValue = def.key === 'breakEvenWinRate' ? (value != null ? -value : null) : value
        return (
          <div key={def.key} className="rounded-lg border border-border bg-card p-4">
            <Tooltip content={def.tip}>
              <p className="text-xs text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40 inline-block">
                {def.label}
              </p>
            </Tooltip>
            <p className={`text-xl font-semibold tabular-nums mt-1 ${isMagnitude ? '' : positivityClass(colourValue)}`}>
              {formatValue(def.key, value)}
            </p>
            {delta != null && (
              <p className={`text-xs mt-1 tabular-nums ${positivityClass(def.key === 'breakEvenWinRate' ? -delta : delta)}`}>
                {formatDelta(def.key, delta)} {comparisonLabel}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}