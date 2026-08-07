import {
  recommendationStatusLabel, regimeAlignmentEvidence, priceLocationEvidence,
  eventRiskEvidence, entryStatusEvidence, historicalFitEvidence,
  EVIDENCE_STATUS_CLASS, EVIDENCE_STATUS_ICON, estimateSessionEnd, countdownLabel,
  type EvidenceIndicator,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

function EvidenceRow({ indicator }: { indicator: EvidenceIndicator }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs ${EVIDENCE_STATUS_CLASS[indicator.status]}`}>
      <span aria-hidden>{EVIDENCE_STATUS_ICON[indicator.status]}</span>
      <span>{indicator.label}</span>
    </div>
  )
}

// Section 1 -- strong recommendation header + evidence indicators + opportunity
// score placeholder. All indicators are derived from data already on WorkspaceRow;
// none are hidden purely for space -- each has its own hide condition, so the row
// naturally settles at 3-5 depending on what's actually known for this market.
export function RecommendationHeader({ row }: Props) {
  const precision = row.displayPrecision ?? 4
  const isExpired = countdownLabel(estimateSessionEnd(row.session, row.assetClass, row.sessionEndIso)) === 'Expired'
  const statusLabel = recommendationStatusLabel(row.isDoNotUse, row.isEntryPassed, row.analystAction, isExpired)

  const indicators = [
    regimeAlignmentEvidence(row.direction, row.regime?.trendState ?? null),
    priceLocationEvidence(row.currentZone, row.preferredZone),
    eventRiskEvidence(row.eventRiskItems),
    entryStatusEvidence(row.analystAction, isExpired),
    historicalFitEvidence(row.historicalEdge.avgR, row.historicalEdge.winRate),
  ].filter((i): i is EvidenceIndicator => i !== null)

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold text-foreground">{row.symbol}</span>
          {row.direction && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              row.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {row.direction}
            </span>
          )}
          <span className={`text-[10px] font-medium uppercase tracking-wide ${
            row.isDoNotUse ? 'text-red-600' : statusLabel === 'ENTRY TRIGGERED' ? 'text-green-700' : 'text-muted-foreground'
          }`}>
            {statusLabel}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            Entry <span className="font-medium tabular-nums text-foreground ml-1">
              {row.entryLow != null && row.entryHigh != null ? `${row.entryLow.toFixed(precision)} – ${row.entryHigh.toFixed(precision)}` : '—'}
            </span>
          </span>
          <span className="text-muted-foreground">
            Current price <span className="font-medium tabular-nums text-foreground ml-1">
              {row.currentPrice != null ? row.currentPrice.toFixed(precision) : '—'}
            </span>
          </span>
        </div>
        {indicators.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
            {indicators.map((indicator, i) => <EvidenceRow key={i} indicator={indicator} />)}
          </div>
        )}
      </div>

      {/* Opportunity score -- reserved for a future scoring model, not invented here. */}
      <div className="shrink-0 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-2.5 text-center">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Opportunity Score</p>
        <p className="text-sm font-medium text-muted-foreground mt-1">Coming soon</p>
      </div>
    </div>
  )
}
