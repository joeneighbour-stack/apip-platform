import { ZONE_LADDER_ORDER, zoneLabel, zonePlainLabel, zoneProximityClass, type AtrZone } from '@/lib/workspaceUtils'

interface Props {
  currentZone: string | null
  preferredZone: string | null
  entryLow: number | null
  entryHigh: number | null
  displayPrecision: number | null
  distanceLanguage: string | null
  currentPrice: number | null
}

const CELL_BG_CLASS: Record<'green' | 'amber' | 'red' | 'neutral', string> = {
  green: 'bg-green-100',
  amber: 'bg-amber-100',
  red: 'bg-red-100',
  neutral: 'bg-muted',
}

export function ZoneLadder({
  currentZone, preferredZone, entryLow, entryHigh, displayPrecision, distanceLanguage, currentPrice,
}: Props) {
  const precision = displayPrecision ?? 4

  return (
    <div>
      <div className="grid grid-cols-6 rounded-md border border-border overflow-hidden text-center">
        {ZONE_LADDER_ORDER.map((zone) => {
          const isCurrent = zone === currentZone
          const isPreferred = zone === preferredZone
          const proximity = zoneProximityClass(zone, preferredZone)
          return (
            <div
              key={zone}
              className={`py-2 px-1 border-r border-border last:border-r-0 ${CELL_BG_CLASS[proximity]}`}
            >
              <p className="text-[10px] font-medium text-foreground/80 leading-tight min-h-[2.2em] flex items-center justify-center">
                {zonePlainLabel(zone as AtrZone)}
              </p>
              <div className="h-5 flex flex-col items-center justify-center gap-0.5">
                <div className="flex items-center justify-center gap-1 text-xs">
                  {isCurrent && (
                    <span
                      className="w-2 h-2 rounded-full bg-white ring-1 ring-foreground/50 inline-block"
                      title={`Current: ${zoneLabel(currentZone)}`}
                    />
                  )}
                  {isPreferred && <span title={`Preferred entry: ${zoneLabel(preferredZone)}`}>★</span>}
                </div>
                {isCurrent && currentPrice != null && (
                  <span className="text-[9px] tabular-nums text-foreground/70">{currentPrice.toFixed(precision)}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
        <span>● Current: <span className="text-foreground font-medium">{zonePlainLabel(currentZone)}</span></span>
        <span>★ Preferred entry: <span className="text-foreground font-medium">{zonePlainLabel(preferredZone)}</span></span>
      </div>
      {entryLow != null && entryHigh != null && (
        <p className="text-xs tabular-nums text-muted-foreground mt-2">
          Entry range: <span className="text-foreground font-medium">{entryLow.toFixed(precision)} – {entryHigh.toFixed(precision)}</span>
        </p>
      )}
      {distanceLanguage && (
        <p className="text-xs text-muted-foreground mt-1">{distanceLanguage}</p>
      )}
    </div>
  )
}
