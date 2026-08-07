import { groupEventsByTime } from '@/lib/workspaceUtils'
import type { EventRiskItem } from './types'

interface Props {
  eventRiskItems: EventRiskItem[]
}

function eventTimeUk(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
}

// Section 2 -- shown only when a HIGH-impact event exists for this market today.
// No collective release name exists in the data (economic_calendar_events only has
// per-indicator event_name), so the sub-line lists the real event names for the
// earliest HIGH-impact group, joined together, rather than inventing a title like
// "US Employment Report".
export function MajorEventWarning({ eventRiskItems }: Props) {
  const highImpact = eventRiskItems.filter(e => e.impact === 'HIGH')
  if (highImpact.length === 0) return null

  const groups = groupEventsByTime(highImpact)
  const first = groups[0]!

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
      <p className="text-xs font-semibold text-red-800">⚠ MAJOR EVENT RISK</p>
      <p className="text-sm font-medium text-red-800 mt-0.5">
        {first.items[0]!.eventName} · {eventTimeUk(first.eventTimeUk)} UK
      </p>
      {first.items.length > 1 && (
        <p className="text-xs text-red-700 mt-0.5">
          {first.items.slice(1).map(e => e.eventName).join(' · ')}
        </p>
      )}
      {groups.length > 1 && (
        <p className="text-[11px] text-red-700 mt-1">
          +{groups.length - 1} more high-impact event{groups.length - 1 === 1 ? '' : 's'} today
        </p>
      )}
    </div>
  )
}
