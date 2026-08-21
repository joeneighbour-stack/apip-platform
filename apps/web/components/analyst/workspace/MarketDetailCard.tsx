import { PrimaryRecommendation } from './PrimaryRecommendation'
import { MarketContext } from './MarketContext'
import { MajorEventWarning } from './MajorEventWarning'
import { RecommendationSynthesis } from './RecommendationSynthesis'
import { EvidencePillars } from './EvidencePillars'
import { SupportingEvidence } from './SupportingEvidence'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
  newsHeadline: string | null
  recommendationsGeneratedToday: number
  marketsAllocatedToday: number
}

// Concise professional recommendation brief -- readable in ~5-10 seconds.
// Primary recommendation -> market context -> event risk (only when material) ->
// why this is being recommended -> two evidence pillars (historical profile,
// including its own Suggested Trade Structure at the bottom / today's
// conditions) -> more detail (collapsed by default). No chart -- analysts
// already have TradingView for that; this card's value is opportunity
// selection, analyst-specific evidence, objective conditions, and a starting
// structure, not charting.
export function MarketDetailCard({ row, newsHeadline, recommendationsGeneratedToday, marketsAllocatedToday }: Props) {
  return (
    <div className="border-t border-border bg-muted/20 p-5 space-y-4 text-center">
      <PrimaryRecommendation row={row} />
      <MarketContext newsHeadline={newsHeadline} />
      <MajorEventWarning eventRiskItems={row.eventRiskItems} />
      <RecommendationSynthesis row={row} />
      <EvidencePillars row={row} />
      <SupportingEvidence
        row={row}
        recommendationsGeneratedToday={recommendationsGeneratedToday}
        marketsAllocatedToday={marketsAllocatedToday}
      />
    </div>
  )
}
