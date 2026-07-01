'use client'

interface Review {
  review_id: string
  market: string
  session: string
  direction_alignment: string
  entry_alignment: string
  alignment_score: number
  review_status: string
  created_at: string
}

interface CompliancePanelProps {
  reviews: Review[]
}

export function CompliancePanel({ reviews }: CompliancePanelProps) {
  const hasData = reviews.length > 0

  // Compute summary stats
  const total = reviews.length
  const directionAligned = reviews.filter(r => r.direction_alignment === 'Aligned').length
  const entryAligned = reviews.filter(r => r.entry_alignment === 'High').length
  const fullAlignment = reviews.filter(r => r.alignment_score === 2).length

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Compliance vs Coaching</h2>

      {!hasData ? (
        <div className="rounded-lg border border-border p-6">
          <p className="text-sm text-muted-foreground">
            Compliance data appears once post-trade reviews have been generated.
            Reviews require a coaching recommendation to have been shown before the trade.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Direction alignment</p>
              <p className="text-2xl font-semibold">
                {Math.round((directionAligned / total) * 100)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {directionAligned}/{total} trades matched coaching direction
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Entry alignment</p>
              <p className="text-2xl font-semibold">
                {Math.round((entryAligned / total) * 100)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {entryAligned}/{total} trades entered within suggested range
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Full alignment</p>
              <p className="text-2xl font-semibold">
                {Math.round((fullAlignment / total) * 100)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {fullAlignment}/{total} trades matched both direction and entry
              </p>
            </div>
          </div>

          {/* Recent reviews table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Market</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Session</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Direction</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Entry</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Score</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reviews.slice(0, 10).map((review) => (
                  <tr key={review.review_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{review.market}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{review.session}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        review.direction_alignment === 'Aligned'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {review.direction_alignment}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        review.entry_alignment === 'High'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {review.entry_alignment}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-medium">{review.alignment_score}/2</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{review.review_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
