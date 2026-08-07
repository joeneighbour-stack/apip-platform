import { groupEventsByTime } from '@/lib/workspaceUtils'
import type { EventRiskItem } from './types'

interface Props {
  eventRiskItems: EventRiskItem[]
}

function eventTimeUk(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
}

// Single-line horizontal warning strip -- shown only when a HIGH-impact event exists
// for this market today. Full per-indicator detail (forecast/previous/actual) stays
// in the Economic Calendar below; this is just enough to flag it at a glance.
export function MajorEventWarning({ eventRiskItems }: Props) {
  const highImpact = eventRiskItems.filter(e => e.impact === 'HIGH')
  if (highImpact.length === 0) return null

  const groups = groupEventsByTime(highImpact)
  const first = groups[0]!
  const extraInGroup = first.items.length - 1
  const extraGroups = groups.length - 1

  return (
    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5 text-xs">
      <span className="font-semibold text-red-800 shrink-0">⚠ MAJOR EVENT RISK</span>
      <span className="text-red-700 truncate">
        {first.items[0]!.eventName} · {eventTimeUk(first.eventTimeUk)} UK
        {(extraInGroup > 0 || extraGroups > 0) && ` (+${extraInGroup + extraGroups} more)`}
      </span>
    </div>
  )
}
