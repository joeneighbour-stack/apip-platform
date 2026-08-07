import { weekdayDateLabel, fxPipCount } from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

// Section 8 -- compact, low-prominence single strip. Deliberately plain text,
// no coloured tiles, matching the spec's "low visual prominence" instruction.
export function PreviousSessionStrip({ row }: Props) {
  const { previousDay, yesterdayTradeOutcome, displayPrecision, assetClass } = row
  if (!previousDay) return null

  const precision = displayPrecision ?? 4
  const range = previousDay.high - previousDay.low
  const pips = assetClass === 'FX' ? fxPipCount(range, displayPrecision) : null

  return (
    <div className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Previous Session</span>
      <span className="ml-2">{weekdayDateLabel(previousDay.date)}</span>
      <div className="mt-0.5 tabular-nums">
        O: {previousDay.open.toFixed(precision)} &nbsp; H: {previousDay.high.toFixed(precision)} &nbsp;
        L: {previousDay.low.toFixed(precision)} &nbsp; C: {previousDay.close.toFixed(precision)} &nbsp;
        Range: {pips != null ? `${pips} pips` : range.toFixed(precision)}
      </div>
      {yesterdayTradeOutcome && (
        <div className="mt-0.5">
          Previous recommendation: <span className="font-medium text-foreground">{yesterdayTradeOutcome.direction}</span>
          <span> · </span>
          <span className="font-medium text-foreground">{yesterdayTradeOutcome.triggered ? 'TRIGGERED' : 'NOT TRIGGERED'}</span>
          {yesterdayTradeOutcome.resultR != null && (
            <span className={`font-medium ${yesterdayTradeOutcome.resultR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {' '}· {yesterdayTradeOutcome.resultR > 0 ? '+' : ''}{yesterdayTradeOutcome.resultR.toFixed(2)}R
            </span>
          )}
        </div>
      )}
    </div>
  )
}
