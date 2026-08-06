import {
  ZONE_LADDER_ORDER, zonePlainLabel, zoneSemanticColour, ZONE_BAND_BG_CLASS, type AtrZone,
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
}

const TRIGGER_TOOLTIP =
  'Probability of price reaching this zone based on historical data from current position. Per-zone probabilities coming soon.'

// Real zones (Zone 1-4) get flex-grow 2, Too High/Too Deep get flex-grow 1 --
// against a 200px-tall container that's 4x2 + 2x1 = 10 weight units (20px each),
// giving 40px per real zone and 20px per extreme zone, and lining up with the
// price chart's 10%-each-side Y-axis padding so the bands visually align.
function zoneWeight(zone: AtrZone): number {
  return zone === 'TOO_HIGH' || zone === 'TOO_DEEP' ? 1 : 2
}

export function ZoneLadder({
  currentZone, preferredZone, direction, entryLow, entryHigh, displayPrecision,
  currentPrice, currentPriceSource, triggerProbability,
}: Props) {
  const precision = displayPrecision ?? 4

  return (
    <div className="flex flex-col rounded-md border border-border overflow-hidden" style={{ height: 200, width: 140 }}>
      {ZONE_LADDER_ORDER.map((zone) => {
        const isCurrent = zone === currentZone
        const isPreferred = zone === preferredZone
        const colour = zoneSemanticColour(zone, direction)
        const bgClass = ZONE_BAND_BG_CLASS[colour]
        const preferredClass = isPreferred ? 'border-t-2 border-b-2 border-green-300 dark:bg-green-900/20' : ''

        return (
          <div
            key={zone}
            className={`flex items-center justify-between px-2 border-t border-border first:border-t-0 ${bgClass} ${preferredClass}`}
            style={{ flexGrow: zoneWeight(zone as AtrZone), flexBasis: 0 }}
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
