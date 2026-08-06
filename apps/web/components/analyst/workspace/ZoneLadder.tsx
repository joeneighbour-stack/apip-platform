import {
  ZONE_LADDER_ORDER, zonePlainLabel, zoneSemanticColour, ZONE_BAND_BG_CLASS,
  zoneRangeFor, zoneBandHeightPx, type AtrZone, type ZoneBoundaries,
} from '@/lib/workspaceUtils'

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
  zoneBoundaries: ZoneBoundaries | null
  yDomain: [number, number] | null
}

const TRIGGER_TOOLTIP =
  'Probability of price reaching this zone based on historical data from current position. Per-zone probabilities coming soon.'

const LADDER_HEIGHT = 220

export function ZoneLadder({
  currentZone, preferredZone, direction, entryLow, entryHigh, displayPrecision,
  currentPrice, currentPriceSource, triggerProbability, zoneBoundaries, yDomain,
}: Props) {
  const precision = displayPrecision ?? 4

  return (
    <div className="flex flex-col overflow-hidden shrink-0" style={{ height: LADDER_HEIGHT, width: 140 }}>
      {ZONE_LADDER_ORDER.map((zone) => {
        const isCurrent = zone === currentZone
        const isPreferred = zone === preferredZone
        const colour = zoneSemanticColour(zone, direction)
        const bgClass = ZONE_BAND_BG_CLASS[colour]
        const preferredClass = isPreferred ? 'border-t-2 border-b-2 border-green-300 dark:bg-green-900/20' : ''

        // Price-proportional height when we have real zone boundaries to work
        // from (matching the chart's y-axis exactly); otherwise fall back to
        // equal bands so the ladder still renders sensibly with thin history.
        const height = zoneBoundaries && yDomain
          ? zoneBandHeightPx(zoneRangeFor(zone, zoneBoundaries).max, zoneRangeFor(zone, zoneBoundaries).min, yDomain, LADDER_HEIGHT)
          : LADDER_HEIGHT / 6

        return (
          <div
            key={zone}
            className={`flex items-center justify-between px-2 border-t border-border first:border-t-0 overflow-hidden ${bgClass} ${preferredClass}`}
            style={{ height, minHeight: height }}
          >
            <div className="flex flex-col justify-center leading-tight min-w-0">
              <span className="text-[10px] font-medium text-foreground truncate">{zonePlainLabel(zone)}</span>
              {isCurrent && currentPrice != null && (
                <span className="text-[9px] tabular-nums text-foreground/70">
                  ● {currentPrice.toFixed(precision)}{currentPriceSource === 'close' ? ' (Last close)' : ''}
                </span>
              )}
              {isPreferred && entryLow != null && entryHigh != null && (
                <span className="text-[9px] tabular-nums text-foreground/70">
                  Entry: {entryLow.toFixed(precision)}–{entryHigh.toFixed(precision)}
                </span>
              )}
              {isPreferred && triggerProbability != null && (
                <span
                  title={TRIGGER_TOOLTIP}
                  className="text-[9px] tabular-nums font-medium text-green-800 bg-green-100 border border-green-200 rounded-full px-1.5 w-fit mt-0.5"
                >
                  {Math.round(triggerProbability * 100)}% trigger
                </span>
              )}
            </div>
            {isPreferred && <span className="text-xs shrink-0 ml-1" title={`Preferred entry: ${zonePlainLabel(preferredZone)}`}>★</span>}
          </div>
        )
      })}
    </div>
  )
}
