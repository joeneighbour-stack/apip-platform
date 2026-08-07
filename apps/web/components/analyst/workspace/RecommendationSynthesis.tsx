import {
  formatSymbolForDisplay, historicalProfileRating, todaysConditionsRating, recommendationSynthesis,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

// Section 4 -- the core intelligence section. One or two sentences synthesising
// the two evidence pillars below. Never manufactures a positive read: built from
// recommendationSynthesis(), which states mixed/negative evidence honestly rather
// than defaulting to an upbeat tone.
export function RecommendationSynthesis({ row }: Props) {
  const symbolDisplay = formatSymbolForDisplay(row.symbol, row.assetClass)
  const historicalRating = historicalProfileRating(row.historicalEdge.avgR, row.historicalEdge.winRate, row.historicalEdge.quality, row.historicalEdge.trades)
  const conditionsRating = todaysConditionsRating(row.direction, row.currentZone, row.preferredZone, row.regime?.trendState ?? null, row.regime?.adx14 ?? null)
  const synthesis = recommendationSynthesis(symbolDisplay, row.direction, historicalRating, conditionsRating, row.regime?.trendState ?? null, row.regime?.adx14 ?? null)

  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Why This Is Being Recommended</p>
      <p className="text-sm text-foreground mt-1 leading-relaxed">{synthesis}</p>
    </div>
  )
}
