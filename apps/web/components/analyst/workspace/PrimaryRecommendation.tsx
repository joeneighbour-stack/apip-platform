import { formatSymbolForDisplay, recommendationTypeLabel } from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

// Section 1 -- the first thing the analyst sees: market, TYPE of idea (BUY DIPS /
// SELL RALLIES, not generic status language like "WAITING FOR ENTRY"), suggested
// entry, current price. No ATR references here -- that detail lives in Supporting
// Evidence. This reads as an analytical view ("we believe this is worth
// reviewing"), not an instruction -- the pill is coloured for quick scanning, not
// styled as a BUY/SELL command button.
export function PrimaryRecommendation({ row }: Props) {
  const precision = row.displayPrecision ?? 4
  const symbolDisplay = formatSymbolForDisplay(row.symbol, row.assetClass)
  const typeLabel = recommendationTypeLabel(row.direction)

  return (
    <div>
      <p className="text-xl font-semibold text-foreground tracking-tight">{symbolDisplay}</p>
      {typeLabel && (
        <p className="mt-0.5 flex items-center gap-2">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
            row.direction === 'SELL' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'
          }`}>
            {typeLabel}
          </span>
          {row.directionAlignment === 'COUNTER_TREND' && (
            <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">
              ↙ Counter
            </span>
          )}
        </p>
      )}
      {row.isDoNotUse && (
        <p className="text-xs font-medium text-red-600 mt-1">Levels outdated — awaiting recalculation.</p>
      )}
      <div className="flex items-center gap-5 mt-2 text-sm">
        <span className="text-muted-foreground">
          Suggested entry <span className="font-medium tabular-nums text-foreground ml-1">
            {row.entryLow != null && row.entryHigh != null ? `${row.entryLow.toFixed(precision)}–${row.entryHigh.toFixed(precision)}` : '—'}
          </span>
        </span>
        <span className="text-muted-foreground">
          Current <span className="font-medium tabular-nums text-foreground ml-1">
            {row.currentPrice != null ? row.currentPrice.toFixed(precision) : '—'}
          </span>
        </span>
      </div>
    </div>
  )
}
