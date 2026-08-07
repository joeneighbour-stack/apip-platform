import {
  regimeTrendLabel, volatilityLabel, volatilityTooltip, confidenceBadgeLabel, marketConditionsInterpretation,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

// Section 6 -- trend / volatility / confidence, plus a one-line interpretation
// that only ever states what the data actually supports (never a hardcoded
// positive read).
export function MarketConditionsCard({ row }: Props) {
  const regime = row.regime
  const interpretation = regime
    ? marketConditionsInterpretation(row.direction, row.currentZone, row.preferredZone, regime.trendState, regime.adx14, regime.atrPercentile)
    : null

  return (
    <div className="border-border bg-card rounded-lg p-3">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Market Conditions</p>
      {regime ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Trend</span>
            <span className="text-sm font-medium tabular-nums">
              {regimeTrendLabel(regime.trendState, regime.adx14)}
              {regime.adx14 != null && <span className="text-muted-foreground font-normal"> · ADX {regime.adx14.toFixed(0)}</span>}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Volatility</span>
            <span className="text-sm font-medium cursor-help" title={volatilityTooltip(regime.atrPercentile)}>
              {volatilityLabel(regime.atrPercentile)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Confidence</span>
            <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] border ${
              regime.confidence === 'HIGH' ? 'bg-green-50 border-green-200 text-green-800'
                : regime.confidence === 'MEDIUM' ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-muted border-border text-muted-foreground'
            }`}>
              {confidenceBadgeLabel(regime.confidence)}
            </span>
          </div>
          {interpretation && <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/60 mt-1.5">{interpretation}</p>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Regime data updates each morning. Check back after 05:00 UTC.</p>
      )}
    </div>
  )
}
