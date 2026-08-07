import { groupEventsByTime } from '@/lib/workspaceUtils'
import type { EventRiskItem } from './types'

interface Props {
  eventRiskItems: EventRiskItem[]
}

function eventTimeUk(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
}

// Section 3 -- shown only when a HIGH-impact event exists for this market today;
// hidden entirely otherwise (no empty placeholder). Compact -- full per-indicator
// detail (forecast/previous/actual) lives in Supporting Evidence's economic
// calendar, not here. No collective release name exists in the data
// (economic_calendar_events only has per-indicator event_name, e.g. "Nonfarm
// Payrolls"), so real event names are listed rather than inventing a title like
// "US Employment Report".
export function MajorEventWarning({ eventRiskItems }: Props) {
  const highImpact = eventRiskItems.filter(e => e.impact === 'HIGH')
  if (highImpact.length === 0) return null

  const groups = groupEventsByTime(highImpact)
  const first = groups[0]!
  const names = first.items.map(e => e.eventName)

  return (
    <div className="text-xs">
      <p className="font-semibold text-red-700">⚠ HIGH EVENT RISK · {eventTimeUk(first.eventTimeUk)} UK</p>
      <p className="text-foreground mt-0.5">{names.join(' · ')}</p>
      {groups.length > 1 && (
        <p className="text-muted-foreground mt-0.5">+{groups.length - 1} more high-impact event{groups.length - 1 === 1 ? '' : 's'} today</p>
      )}
    </div>
  )
}
