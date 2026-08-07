import { groupEventsByTime } from '@/lib/workspaceUtils'
import type { EventRiskItem } from './types'

interface Props {
  eventRiskItems: EventRiskItem[]
}

function eventTimeUk(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
}

// Section 3 -- shown only when a HIGH-impact event exists for this market today;
// hidden entirely otherwise (no empty placeholder). Compact, single-line summary --
// full per-indicator detail (forecast/previous/actual) lives in Supporting Evidence's
// economic calendar, not here. No collective release name exists in the data
// (economic_calendar_events only has per-indicator event_name, e.g. "Nonfarm
// Payrolls"), so a single real event name is shown when there's only one at this
// time; when several publish together, the description falls back to a currency +
// count ("4 USD events") rather than inventing a theme like "US Labour Report" --
// there is no release/theme field to group on honestly.
function groupDescription(items: { eventName: string; currency: string | null }[]): string {
  if (items.length === 1) return items[0]!.eventName
  const currencies = new Set(items.map(e => e.currency).filter((c): c is string => !!c))
  if (currencies.size === 1) {
    const [currency] = currencies
    return `${items.length} ${currency} events`
  }
  return `${items.length} high-impact events`
}

export function MajorEventWarning({ eventRiskItems }: Props) {
  const highImpact = eventRiskItems.filter(e => e.impact === 'HIGH')
  if (highImpact.length === 0) return null

  const groups = groupEventsByTime(highImpact)
  const first = groups[0]!

  return (
    <div className="text-xs">
      <p className="font-semibold text-red-700">
        ⚠ HIGH EVENT RISK · {eventTimeUk(first.eventTimeUk)} UK — <span className="text-foreground">{groupDescription(first.items)}</span>
      </p>
      {groups.length > 1 && (
        <p className="text-muted-foreground mt-0.5">+{groups.length - 1} more high-impact event{groups.length - 1 === 1 ? '' : 's'} today</p>
      )}
    </div>
  )
}
