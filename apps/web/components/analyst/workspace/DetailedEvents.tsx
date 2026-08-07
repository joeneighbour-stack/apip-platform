import { groupEventsByTime, impactBadge } from '@/lib/workspaceUtils'
import type { EventRiskItem } from './types'

interface Props {
  eventRiskItems: EventRiskItem[]
  eventRiskOverflowCount: number
}

function eventTimeUk(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
}

function fpaLine(e: EventRiskItem): string | null {
  const parts: string[] = []
  if (e.forecast) parts.push(`F: ${e.forecast}`)
  if (e.previous) parts.push(`P: ${e.previous}`)
  if (e.actual) parts.push(`A: ${e.actual}`)
  return parts.length > 0 ? parts.join('   ') : null
}

// Section 9 -- economic calendar grouped by exact release time, with forecast/
// previous/actual shown per indicator instead of the old repeated "Be aware of
// potential volatility" boilerplate. Market news lives higher up the card now
// (right below the header), not here -- this is calendar detail only.
export function DetailedEvents({ eventRiskItems, eventRiskOverflowCount }: Props) {
  if (eventRiskItems.length === 0) return null

  const groups = groupEventsByTime(eventRiskItems)

  return (
    <div>
      {groups.length > 0 && (
        <div>
          <div className="space-y-2">
            {groups.map(group => (
              <div key={group.eventTimeUk} className="rounded-md border border-border bg-card px-2.5 py-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">{eventTimeUk(group.eventTimeUk)} UK</span>
                  <span className={`font-medium ${group.maxImpact === 'HIGH' ? 'text-red-700' : group.maxImpact === 'MEDIUM' ? 'text-amber-700' : 'text-muted-foreground'}`}>
                    {impactBadge(group.maxImpact)}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {group.items.map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] text-muted-foreground gap-3">
                      <span className="text-foreground">{e.eventName}</span>
                      {fpaLine(e) && <span className="tabular-nums shrink-0">{fpaLine(e)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {eventRiskOverflowCount > 0 && (
              <p className="text-[11px] text-muted-foreground">and {eventRiskOverflowCount} more event{eventRiskOverflowCount === 1 ? '' : 's'} today</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
