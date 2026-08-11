'use client'
import { useState } from 'react'
import { formatR, formatPercent } from '@/lib/format'
import { emaStackString, directionalPersistenceLabel } from '@/lib/workspaceUtils'
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

// Section 7 -- "More detail," collapsed behind one toggle, genuinely additive
// information only. Named "More detail" rather than "Supporting evidence" --
// the latter implied the main card lacked evidence, which stopped being true
// once Evidence Pillars carries the historical profile and today's conditions.
// Deliberately pared down from the previous version: valuation ladder (duplicated
// Today's Conditions' Price Location), the volatility line in the old "Detailed
// regime & volatility" (duplicated Today's Conditions' Volatility section), and
// "Historical breakdown" (duplicated Why This Is Being Recommended, and was low
// quality text) are all gone -- only EMA stack + directional persistence, previous
// session OHLC, full economic calendar detail, and the selection rationale remain.
export function SupportingEvidence({ row, recommendationsGeneratedToday, marketsAllocatedToday }: Props) {
  const [expanded, setExpanded] = useState(false)
  const regime = row.regime

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="text-xs text-primary hover:underline"
      >
        More detail {expanded ? '▴' : '▾'}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {regime && (
            <SubSection title="Technical context">
              <p className="text-xs tabular-nums">
                <span className="text-muted-foreground">EMA </span>
                <span className="text-foreground">{emaStackString(regime.ema20, regime.ema50, regime.ema200)}</span>
                <span className="text-muted-foreground">{'  ·  '}</span>
                <span className="text-foreground">{directionalPersistenceLabel(regime.directionalPersistence)}</span>
              </p>
            </SubSection>
          )}

          <SubSection title="Previous session">
            <PreviousSessionStrip row={row} />
          </SubSection>

          <SubSection title="Economic calendar">
            <DetailedEvents eventRiskItems={row.eventRiskItems} eventRiskOverflowCount={row.eventRiskOverflowCount} />
          </SubSection>

          <SubSection title="Selection">
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>
                <span className="font-medium tabular-nums text-foreground">{recommendationsGeneratedToday}</span> recommendations today ·{' '}
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
