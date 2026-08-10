import {
  todaysConditionsRating, evidenceTierClause, recommendationSynthesis,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

// Section 4 -- the core intelligence section. Leads with the evidence tier's
// own template clause (MARKET/REGIME/DIRECTION/NONE), then a plain factual
// statement of today's conditions. Never hedges about how much to trust the
// numbers shown -- built from recommendationSynthesis(), which states
// conflicting evidence honestly rather than apologising for it.
export function RecommendationSynthesis({ row }: Props) {
  const conditionsRating = todaysConditionsRating(row.direction, row.currentZone, row.preferredZone, row.regime?.trendState ?? null, row.regime?.adx14 ?? null)
  const tierClause = evidenceTierClause(row.evidenceTier, row.direction, row.assetClass, row.symbol)
  const synthesis = recommendationSynthesis(
    row.evidenceTier, tierClause, conditionsRating, row.regime?.trendState ?? null, row.regime?.adx14 ?? null,
  )

  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Why This Is Being Recommended</p>
      <p className="text-sm text-foreground mt-1 leading-relaxed">{synthesis}</p>
    </div>
  )
}
