interface InternalBestWorstTrade {
  date: string
  symbol: string
  analystName: string
  direction: 'BUY' | 'SELL'
  resultR: number
}

interface Props {
  best: InternalBestWorstTrade[]
  worst: InternalBestWorstTrade[]
}

// Internal-only -- includes the analyst column. The report path never imports this
// component; it has its own ReportBestWorstTable operating on ReportSafeTrade (no
// analyst field exists on that type at all), so there is no shared code path that
// could leak an analyst name into a report.
export function BestWorstTrades({ best, worst }: Props) {
  if (best.length === 0 && worst.length === 0) return null
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <BestWorstTable title="Best Performers" rows={best} />
      <BestWorstTable title="Worst Performers" rows={worst} />
    </div>
  )
}

function BestWorstTable({ title, rows }: { title: string; rows: InternalBestWorstTrade[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
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
            {rows.map((r, i) => (
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
