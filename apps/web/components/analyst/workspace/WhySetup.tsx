import { formatR, formatPercent } from '@/lib/format'
import {
  priceLocationRating, regimeFitRating, regimeFitInterpretation,
  historicalEvidenceRating, historicalEvidenceSummary, BLOCK_RATING_CLASS,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
  recommendationsGeneratedToday: number
  marketsAllocatedToday: number
}

function Block({ title, rating, children }: { title: string; rating: string | null; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground shrink-0">{title}</span>
      <span className="text-right">
        {rating && <span className={`font-medium ${BLOCK_RATING_CLASS[rating as keyof typeof BLOCK_RATING_CLASS] ?? 'text-muted-foreground'}`}>{rating} — </span>}
        <span className="text-foreground">{children}</span>
      </span>
    </div>
  )
}

// Compact evidence blocks -- one line each, rating + a short statement. The
// underlying numbers (win rate, ADX, expectancy...) live in their one primary
// location further down the card (Trade Plan / Market Conditions / Historical
// Evidence strip); this panel restates none of them, only the read on the evidence.
export function WhySetup({ row, recommendationsGeneratedToday, marketsAllocatedToday }: Props) {
  const hasZoneData = row.currentZone != null && row.preferredZone != null
  const hasRegimeData = row.regime?.trendState != null && row.regime?.adx14 != null
  const hasHistoryData = row.historicalEdge.avgR != null

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Why This Setup?</h3>

      <div className="space-y-1.5">
        {hasZoneData && (
          <Block title="Price location" rating={priceLocationRating(row.currentZone!, row.preferredZone!)}>
            {row.distanceLanguage ?? 'Zone position known, ATR distance unavailable.'}
          </Block>
        )}

        {hasRegimeData && (
          <Block title="Regime fit" rating={regimeFitRating(row.direction, row.regime!.trendState, row.regime!.adx14)}>
            {regimeFitInterpretation(row.direction, row.regime!.trendState, row.regime!.adx14)}
          </Block>
        )}

        <Block title="Historical evidence" rating={hasHistoryData ? historicalEvidenceRating(row.historicalEdge.avgR!) : null}>
          {hasHistoryData
            ? historicalEvidenceSummary(row.historicalEdge.avgR!, row.historicalEdge.quality, row.historicalEdge.trades, row.historicalEdge.tier)
            : 'No trade history yet for this market.'}
        </Block>

        <Block title="Why you're seeing this" rating={null}>
          {row.personalisation ?? 'Assigned based on today’s conditions and your coverage profile.'}
        </Block>
      </div>

      <div className="pt-2 border-t border-border/60 space-y-1">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">How This Was Selected</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{recommendationsGeneratedToday}</span> recommendations generated today ·{' '}
          <span className="font-medium tabular-nums text-foreground">{marketsAllocatedToday}</span> allocated to you
        </p>
        {row.expectedR != null && row.triggerProbability != null && (
          <p className="text-xs text-muted-foreground">
            Selected by expected value: <span className="font-medium tabular-nums text-foreground">{formatR(row.expectedR)}</span> at{' '}
            <span className="font-medium tabular-nums text-foreground">{formatPercent(row.triggerProbability)}</span> trigger probability
          </p>
        )}
      </div>
    </div>
  )
}
