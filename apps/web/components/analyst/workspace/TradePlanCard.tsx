import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

// Section 5 -- compact entry/stop/target table. Row order (entry, then stop, then
// target) plus the raw ranges themselves already make the stop-above/below-entry
// relationship for SELL/BUY visually obvious without extra derived logic.
export function TradePlanCard({ row }: Props) {
  const precision = row.displayPrecision ?? 4
  const entry = row.entryLow != null && row.entryHigh != null
    ? `${row.entryLow.toFixed(precision)} – ${row.entryHigh.toFixed(precision)}`
    : '—'

  return (
    <div className="border-border bg-card rounded-lg p-3">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Trade Plan</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Entry</span>
          <span className="text-sm font-medium tabular-nums">{entry}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide pt-0.5">Stop</span>
          <div className="text-right">
            <span className="text-sm font-medium tabular-nums block">{row.riskRange || '—'}</span>
            {row.riskAtrDistance != null && (
              <span className="text-[10px] text-muted-foreground">{row.riskAtrDistance.toFixed(1)} ATR beyond entry</span>
            )}
          </div>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide pt-0.5">Target</span>
          <div className="text-right">
            <span className="text-sm font-medium tabular-nums block">{row.targetRange || '—'}</span>
            {row.targetAtrDistance != null && (
              <span className="text-[10px] text-muted-foreground">{row.targetAtrDistance.toFixed(1)} ATR from entry</span>
            )}
          </div>
        </div>
      </div>
      {(row.volatilityWarning || row.isEntryPassed) && (
        <p className="text-[10px] text-amber-700 mt-2">{row.volatilityWarning || 'Price beyond entry range'}</p>
      )}
    </div>
  )
}
