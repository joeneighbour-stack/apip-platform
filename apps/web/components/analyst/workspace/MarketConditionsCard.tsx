import {
  regimeTrendLabel, volatilityLabel, volatilityTooltip, confidenceBadgeLabel, marketConditionsInterpretation,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

// One compact column within the shared ROW3 strip (see MarketDetailCard). Trend/
// volatility/confidence collapse onto one line -- this is the ONE place these
// numbers are shown (Why This Setup's Regime Fit block only states the read on
// them, not the numbers themselves).
export function MarketConditionsCard({ row }: Props) {
  const regime = row.regime
  const interpretation = regime
    ? marketConditionsInterpretation(row.direction, row.currentZone, row.preferredZone, regime.trendState, regime.adx14, regime.atrPercentile)
    : null

  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Market Conditions</p>
      {regime ? (
        <div className="text-xs">
          <p className="tabular-nums">
            <span className="font-medium">{regimeTrendLabel(regime.trendState, regime.adx14)}</span>
            {regime.adx14 != null && <span className="text-muted-foreground"> · ADX {regime.adx14.toFixed(0)}</span>}
            <span className="text-muted-foreground"> · Vol </span>
            <span className="font-medium cursor-help" title={volatilityTooltip(regime.atrPercentile)}>{volatilityLabel(regime.atrPercentile)}</span>
            <span className="text-muted-foreground"> · Conf </span>
            <span className={`font-medium ${
              regime.confidence === 'HIGH' ? 'text-green-700' : regime.confidence === 'MEDIUM' ? 'text-amber-600' : 'text-muted-foreground'
            }`}>{confidenceBadgeLabel(regime.confidence)}</span>
          </p>
          {interpretation && <p className="text-muted-foreground mt-0.5">{interpretation}</p>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Regime data updates each morning. Check back after 05:00 UTC.</p>
      )}
    </div>
  )
}
