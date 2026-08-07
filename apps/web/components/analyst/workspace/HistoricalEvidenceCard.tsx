import { formatR, formatPercent } from '@/lib/format'
import { trendLabelFull } from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

function conditionsLabel(tier: string): string {
  switch (tier) {
    case 'zone': return 'zone-matched conditions'
    case 'regime_direction': return 'comparable conditions'
    default: return 'all conditions'
  }
}

// Section 7 -- renamed from "Historical Edge". Prefers the analyst's regime-matched
// record (labelled "comparable conditions") over their blended market+direction
// record ("all conditions") when one exists -- historicalEdge() in workspaceData.ts
// already picks the right tier; this just renders it and names the tier honestly.
export function HistoricalEvidenceCard({ row }: Props) {
  const edge = row.historicalEdge

  return (
    <div className="border-border bg-card rounded-lg p-3">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Historical Evidence</p>
      {row.direction && (
        <p className="text-xs text-muted-foreground mb-1.5">
          {row.direction} · {row.symbol}
          {edge.tier === 'regime_direction' && edge.regimeLabel ? ` · ${trendLabelFull(edge.regimeLabel)}` : ''}
        </p>
      )}
      {edge.tier !== 'none' ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Win rate</span>
            <span className="text-sm font-medium tabular-nums">{formatPercent(edge.winRate)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Expectancy</span>
            <span className={`text-sm font-medium tabular-nums ${(edge.avgR ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {formatR(edge.avgR)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Sample</span>
            <span className="text-sm font-medium tabular-nums">{edge.trades} trades</span>
          </div>
          {edge.quality && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Quality</span>
              <span className="text-sm font-medium">{edge.quality}</span>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/60 mt-1.5">{conditionsLabel(edge.tier)}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No trade history yet.</p>
      )}
    </div>
  )
}
