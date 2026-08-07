import { formatR, formatPercent } from '@/lib/format'
import { historicalEdgeConditionsLabel } from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

// One compact column within the shared ROW3 strip (see MarketDetailCard). Win
// rate/expectancy/sample/quality collapse onto one line -- this is the ONE place
// these numbers are shown (Why This Setup's Historical Evidence block only states
// whether the edge is positive and how much to trust it, not the numbers themselves).
export function HistoricalEvidenceCard({ row }: Props) {
  const edge = row.historicalEdge

  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Historical Evidence</p>
      {edge.tier !== 'none' ? (
        <div className="text-xs">
          {row.direction && (
            <p className="text-muted-foreground">
              {row.direction} · {row.symbol} · {historicalEdgeConditionsLabel(edge.tier)}
            </p>
          )}
          <p className="tabular-nums mt-0.5">
            Win <span className="font-medium">{formatPercent(edge.winRate)}</span>
            <span className="text-muted-foreground"> · Exp </span>
            <span className={`font-medium ${(edge.avgR ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatR(edge.avgR)}</span>
            <span className="text-muted-foreground"> · n={edge.trades}</span>
            {edge.quality && <span className="text-muted-foreground"> · {edge.quality}</span>}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No trade history yet.</p>
      )}
    </div>
  )
}
