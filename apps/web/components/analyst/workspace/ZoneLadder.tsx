import { ZONE_LADDER_ORDER, zoneShortLabel, zoneLabel, type AtrZone } from '@/lib/workspaceUtils'

interface Props {
  currentZone: string | null
  preferredZone: string | null
  entryLow: number | null
  entryHigh: number | null
  displayPrecision: number | null
  distanceLanguage: string | null
}

export function ZoneLadder({ currentZone, preferredZone, entryLow, entryHigh, displayPrecision, distanceLanguage }: Props) {
  const precision = displayPrecision ?? 4

  return (
    <div>
      <div className="grid grid-cols-6 rounded-md border border-border overflow-hidden text-center">
        {ZONE_LADDER_ORDER.map((zone) => {
          const isCurrent = zone === currentZone
          const isPreferred = zone === preferredZone
          return (
            <div
              key={zone}
              className={`py-2 border-r border-border last:border-r-0 ${
                isCurrent || isPreferred ? 'bg-muted/60' : 'bg-card'
              }`}
            >
              <p className="text-[10px] font-medium text-muted-foreground tracking-wide">{zoneShortLabel(zone as AtrZone)}</p>
              <div className="h-4 flex items-center justify-center text-xs">
                {isCurrent && <span title={`Current: ${zoneLabel(currentZone)}`}>▲</span>}
                {isPreferred && <span className="ml-0.5" title={`Preferred entry: ${zoneLabel(preferredZone)}`}>★</span>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
        <span>▲ Current: <span className="text-foreground font-medium">{zoneLabel(currentZone)}</span></span>
        <span>★ Preferred entry: <span className="text-foreground font-medium">{zoneLabel(preferredZone)}</span></span>
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
