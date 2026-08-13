'use client'

import { Fragment, useState } from 'react'

interface Review {
  review_id: string
  market: string
  session: string
  direction_alignment: string
  entry_alignment: string
  stop_alignment: string
  target_alignment: string
  alignment_score: number
  review_status: string
  analyst_facing_review: string
  created_at: string
  // analyst_id is fetched (needed for the !inner join filter in monitor/page.tsx --
  // see that file's comment) but not otherwise used here; every review already
  // belongs to the viewing analyst by construction of that query.
  trade: { result_r: number | null; triggered: boolean; analyst_id: string } | null
}

interface CompliancePanelProps {
  reviews: Review[]
}

export function CompliancePanel({ reviews }: CompliancePanelProps) {
  const [expandedReview, setExpandedReview] = useState<string | null>(null)
  const hasData = reviews.length > 0

  // Compute summary stats
  const total = reviews.length
  const directionAligned = reviews.filter(r => r.direction_alignment === 'Aligned').length
  const entryAligned = reviews.filter(r => r.entry_alignment === 'High').length
  const fullAlignment = reviews.filter(r => r.alignment_score === 4).length

  // Performance vs alignment -- only closed (result_r known) trades count, since an
  // open/untriggered trade has no outcome to average in either direction.
  const closedReviews = reviews.filter(r => r.trade?.result_r != null)
  const alignedTrades = closedReviews.filter(r => r.alignment_score >= 3)
  const notAlignedTrades = closedReviews.filter(r => r.alignment_score <= 2)

  const alignedAvgR = alignedTrades.length > 0
    ? alignedTrades.reduce((s, r) => s + Number(r.trade?.result_r ?? 0), 0) / alignedTrades.length
    : null

  const notAlignedAvgR = notAlignedTrades.length > 0
    ? notAlignedTrades.reduce((s, r) => s + Number(r.trade?.result_r ?? 0), 0) / notAlignedTrades.length
    : null

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
                {fullAlignment}/{total} trades matched direction, entry, stop and target
              </p>
            </div>
          </div>

          {directionAligned === total && total > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1.5 rounded mt-2">
              These reviews only include trades that matched the coaching direction.
              Counter-direction trades will appear as the platform captures more live data.
            </p>
          )}

          {/* Performance vs alignment */}
          {closedReviews.length > 0 && (
            <div className="mt-4 rounded-lg border border-border p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Performance vs alignment
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Based on {closedReviews.length} closed trade{closedReviews.length !== 1 ? 's' : ''}
                {closedReviews.length < reviews.length && (
                  <> &middot; {reviews.length - closedReviews.length} still open</>
                )}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">When aligned (score &ge; 3)</p>
                  <p className={`text-xl font-semibold mt-1 ${alignedAvgR !== null && alignedAvgR >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {alignedAvgR !== null ? `${alignedAvgR >= 0 ? '+' : ''}${alignedAvgR.toFixed(2)}R` : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">{alignedTrades.length} trades</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">When not aligned (score &le; 2)</p>
                  <p className={`text-xl font-semibold mt-1 ${notAlignedAvgR !== null && notAlignedAvgR >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {notAlignedAvgR !== null ? `${notAlignedAvgR >= 0 ? '+' : ''}${notAlignedAvgR.toFixed(2)}R` : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">{notAlignedTrades.length} trades</p>
                </div>
              </div>
              {alignedTrades.length >= 5 && notAlignedTrades.length >= 5 && alignedAvgR !== null && notAlignedAvgR !== null ? (
                <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                  {alignedAvgR > notAlignedAvgR
                    ? `Following coaching adds ${(alignedAvgR - notAlignedAvgR).toFixed(2)}R per trade on average.`
                    : alignedAvgR < notAlignedAvgR
                    ? `Diverging from coaching has added ${(notAlignedAvgR - alignedAvgR).toFixed(2)}R per trade — worth reviewing why.`
                    : 'No meaningful difference between aligned and non-aligned trades yet.'}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                  Insufficient data for comparison — need at least 5 closed trades in each group.
                </p>
              )}
            </div>
          )}

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
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reviews.slice(0, 10).map((review) => (
                  <Fragment key={review.review_id}>
                    <tr
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setExpandedReview(
                        expandedReview === review.review_id ? null : review.review_id
                      )}
                    >
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
                      <td className="px-4 py-2.5 font-medium">{review.alignment_score}/4</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{review.review_status}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">
                        {expandedReview === review.review_id ? '▲' : '▼'}
                      </td>
                    </tr>
                    {expandedReview === review.review_id && (
                      <tr>
                        <td colSpan={7} className="px-4 py-3 bg-muted/20 border-t border-border">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {review.analyst_facing_review}
                          </p>
                          {review.alignment_score === 4 && (
                            <p className="text-xs text-green-700 mt-2 font-medium">
                              &#10003; Full alignment — direction, entry, stop and target all within coaching range.
                            </p>
                          )}
                          {review.alignment_score <= 2 && (
                            <p className="text-xs text-amber-700 mt-2 font-medium">
                              Review your entry and risk placement against the coaching suggestion.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
