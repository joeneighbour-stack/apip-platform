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

// Institutional recommendation card. Header -> Market Context (one understated
// line) -> Major Event warning (single strip) -> zone valuation -> chart (65%) /
// Why This Setup (35%) -> compact Trade Plan/Market Conditions/Historical Evidence
// strip -> previous session -> economic calendar detail -> feedback. Header
// through the ROW3 strip is the core decision area the layout targets fitting in
// one viewport; previous session/calendar detail are lower-priority, below the fold.
export function MarketDetailCard({ row, newsHeadline, recommendationsGeneratedToday, marketsAllocatedToday }: Props) {
  return (
    <div className="border-t border-border bg-muted/20 p-5 space-y-4">
      <div className="space-y-2">
        <RecommendationHeader row={row} />
        {newsHeadline && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Market context</span> &mdash; &ldquo;{newsHeadline}&rdquo;
          </p>
        )}
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

      {/* Chart 65% / Why This Setup 35% */}
      <div className="grid grid-cols-1 lg:grid-cols-[65fr_35fr] gap-4">
        <div className="rounded-lg border border-border bg-card p-2 min-w-0">
          <TradeContextChart
            data={row.priceHistory}
            entryLow={row.entryLow}
            entryHigh={row.entryHigh}
            riskRange={row.riskRange}
            targetRange={row.targetRange}
            currentPrice={row.currentPrice}
            highImpactEvent={row.eventRiskItems.find(e => e.impact === 'HIGH') ?? null}
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

      {/* Trade Plan / Market Conditions / Historical Evidence -- one strip, not
          three separate cards; each column owns its info with no restatement
          elsewhere on the card. */}
      <div className="rounded-lg border border-border bg-card grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
        <TradePlanCard row={row} />
        <MarketConditionsCard row={row} />
        <HistoricalEvidenceCard row={row} />
      </div>

      <PreviousSessionStrip row={row} />

      <DetailedEvents
        eventRiskItems={row.eventRiskItems}
        eventRiskOverflowCount={row.eventRiskOverflowCount}
      />

      <div className="pt-1 border-t border-border/60">
        <FeedbackButtons opportunityId={row.opportunityId} />
      </div>
    </div>
  )
}
