import { RecommendationHeader } from './RecommendationHeader'
import { MajorEventWarning } from './MajorEventWarning'
import { ZoneStrip } from './ZoneStrip'
import { TradeContextChart } from './TradeContextChart'
import { WhySetup } from './WhySetup'
import { TradePlanCard } from './TradePlanCard'
import { MarketConditionsCard } from './MarketConditionsCard'
import { HistoricalEvidenceCard } from './HistoricalEvidenceCard'
import { PreviousSessionStrip } from './PreviousSessionStrip'
import { DetailedEvents } from './DetailedEvents'
import { FeedbackButtons } from './FeedbackButtons'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
  newsHeadline: string | null
  recommendationsGeneratedToday: number
  marketsAllocatedToday: number
}

// Institutional recommendation card -- ROW1: header + event warning. ROW2: trade
// context chart (65%) / Why This Setup (35%). ROW3: trade plan / market
// conditions / historical evidence. ROW4: previous session. ROW5: detailed
// events. ROWs 1-3 are the "core decision area" the redesign spec asks to fit in
// one viewport; ROWs 4-5 are lower-priority supporting detail below the fold.
export function MarketDetailCard({ row, newsHeadline, recommendationsGeneratedToday, marketsAllocatedToday }: Props) {
  const highImpactEvent = row.eventRiskItems.find(e => e.impact === 'HIGH') ?? null

  return (
    <div className="border-t border-border bg-muted/20 p-5 space-y-5">
      {/* ROW 1 */}
      <div className="space-y-3">
        <RecommendationHeader row={row} />
        <MajorEventWarning eventRiskItems={row.eventRiskItems} />
        <ZoneStrip
          currentZone={row.currentZone}
          preferredZone={row.preferredZone}
          direction={row.direction}
          entryLow={row.entryLow}
          entryHigh={row.entryHigh}
          displayPrecision={row.displayPrecision}
          currentPrice={row.currentPrice}
          currentPriceSource={row.currentPriceSource}
          triggerProbability={row.triggerProbability}
        />
      </div>

      {/* ROW 2 -- chart 65% / why this setup 35% */}
      <div className="grid grid-cols-1 lg:grid-cols-[65fr_35fr] gap-4">
        <div className="rounded-lg border border-border bg-card p-3 min-w-0">
          <TradeContextChart
            data={row.priceHistory}
            entryLow={row.entryLow}
            entryHigh={row.entryHigh}
            riskRange={row.riskRange}
            targetRange={row.targetRange}
            currentPrice={row.currentPrice}
            highImpactEvent={highImpactEvent}
            displayPrecision={row.displayPrecision}
          />
        </div>
        <div className="rounded-lg border border-border bg-card p-3 min-w-0">
          <WhySetup
            row={row}
            recommendationsGeneratedToday={recommendationsGeneratedToday}
            marketsAllocatedToday={marketsAllocatedToday}
          />
        </div>
      </div>

      {/* ROW 3 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <TradePlanCard row={row} />
        <MarketConditionsCard row={row} />
        <HistoricalEvidenceCard row={row} />
      </div>

      {/* ROW 4 */}
      <PreviousSessionStrip row={row} />

      {/* ROW 5 */}
      <DetailedEvents
        newsHeadline={newsHeadline}
        eventRiskItems={row.eventRiskItems}
        eventRiskOverflowCount={row.eventRiskOverflowCount}
      />

      <div className="pt-1 border-t border-border/60">
        <FeedbackButtons opportunityId={row.opportunityId} />
      </div>
    </div>
  )
}
