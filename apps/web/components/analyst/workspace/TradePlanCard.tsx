import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

// One compact column within the shared ROW3 strip (see MarketDetailCard) -- no
// own border/background, just label rows tight enough that entry/stop/target
// read in one glance. Row order (entry, then stop, then target) plus the raw
// ranges themselves already make the stop-above/below-entry relationship for
// SELL/BUY visually obvious without extra derived logic.
export function TradePlanCard({ row }: Props) {
  const precision = row.displayPrecision ?? 4
  const entry = row.entryLow != null && row.entryHigh != null
    ? `${row.entryLow.toFixed(precision)} – ${row.entryHigh.toFixed(precision)}`
    : '—'

  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Trade Plan</p>
      <div className="space-y-0.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Entry</span>
          <span className="font-medium tabular-nums">{entry}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Stop</span>
          <span className="font-medium tabular-nums">
            {row.riskRange || '—'}{row.riskAtrDistance != null && <span className="text-muted-foreground font-normal"> ({row.riskAtrDistance.toFixed(1)} ATR)</span>}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Target</span>
          <span className="font-medium tabular-nums">
            {row.targetRange || '—'}{row.targetAtrDistance != null && <span className="text-muted-foreground font-normal"> ({row.targetAtrDistance.toFixed(1)} ATR)</span>}
          </span>
        </div>
      </div>
      {(row.volatilityWarning || row.isEntryPassed) && (
        <p className="text-[10px] text-amber-700 mt-1">{row.volatilityWarning || 'Price beyond entry range'}</p>
      )}
    </div>
  )
}
