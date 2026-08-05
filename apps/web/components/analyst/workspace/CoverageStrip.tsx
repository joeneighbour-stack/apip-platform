'use client'
import { Fragment, useState } from 'react'
import { MarketDetailCard } from './MarketDetailCard'
import {
  zoneShortLabel, zoneProximityClass, ZONE_PROXIMITY_TEXT_CLASS,
  trendArrow, estimateSessionEnd, countdownLabel,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  rows: WorkspaceRow[]
}

export function CoverageStrip({ rows }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
                    <td className={`py-2 px-3 font-medium ${ZONE_PROXIMITY_TEXT_CLASS[proximity]}`}>
                      {zoneShortLabel(row.currentZone)} → {zoneShortLabel(row.preferredZone)}
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
                    <td className="py-2 px-3">
                      {row.regime ? (
                        <span>
                          {trendArrow(row.regime.trendState)} ADX {row.regime.adx14?.toFixed(0) ?? '—'}
                          {row.regime.confidence && (
                            <span className={`ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] border ${
                              row.regime.confidence === 'HIGH' ? 'bg-green-50 border-green-200 text-green-800'
                                : row.regime.confidence === 'MEDIUM' ? 'bg-amber-50 border-amber-200 text-amber-800'
                                : 'bg-muted border-border text-muted-foreground'
                            }`}>
                              {row.regime.confidence}
                            </span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-3">{row.hasHighImpactEventToday && <span className="text-amber-600">⚠</span>}</td>
                    <td className="py-2 px-3 text-muted-foreground">{countdownLabel(sessionEnd)}</td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={9} className="p-0">
                        <MarketDetailCard row={row} />
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
