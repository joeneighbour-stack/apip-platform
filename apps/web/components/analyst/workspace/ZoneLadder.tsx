import { ZONE_LADDER_ORDER, zonePlainLabel, zoneSemanticColour, ZONE_BAND_BG_CLASS } from '@/lib/workspaceUtils'

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

const TRIGGER_TOOLTIP =
  'Probability of price reaching this zone based on historical data from current position. Per-zone probabilities coming soon.'

// Zone 1-4 are equal-width by construction with the engine-accurate ATR
// formula (each is exactly `step` wide), so they get equal fixed heights --
// no more computing a height proportional to a y-domain that could balloon
// when price moves. Too High/Too Deep get a smaller fixed height regardless
// of how far they conceptually extend, since they're unbounded on one side
// and have no "real" width to be proportional to.
// 4*ZONE_HEIGHT + 2*EXTREME_HEIGHT = 204, plus a 20px bottom spacer to match
// the chart's fixed XAxis height (PriceChart.tsx) = 224px total either way.
const ZONE_HEIGHT = 40
const EXTREME_HEIGHT = 22
const AXIS_SPACER_HEIGHT = 20

export function ZoneLadder({
  currentZone, preferredZone, direction, entryLow, entryHigh, displayPrecision,
  currentPrice, currentPriceSource, triggerProbability,
}: Props) {
  const precision = displayPrecision ?? 4

  return (
    <div className="flex flex-col overflow-hidden shrink-0" style={{ width: 140 }}>
      {ZONE_LADDER_ORDER.map((zone) => {
        const isCurrent = zone === currentZone
        const isPreferred = zone === preferredZone
        const colour = zoneSemanticColour(zone, direction)
        const bgClass = ZONE_BAND_BG_CLASS[colour]
        const preferredClass = isPreferred ? 'border-t-2 border-b-2 border-green-300 dark:bg-green-900/20' : ''
        const isExtreme = zone === 'TOO_HIGH' || zone === 'TOO_DEEP'
        const height = isExtreme ? EXTREME_HEIGHT : ZONE_HEIGHT

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
      {/* Empty spacer matching the chart's fixed XAxis height, so both widgets'
          zone-band regions occupy the same vertical span and their totals match. */}
      <div style={{ height: AXIS_SPACER_HEIGHT }} />
    </div>
  )
}
