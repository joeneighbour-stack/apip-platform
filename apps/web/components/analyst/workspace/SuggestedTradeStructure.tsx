import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

function Level({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-medium tabular-nums text-foreground mt-0.5">{value}</p>
    </div>
  )
}

// Section 6 -- "these are the system's suggested starting levels," nothing more.
// Deliberately named Suggested Trade Structure, not Trade Plan -- the analyst is
// responsible for producing the final trade idea. No ATR references, no
// risk/reward maths, no BUY/SELL instruction styling, no coloured backgrounds --
// three plain equal columns.
export function SuggestedTradeStructure({ row }: Props) {
  const precision = row.displayPrecision ?? 4
  const entry = row.entryLow != null && row.entryHigh != null
    ? `${row.entryLow.toFixed(precision)}–${row.entryHigh.toFixed(precision)}`
    : '—'

  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Suggested Trade Structure</p>
      <div className="grid grid-cols-3 gap-4">
        <Level label="Entry" value={entry} />
        <Level label="Stop" value={row.riskRange || '—'} />
        <Level label="Target" value={row.targetRange || '—'} />
      </div>
      {(row.volatilityWarning || row.isEntryPassed) && (
        <p className="text-xs text-amber-700 mt-2">{row.volatilityWarning || 'Price beyond entry range'}</p>
      )}
    </div>
  )
}
