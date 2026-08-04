import type { ReportSafeTrade } from '@/lib/reportSanitiser'

interface Props {
  best: ReportSafeTrade[]
}

// Report-only variant: ReportSafeTrade has no field capable of holding an analyst
// identity, and this component never imports the internal BestPerformers component
// (which does have an analyst column) -- there is no code path from here to that data.
// No "Worst Performers" table -- the worst a single trade can be is -1R (capped), so
// every stop-out ranks equally; Worst Performing Markets replaces it.
export function ReportBestPerformers({ best }: Props) {
  if (best.length === 0) return null
  return (
    <div>
      <p className="text-[8pt] font-semibold uppercase tracking-wide mb-1">Best Performers</p>
      <table className="w-full text-[8pt] border-collapse">
        <thead>
          <tr className="border-b border-black/20">
            {['Date', 'Market', 'Direction', 'Result R'].map(h => (
              <th key={h} className="text-left py-1 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {best.map((r, i) => (
            <tr key={i} className="border-b border-black/5">
              <td className="py-1">{r.date}</td>
              <td className="py-1 font-medium">{r.symbol}</td>
              <td className="py-1">{r.direction}</td>
              <td className="py-1 tabular-nums">{r.resultR > 0 ? '+' : ''}{r.resultR.toFixed(2)}R</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
