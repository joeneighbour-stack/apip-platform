'use client'
import { useState } from 'react'
import { formatR, formatPercent } from '@/lib/format'
import {
  emaStackString, directionalPersistenceLabel, volatilityTrend, volatilityTooltip, volatilityLabel,
  historicalEdgeConditionsLabel,
} from '@/lib/workspaceUtils'
import { ZoneStrip } from './ZoneStrip'
import { PreviousSessionStrip } from './PreviousSessionStrip'
import { DetailedEvents } from './DetailedEvents'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
  recommendationsGeneratedToday: number
  marketsAllocatedToday: number
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-3 border-t border-border/60 first:pt-0 first:border-t-0">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{title}</p>
      {children}
    </div>
  )
}

// Section 7 -- everything useful but not required for the analyst's first 5-10
// second read, collapsed behind one toggle. Nothing here is deleted from the
// previous implementation, only relocated so it stops competing with the primary
// recommendation. Default collapsed.
export function SupportingEvidence({ row, recommendationsGeneratedToday, marketsAllocatedToday }: Props) {
  const [expanded, setExpanded] = useState(false)
  const regime = row.regime
  const trend = regime ? volatilityTrend(regime.atrPercentile, regime.priorAtrPercentile) : null

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="text-xs text-primary hover:underline"
      >
        Supporting evidence {expanded ? '▴' : '▾'}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <SubSection title="Valuation ladder">
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
          </SubSection>

          {regime && (
            <SubSection title="Detailed regime & volatility">
              <div className="text-xs text-muted-foreground space-y-0.5 tabular-nums">
                <p>EMA stack: <span className="text-foreground">{emaStackString(regime.ema20, regime.ema50, regime.ema200)}</span></p>
                <p>Directional persistence: <span className="text-foreground">{directionalPersistenceLabel(regime.directionalPersistence)}</span></p>
                <p>
                  Volatility: <span className="text-foreground cursor-help" title={volatilityTooltip(regime.atrPercentile)}>{volatilityLabel(regime.atrPercentile)}</span>
                  {trend && <span> ({trend})</span>}
                </p>
              </div>
            </SubSection>
          )}

          <SubSection title="Previous session">
            <PreviousSessionStrip row={row} />
          </SubSection>

          <SubSection title="Economic calendar — today">
            <DetailedEvents eventRiskItems={row.eventRiskItems} eventRiskOverflowCount={row.eventRiskOverflowCount} />
          </SubSection>

          <SubSection title="Historical breakdown">
            <div className="text-xs text-muted-foreground space-y-0.5">
              {row.direction && (
                <p>Basis: <span className="text-foreground">{row.direction} · {row.symbol} · {historicalEdgeConditionsLabel(row.historicalEdge.tier)}</span></p>
              )}
              {row.coachingNote && <p>Coaching note: <span className="text-foreground">{row.coachingNote}</span></p>}
            </div>
          </SubSection>

          <SubSection title="How this was selected">
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>
                <span className="font-medium tabular-nums text-foreground">{recommendationsGeneratedToday}</span> recommendations generated today ·{' '}
                <span className="font-medium tabular-nums text-foreground">{marketsAllocatedToday}</span> allocated to you
              </p>
              {row.expectedR != null && row.triggerProbability != null && (
                <p>
                  Ranked by expected value: <span className="font-medium tabular-nums text-foreground">{formatR(row.expectedR)}</span> at{' '}
                  <span className="font-medium tabular-nums text-foreground">{formatPercent(row.triggerProbability)}</span> trigger probability
                </p>
              )}
            </div>
          </SubSection>
        </div>
      )}
    </div>
  )
}
