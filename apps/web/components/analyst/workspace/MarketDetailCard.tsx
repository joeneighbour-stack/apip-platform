import { PrimaryRecommendation } from './PrimaryRecommendation'
import { MarketContext } from './MarketContext'
import { MajorEventWarning } from './MajorEventWarning'
import { RecommendationSynthesis } from './RecommendationSynthesis'
import { EvidencePillars } from './EvidencePillars'
import { SuggestedTradeStructure } from './SuggestedTradeStructure'
import { SupportingEvidence } from './SupportingEvidence'
import { FeedbackButtons } from './FeedbackButtons'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
  newsHeadline: string | null
  recommendationsGeneratedToday: number
  marketsAllocatedToday: number
}

// Concise professional recommendation brief -- readable in ~5-10 seconds.
// Primary recommendation -> market context -> event risk (only when material) ->
// why this is being recommended -> two evidence pillars (historical profile /
// today's conditions) -> suggested trade structure -> supporting evidence
// (collapsed by default). No chart -- analysts already have TradingView for
// that; this card's value is opportunity selection, analyst-specific evidence,
// objective conditions, and a starting structure, not charting.
export function MarketDetailCard({ row, newsHeadline, recommendationsGeneratedToday, marketsAllocatedToday }: Props) {
  return (
    <div className="border-t border-border bg-muted/20 p-5 space-y-4">
      <PrimaryRecommendation row={row} />
      <MarketContext newsHeadline={newsHeadline} />
      <MajorEventWarning eventRiskItems={row.eventRiskItems} />
      <RecommendationSynthesis row={row} />
      <EvidencePillars row={row} />
      <SuggestedTradeStructure row={row} />
      <SupportingEvidence
        row={row}
        recommendationsGeneratedToday={recommendationsGeneratedToday}
        marketsAllocatedToday={marketsAllocatedToday}
      />
      <div className="pt-1 border-t border-border/60">
        <FeedbackButtons opportunityId={row.opportunityId} />
      </div>
    </div>
  )
}
