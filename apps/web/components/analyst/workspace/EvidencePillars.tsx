import { formatR, formatPercent } from '@/lib/format'
import {
  evidenceTierSubtext, trendLabel, volatilityConditionLabel, priceLocationLabel, setupContext,
} from '@/lib/workspaceUtils'
import { SuggestedTradeStructure } from './SuggestedTradeStructure'
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

// Colour scanning aids only -- none of these change what's shown, just how fast it
// reads. Near-zero expectancy (|avgR| < 0.01) stays neutral rather than green/red,
// since a coin-flip edge isn't meaningfully positive or negative.
function tierBadgeClass(tier: 'MARKET' | 'REGIME' | 'DIRECTION' | 'NONE'): string {
  if (tier === 'MARKET') return 'bg-blue-50 text-blue-700 border-blue-100'
  if (tier === 'REGIME') return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-gray-100 text-gray-600 border-gray-200'
}

function expectancyColorClass(avgR: number): string {
  if (Math.abs(avgR) < 0.01) return 'text-foreground'
  return avgR > 0 ? 'text-green-700' : 'text-red-600'
}

function winRateColorClass(winRate: number): string {
  if (winRate > 0.55) return 'text-green-700'
  if (winRate < 0.40) return 'text-red-600'
  return 'text-foreground'
}

function trendColorClass(trendState: string | null): string {
  if (trendState === 'TRENDING_UP') return 'text-[13px] font-medium text-green-700'
  if (trendState === 'TRENDING_DOWN') return 'text-[13px] font-medium text-red-600'
  if (trendState === 'MIXED') return 'text-[13px] font-medium text-amber-700'
  return 'text-[13px] font-medium'
}

// Maps priceLocationLabel()'s headline text to a dot colour -- "In range" (the
// function's own default/fallback case) reads closest to "near entry, not waiting
// on anything specific" of the four buckets given, so it takes the amber dot.
function priceLocationDotClass(headline: string): string {
  if (headline.startsWith('At entry')) return 'bg-green-500'
  if (headline.startsWith('Above entry') || headline.startsWith('Below entry')) return 'bg-blue-400'
  if (headline.startsWith('Extremely')) return 'bg-muted-foreground/30'
  return 'bg-amber-400'
}

// Section 5 -- the central justification, as two clearly-distinct columns.
// YOUR HISTORICAL PROFILE = why this setup may suit this analyst specifically.
// TODAY'S CONDITIONS = why the setup may make sense right now, objectively.
// A subtle vertical divider (not two separate bordered cards) keeps the pairing
// obvious without adding card nesting. Suggested Trade Structure lives at the
// bottom of the left column (moved out of MarketDetailCard's own stack) so the
// card doesn't leave a whitespace gap on the shorter side when the right
// column's regime content runs longer.
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
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Your Historical Profile</p>
        {tier.tier === 'NONE' ? (
          <p className="text-xs text-muted-foreground">No meaningful history available for this setup.</p>
        ) : (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${tierBadgeClass(tier.tier)}`}>
                {tier.tier}
              </span>
              <span className="text-xs font-medium text-foreground">{tier.label}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{evidenceTierSubtext(tier, row.symbol)}</p>
            <div className="space-y-1">
              <MetricRow label="Win rate" value={formatPercent(tier.winRate)} valueClass={winRateColorClass(tier.winRate)} />
              <MetricRow label="Expectancy" value={formatR(tier.avgR)} valueClass={expectancyColorClass(tier.avgR)} />
              <MetricRow
                label="Sample"
                value={tier.tier === 'REGIME'
                  ? `${tier.tradeCount} trades across ${tier.marketCount} market${tier.marketCount === 1 ? '' : 's'}`
                  : `${tier.tradeCount} trades`}
              />
            </div>
          </div>
        )}
        {row.personalisation && (
          <p className="text-xs text-muted-foreground pt-1">{row.personalisation}</p>
        )}
        <div className="pt-2">
          <SuggestedTradeStructure row={row} />
        </div>
      </div>

      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Today&apos;s Conditions</p>
        {regime && trend && volatility && priceLocation && setup ? (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Trend</p>
              <p className={trendColorClass(regime.trendState)}>{trend.headline}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{trend.implication}</p>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Volatility</p>
              <p className="text-sm font-medium">{volatility.headline}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{volatility.implication}</p>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Price Location</p>
              <div className="flex items-start gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${priceLocationDotClass(priceLocation.headline)}`} />
                <p className="text-sm font-medium">{priceLocation.headline}</p>
              </div>
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
