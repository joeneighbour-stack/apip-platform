'use client'
import { Fragment, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { MarketDetailCard } from './MarketDetailCard'
import { useMarketNews } from '@/hooks/useMarketNews'
import {
  coverageZoneLabel,
  regimeTrendLabel, confidenceBadgeLabel, estimateSessionEnd, countdownLabel, deriveAlignment,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  rows: WorkspaceRow[]
  // Section 4 selection funnel -- total opportunities generated today, across all
  // analysts/sessions. Optional so existing/older callers don't have to change;
  // the funnel row just reads "—" when omitted.
  recommendationsGeneratedToday?: number
  // No-op today -- the strip and MarketDetailCard have no mutating actions to begin with
  // (expand/collapse is the only interaction). Accepted so callers like the management
  // inline View panel can be explicit that this is a read-only render.
  readOnly?: boolean
}

export function CoverageStrip({ rows, recommendationsGeneratedToday = 0 }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // All symbols in today's session, fetched together in one call on mount and
  // polled every 30 minutes -- not per-row as each one is expanded, so every
  // market has fresh context simultaneously and an analyst doesn't need to
  // refresh the page to see updated news partway through the session.
  const symbols = useMemo(() => [...new Set(rows.map(r => r.symbol))], [rows])
  const { news, lastFetched } = useMarketNews(symbols)

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border p-6">
        <p className="text-sm text-muted-foreground">No recommendations for today&apos;s session yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="font-medium py-2 px-3">Symbol</th>
              <th className="font-medium py-2 px-3">Dir</th>
              <th className="font-medium py-2 px-3">Zone</th>
              <th className="font-medium py-2 px-3">Entry Range</th>
              <th className="font-medium py-2 px-3">Entry Prob.</th>
              <th className="font-medium py-2 px-3">Edge Rating</th>
              <th className="font-medium py-2 px-3">Regime</th>
              <th className="font-medium py-2 px-3">Event Risk</th>
              <th className="font-medium py-2 px-3">Expires</th>
              <th className="font-medium py-2 px-3" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isExpanded = expandedId === row.recommendationId
              const zoneLabel = coverageZoneLabel(row.currentZone, row.preferredZone, row.direction)
              const precision = row.displayPrecision ?? 4
              const sessionEnd = estimateSessionEnd(row.session, row.assetClass, row.sessionEndIso)
              const rowNews = news[row.symbol] ?? null
              return (
                <Fragment key={row.recommendationId}>
                  <tr
                    onClick={() => setExpandedId(isExpanded ? null : row.recommendationId)}
                    role="button"
                    tabIndex={0}
                    title="Click to expand"
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isExpanded ? null : row.recommendationId) }
                    }}
                    className={`cursor-pointer border-t border-border transition-colors ${
                      i % 2 === 1 ? 'bg-muted/10' : ''
                    } ${row.isDoNotUse ? 'opacity-60' : ''} ${isExpanded ? 'bg-muted/60' : 'hover:bg-muted/40'}`}
                  >
                    <td className="py-2 px-3 font-medium">{row.symbol}</td>
                    <td className="py-2 px-3">
                      <span className={`font-medium ${row.direction === 'BUY' ? 'text-green-700' : 'text-red-700'}`}>
                        {row.direction ?? '—'}
                      </span>
                    </td>
                    <td className={`py-2 px-3 font-medium whitespace-nowrap ${zoneLabel.className}`}>
                      {zoneLabel.label}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {row.entryLow != null && row.entryHigh != null
                        ? `${row.entryLow.toFixed(precision)} – ${row.entryHigh.toFixed(precision)}`
                        : '—'}
                    </td>
                    <td className="py-2 px-3">{row.triggerProbability != null ? `${Math.round(row.triggerProbability * 100)}%` : '—'}</td>
                    <td className={`py-2 px-3 font-medium ${
                      row.expectedR == null || row.expectedR === 0 ? 'text-foreground'
                        : row.expectedR > 0 ? 'text-green-700' : 'text-red-600'
                    }`}>
                      {row.expectedR != null ? `${row.expectedR > 0 ? '+' : ''}${row.expectedR.toFixed(2)}R` : '—'}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {row.regime ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span>{regimeTrendLabel(row.regime.trendState, row.regime.adx14, true)}</span>
                          {deriveAlignment(row.directionAlignment, row.direction, row.regime.trendState) === 'COUNTER_TREND' && (
                            <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">
                              ↙ Counter
                            </span>
                          )}
                          {row.regime.confidence && (
                            <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] border ${
                              row.regime.confidence === 'HIGH' ? 'bg-green-50 border-green-200 text-green-800'
                                : row.regime.confidence === 'MEDIUM' ? 'bg-amber-50 border-amber-200 text-amber-800'
                                : 'bg-muted border-border text-muted-foreground'
                            }`}>
                              {confidenceBadgeLabel(row.regime.confidence)}
                            </span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-3">{row.hasHighImpactEventToday && <span className="text-amber-600">⚠</span>}</td>
                    <td className="py-2 px-3 text-muted-foreground">{countdownLabel(sessionEnd)}</td>
                    <td className="py-2 px-3 text-right">
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </td>
                  </tr>
                  {/* The headline used to get a slim preview row here too, duplicating
                      what the expanded MarketDetailCard's own header now shows --
                      removed in favour of that single, always-visible copy. */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={10} className="p-0">
                        <MarketDetailCard
                          row={row}
                          news={rowNews}
                          newsLastFetched={lastFetched}
                          recommendationsGeneratedToday={recommendationsGeneratedToday}
                          marketsAllocatedToday={rows.length}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
