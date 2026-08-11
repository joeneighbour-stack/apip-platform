import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

function LevelRow({ label, value, accentClass, showDivider }: { label: string; value: string; accentClass: string; showDivider: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 ${showDivider ? 'border-b border-border' : ''}`}>
      <div className={`w-0.5 h-7 rounded-none flex-shrink-0 ${accentClass}`} />
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide w-9">{label}</span>
      <span className="text-[13px] font-medium">{value}</span>
    </div>
  )
}

// Section 6 -- "these are the system's suggested starting levels," nothing more.
// Deliberately named Suggested Trade Structure, not Trade Plan -- the analyst is
// responsible for producing the final trade idea. No ATR references, no
// risk/reward maths, no BUY/SELL instruction styling. Coloured left accent bars
// (blue/red/green) are a scanning aid only, not a directional instruction.
export function SuggestedTradeStructure({ row }: Props) {
  const precision = row.displayPrecision ?? 4
  const entry = row.entryLow != null && row.entryHigh != null
    ? `${row.entryLow.toFixed(precision)}–${row.entryHigh.toFixed(precision)}`
    : '—'

  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Suggested Trade Structure</p>
      <div>
        <LevelRow label="Entry" value={entry} accentClass="bg-blue-500" showDivider />
        <LevelRow label="Stop" value={row.riskRange || '—'} accentClass="bg-red-400" showDivider />
        <LevelRow label="Target" value={row.targetRange || '—'} accentClass="bg-green-500" showDivider={false} />
      </div>
      {(row.volatilityWarning || row.isEntryPassed) && (
        <p className="text-xs text-amber-700 mt-2">{row.volatilityWarning || 'Price beyond entry range'}</p>
      )}
    </div>
  )
}
