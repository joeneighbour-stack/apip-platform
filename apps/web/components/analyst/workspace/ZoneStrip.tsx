'use client'
import { useState } from 'react'
import { ZONE_LADDER_ORDER, zoneSemanticColour, ZONE_BAND_BG_CLASS, type AtrZone } from '@/lib/workspaceUtils'

interface Props {
  currentZone: string | null
  preferredZone: string | null
  direction: 'BUY' | 'SELL' | null
  entryLow: number | null
  entryHigh: number | null
  displayPrecision: number | null
  currentPrice: number | null
  currentPriceSource: 'live' | 'close' | null
  triggerProbability: number | null
}

const STRIP_LABEL: Record<AtrZone, string> = {
  TOO_HIGH: 'EXTREME', ZONE_4: 'STRETCHED', ZONE_3: 'FAIR VALUE',
  ZONE_2: 'VALUE', ZONE_1: 'DEEP VALUE', TOO_DEEP: 'EXTREME',
}

// Replaces the old vertical zone ladder -- one line, no large bands. ▲ marks the
// current price's zone, ★ the preferred entry zone; "View zone detail ▼" exposes
// the entry range + trigger probability that used to live in the always-visible
// ladder, without bringing the large bands back.
export function ZoneStrip({
  currentZone, preferredZone, direction, entryLow, entryHigh, displayPrecision,
  currentPrice, currentPriceSource, triggerProbability,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const precision = displayPrecision ?? 4

  return (
    <div className="space-y-1">
      <div className="flex items-center text-[10px] font-medium rounded-md border border-border overflow-hidden">
        {ZONE_LADDER_ORDER.map((zone, i) => {
          const isCurrent = zone === currentZone
          const isPreferred = zone === preferredZone
          const colour = zoneSemanticColour(zone, direction)
          return (
            <div
              key={zone}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 ${i > 0 ? 'border-l border-border' : ''} ${ZONE_BAND_BG_CLASS[colour]}`}
            >
              <span className="text-foreground truncate">
                {STRIP_LABEL[zone]}
                {isCurrent && ' ▲'}
                {isPreferred && ' ★'}
              </span>
              {isCurrent && currentPrice != null && (
                <span className="text-[9px] tabular-nums text-foreground/70">
                  {currentPrice.toFixed(precision)}{currentPriceSource === 'close' ? ' (close)' : ''}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="text-[10px] text-primary hover:underline"
      >
        View zone detail {expanded ? '▴' : '▾'}
      </button>
      {expanded && (
        <div className="text-[11px] text-muted-foreground space-y-0.5 tabular-nums">
          <p>Entry: {entryLow != null && entryHigh != null ? `${entryLow.toFixed(precision)}–${entryHigh.toFixed(precision)}` : '—'}</p>
          {triggerProbability != null && <p>Trigger probability: {Math.round(triggerProbability * 100)}%</p>}
        </div>
      )}
    </div>
  )
}
