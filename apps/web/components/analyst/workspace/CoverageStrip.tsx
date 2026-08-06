'use client'
import { Fragment, useEffect, useState } from 'react'
import { MarketDetailCard } from './MarketDetailCard'
import {
  zonePlainLabel, zoneProximityClass, ZONE_PROXIMITY_TEXT_CLASS,
  regimeTrendLabel, confidenceBadgeLabel, estimateSessionEnd, countdownLabel,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  rows: WorkspaceRow[]
}

export function CoverageStrip({ rows }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Headline per symbol, fetched lazily on expand -- undefined means "not
  // fetched yet", null means "fetched, nothing available". Lifted up here
  // (rather than fetched independently inside MarketDetailCard) so the strip's
  // slim summary row and the detail card's News section share one fetch
  // instead of both hitting the news endpoint for the same symbol.
  const [newsBySymbol, setNewsBySymbol] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (!expandedId) return
    const row = rows.find(r => r.recommendationId === expandedId)
    if (!row || newsBySymbol[row.symbol] !== undefined) return
    fetch('/api/news/acuity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: [row.symbol] }),
    })
      .then(r => r.json())
      .then(data => setNewsBySymbol(prev => ({ ...prev, [row.symbol]: data[row.symbol] ?? null })))
      .catch(() => setNewsBySymbol(prev => ({ ...prev, [row.symbol]: null })))
  }, [expandedId, rows, newsBySymbol])

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
              <th className="font-medium py-2 px-3">Trigger %</th>
              <th className="font-medium py-2 px-3">Expected R</th>
              <th className="font-medium py-2 px-3">Regime</th>
              <th className="font-medium py-2 px-3">Event Risk</th>
              <th className="font-medium py-2 px-3">Expires</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isExpanded = expandedId === row.recommendationId
              const proximity = zoneProximityClass(row.currentZone, row.preferredZone)
              const precision = row.displayPrecision ?? 4
              const sessionEnd = estimateSessionEnd(row.session, row.assetClass, row.sessionEndIso)
              const headline = newsBySymbol[row.symbol]
              const totalEventCount = row.eventRiskItems.length + row.eventRiskOverflowCount
              return (
                <Fragment key={row.recommendationId}>
                  <tr
                    onClick={() => setExpandedId(isExpanded ? null : row.recommendationId)}
                    className={`cursor-pointer border-t border-border hover:bg-muted/30 transition-colors ${
                      i % 2 === 1 ? 'bg-muted/10' : ''
                    } ${row.isDoNotUse ? 'opacity-60' : ''} ${isExpanded ? 'bg-muted/30' : ''}`}
                  >
                    <td className="py-2 px-3 font-medium">{row.symbol}</td>
                    <td className="py-2 px-3">
                      <span className={`font-medium ${row.direction === 'BUY' ? 'text-green-700' : 'text-red-700'}`}>
                        {row.direction ?? '—'}
                      </span>
                    </td>
                    <td className={`py-2 px-3 font-medium whitespace-nowrap ${ZONE_PROXIMITY_TEXT_CLASS[proximity]}`}>
                      {zonePlainLabel(row.currentZone)} → {zonePlainLabel(row.preferredZone)}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {row.entryLow != null && row.entryHigh != null
                        ? `${row.entryLow.toFixed(precision)} – ${row.entryHigh.toFixed(precision)}`
                        : '—'}
                    </td>
                    <td className="py-2 px-3">{row.triggerProbability != null ? `${Math.round(row.triggerProbability * 100)}%` : '—'}</td>
                    <td className={`py-2 px-3 font-medium ${(row.expectedR ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {row.expectedR != null ? `${row.expectedR > 0 ? '+' : ''}${row.expectedR.toFixed(2)}R` : '—'}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {row.regime ? (
                        <span>
                          {regimeTrendLabel(row.regime.trendState, row.regime.adx14, true)}
                          {row.regime.confidence && (
                            <span className={`ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] border ${
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
                  </tr>
                  {isExpanded && headline && (
                    <tr className="bg-muted/20">
                      <td colSpan={9} className="px-3 py-1">
                        <div className="pl-4 flex items-center gap-3">
                          <p className="flex-1 min-w-0 text-xs text-muted-foreground italic truncate">📰 &ldquo;{headline}&rdquo;</p>
                          {totalEventCount > 0 && (
                            <span className="shrink-0 text-[11px] font-medium text-amber-600">⚠ {totalEventCount} event{totalEventCount === 1 ? '' : 's'}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {isExpanded && (
                    <tr>
                      <td colSpan={9} className="p-0">
                        <MarketDetailCard row={row} newsHeadline={headline ?? null} />
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
