interface InternalBestTrade {
  date: string
  symbol: string
  analystName: string
  direction: 'BUY' | 'SELL'
  resultR: number
}

interface Props {
  best: InternalBestTrade[]
}

// Internal-only -- includes the analyst column. The report path never imports this
// component; it has its own ReportBestPerformers operating on ReportSafeTrade (no
// analyst field exists on that type at all), so there is no shared code path that
// could leak an analyst name into a report.
//
// No "Worst Performers" equivalent exists here deliberately: the worst a single
// trade can be is -1R (capped), so every stop-out ranks equally -- an individual-
// trade worst-performer list carries no analytical signal. Worst Performing Markets
// (aggregate Total R, min sample size) replaces it below.
export function BestPerformers({ best }: Props) {
  if (best.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Best Performers</p>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {['Date', 'Market', 'Analyst', 'Direction', 'Result R'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {best.map((r, i) => (
              <tr key={i}>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.date}</td>
                <td className="px-3 py-2 text-xs font-medium">{r.symbol}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.analystName}</td>
                <td className="px-3 py-2 text-xs">{r.direction}</td>
                <td className={`px-3 py-2 text-xs tabular-nums font-medium ${r.resultR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {r.resultR > 0 ? '+' : ''}{r.resultR.toFixed(2)}R
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
