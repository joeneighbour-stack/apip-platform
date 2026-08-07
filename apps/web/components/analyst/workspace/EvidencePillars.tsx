import { formatR, formatPercent } from '@/lib/format'
import {
  historicalProfileRating, HISTORICAL_RATING_CLASS, todaysConditionsRating, CONDITIONS_RATING_CLASS,
  regimeTrendLabel, volatilityLabel, volatilityTooltip, zonePlainLabel,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

function MetricRow({ label, value, valueClass }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass ?? 'text-foreground'}`}>{value}</span>
    </div>
  )
}

// Section 5 -- the central justification, as two clearly-distinct columns.
// YOUR HISTORICAL PROFILE = why this setup may suit this analyst specifically.
// TODAY'S CONDITIONS = why the setup may make sense right now, objectively.
// A subtle vertical divider (not two separate bordered cards) keeps the pairing
// obvious without adding card nesting.
export function EvidencePillars({ row }: Props) {
  const edge = row.historicalEdge
  const historicalRating = historicalProfileRating(edge.avgR, edge.winRate, edge.quality, edge.trades)
  const regime = row.regime
  const conditionsRating = todaysConditionsRating(row.direction, row.currentZone, row.preferredZone, regime?.trendState ?? null, regime?.adx14 ?? null)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
      <div className="sm:pr-6 sm:border-r sm:border-border space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Your Historical Profile</p>
          {historicalRating && <span className={`text-xs font-semibold ${HISTORICAL_RATING_CLASS[historicalRating]}`}>{historicalRating}</span>}
        </div>
        {edge.trades > 0 ? (
          <div className="space-y-1">
            <MetricRow label="Win rate" value={formatPercent(edge.winRate)} />
            <MetricRow label="Expectancy" value={formatR(edge.avgR)} valueClass={(edge.avgR ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'} />
            <MetricRow label="Sample" value={`${edge.trades} trades`} />
            <MetricRow label="Evidence quality" value={edge.quality ?? '—'} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No trade history yet for this market.</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Today&apos;s Conditions</p>
          {conditionsRating && <span className={`text-xs font-semibold ${CONDITIONS_RATING_CLASS[conditionsRating]}`}>{conditionsRating}</span>}
        </div>
        {regime ? (
          <div className="space-y-1">
            <MetricRow label="Trend" value={regimeTrendLabel(regime.trendState, regime.adx14)} />
            <MetricRow label="ADX" value={regime.adx14 != null ? regime.adx14.toFixed(0) : '—'} />
            <MetricRow
              label="Volatility"
              value={<span className="cursor-help" title={volatilityTooltip(regime.atrPercentile)}>{volatilityLabel(regime.atrPercentile)}</span>}
            />
            <MetricRow label="Current location" value={zonePlainLabel(row.currentZone)} />
            <MetricRow label="Preferred entry" value={zonePlainLabel(row.preferredZone)} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Regime data updates each morning. Check back after 05:00 UTC.</p>
        )}
      </div>
    </div>
  )
}
