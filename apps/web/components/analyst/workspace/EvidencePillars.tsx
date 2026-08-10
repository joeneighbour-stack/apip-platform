import { formatR, formatPercent } from '@/lib/format'
import {
  evidenceTierSubtext, trendLabel, volatilityConditionLabel, priceLocationLabel, setupContext,
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
  const tier = row.evidenceTier
  const regime = row.regime
  const trend = regime ? trendLabel(regime.trendState, regime.adx14) : null
  const volatility = regime ? volatilityConditionLabel(regime.volatilityState, regime.atrPercentile) : null
  const priceLocation = regime
    ? priceLocationLabel(row.currentZone, row.preferredZone, row.direction, row.entryLow, row.entryHigh, row.currentPrice)
    : null
  const setup = regime ? setupContext(row.direction, regime.trendState, row.currentZone, row.preferredZone, regime.adx14) : null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
      <div className="sm:pr-6 sm:border-r sm:border-border space-y-2">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Your Historical Profile
          {tier.tier !== 'NONE' && <span className="normal-case tracking-normal text-foreground"> · {tier.label}</span>}
        </p>
        {tier.tier === 'NONE' ? (
          <p className="text-xs text-muted-foreground">No meaningful history available for this setup.</p>
        ) : (
          <div className="space-y-1">
            <MetricRow label="Win rate" value={formatPercent(tier.winRate)} />
            <MetricRow label="Expectancy" value={formatR(tier.avgR)} valueClass={tier.avgR >= 0 ? 'text-green-700' : 'text-red-700'} />
            <MetricRow
              label="Sample"
              value={tier.tier === 'REGIME'
                ? `${tier.tradeCount} trades across ${tier.marketCount} market${tier.marketCount === 1 ? '' : 's'}`
                : `${tier.tradeCount} trades`}
            />
            <p className="text-[11px] text-muted-foreground pt-0.5">{evidenceTierSubtext(tier, row.symbol)}</p>
          </div>
        )}
        {row.personalisation && (
          <p className="text-xs text-muted-foreground pt-1">{row.personalisation}</p>
        )}
      </div>

      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Today&apos;s Conditions</p>
        {regime && trend && volatility && priceLocation && setup ? (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Trend</p>
              <p className="text-sm font-medium">{trend.headline}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{trend.implication}</p>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Volatility</p>
              <p className="text-sm font-medium">{volatility.headline}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{volatility.implication}</p>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Price Location</p>
              <p className="text-sm font-medium">{priceLocation.headline}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{priceLocation.implication}</p>
            </div>

            <div className="pt-1 border-t border-border">
              <p className="text-xs text-muted-foreground">{setup}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Regime data updates each morning. Check back after 05:00 UTC.</p>
        )}
      </div>
    </div>
  )
}
