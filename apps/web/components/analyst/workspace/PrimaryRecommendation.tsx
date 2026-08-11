import { formatSymbolForDisplay, recommendationTypeLabel, deriveAlignment } from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

// Section 1 -- the first thing the analyst sees: market, TYPE of idea (BUY DIPS /
// SELL RALLIES, not generic status language like "WAITING FOR ENTRY"), suggested
// entry, current price. No ATR references here -- that detail lives in Supporting
// Evidence. This reads as an analytical view ("we believe this is worth
// reviewing"), not an instruction -- the pill is coloured for quick scanning, not
// styled as a BUY/SELL command button. Direction pill, type label, and counter-trend
// badge all sit inline with the symbol on one header line -- a previous pass put the
// pill around the type-label text on its own line below the symbol instead. A literal
// "·" separates the pill from the type label, not just flex gap -- gap-2 was already
// present here as of the prior commit (verified by reading the file, not assumed), so
// a report of them still reading concatenated is more likely a stale cached render than
// a missing gap; an actual rendered character is immune to that class of problem either way.
export function PrimaryRecommendation({ row }: Props) {
  const precision = row.displayPrecision ?? 4
  const symbolDisplay = formatSymbolForDisplay(row.symbol, row.assetClass)
  const typeLabel = recommendationTypeLabel(row.direction)
  // Falls back to a locally-derived alignment when regime_tags.directionAlignment is null
  // (recommendations generated before that field started being written) -- see
  // deriveAlignment()'s comment for why this is scoped to just the badge below.
  const alignment = deriveAlignment(row.directionAlignment, row.direction, row.regime?.trendState ?? null)

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xl font-semibold text-foreground tracking-tight">{symbolDisplay}</p>
        {row.direction && (
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
            row.direction === 'SELL' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'
          }`}>
            {row.direction}
          </span>
        )}
        {typeLabel && (
          <>
            <span className="text-muted-foreground text-[11px]" aria-hidden>·</span>
            <span className="text-sm font-medium text-foreground">{typeLabel}</span>
          </>
        )}
        {alignment === 'COUNTER_TREND' && (
          <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">
            ↙ Counter-trend
          </span>
        )}
      </div>
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
