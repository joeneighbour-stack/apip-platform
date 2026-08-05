'use client'
import { useState } from 'react'
import { MarketNews } from '@/components/analyst/MarketNews'
import { ZoneLadder } from './ZoneLadder'
import { PriceChart } from './PriceChart'
import { formatR, formatPercent } from '@/lib/format'
import {
  emaStackString, directionalPersistenceLabel,
  volatilityTrend, weekdayDateLabel, fxPipCount, zoneLabel,
  regimeTrendLabelWithAdx, regimeVolatilityLabel, confidenceBadgeLabel,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
}

function personaliseNote(note: string): string {
  return note
    .replace('The historical profile favours', 'Your historical profile suggests')
    .replace('the historical profile favours', 'your historical profile suggests')
    .replace('Treat this as a coaching range rather than an instruction; execution judgement remains important.', '')
    .trim()
}

function historicalEdgeTierLabel(tier: string): string {
  switch (tier) {
    case 'zone': return 'zone-scoped'
    case 'market_direction': return 'market + direction'
    case 'market_only': return 'market only'
    default: return 'no history'
  }
}

export function MarketDetailCard({ row }: Props) {
  const [coachingOpen, setCoachingOpen] = useState(false)
  const precision = row.displayPrecision ?? 4
  const volTrend = row.regime ? volatilityTrend(row.regime.atrPercentile, row.regime.priorAtrPercentile) : null

  return (
    <div className="border-t border-border bg-muted/20 p-5 space-y-5">
      {row.isDoNotUse && (
        <p className="text-xs font-medium text-red-700">Levels outdated — recommendation requires recalculation.</p>
      )}

      {/* A. Zone ladder */}
      <section>
        <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Zone</h3>
        <ZoneLadder
          currentZone={row.currentZone}
          preferredZone={row.preferredZone}
          entryLow={row.entryLow}
          entryHigh={row.entryHigh}
          displayPrecision={row.displayPrecision}
          distanceLanguage={row.distanceLanguage}
          currentPrice={row.currentPrice}
        />
      </section>

      {/* Price chart (30 days) */}
      <section>
        <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Price (30 Days)</h3>
        <PriceChart
          data={row.priceHistory}
          entryLow={row.entryLow}
          entryHigh={row.entryHigh}
          stopMid={row.riskMid}
          targetMid={row.targetMid}
          displayPrecision={row.displayPrecision}
        />
      </section>

      {/* B. Guidance levels */}
      <section>
        <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Guidance Levels</h3>
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="font-medium py-1 pr-4">Level</th>
              <th className="font-medium py-1 pr-4"></th>
              <th className="font-medium py-1">ATR distance from entry</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border/60">
              <td className="py-1.5 pr-4 text-muted-foreground">Entry</td>
              <td className="py-1.5 pr-4 font-medium">
                {row.entryLow != null && row.entryHigh != null ? `${row.entryLow.toFixed(precision)} – ${row.entryHigh.toFixed(precision)}` : '—'}
              </td>
              <td className="py-1.5 text-muted-foreground">—</td>
            </tr>
            <tr className="border-t border-border/60">
              <td className="py-1.5 pr-4 text-muted-foreground">Stop</td>
              <td className="py-1.5 pr-4 font-medium">{row.riskRange || '—'}</td>
              <td className="py-1.5">{row.riskAtrDistance != null ? `${row.riskAtrDistance.toFixed(1)} ATR` : '—'}</td>
            </tr>
            <tr className="border-t border-border/60">
              <td className="py-1.5 pr-4 text-muted-foreground">Target</td>
              <td className="py-1.5 pr-4 font-medium">{row.targetRange || '—'}</td>
              <td className="py-1.5">{row.targetAtrDistance != null ? `${row.targetAtrDistance.toFixed(1)} ATR` : '—'}</td>
            </tr>
          </tbody>
        </table>
        {row.volatilityWarning && (
          <p className="text-xs text-amber-700 mt-2">{row.volatilityWarning}</p>
        )}
        {row.isEntryPassed && (
          <p className="text-xs text-amber-700 mt-2">Price has moved beyond the entry range — levels shown for reference; apply judgement before acting.</p>
        )}
      </section>

      {/* C. Regime panel */}
      <section>
        <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Regime</h3>
        {row.regime ? (
          <div className="text-xs space-y-1 tabular-nums">
            <p>
              <span className="text-muted-foreground">Trend: </span>
              <span className="font-medium text-foreground">{regimeTrendLabelWithAdx(row.regime.trendState, row.regime.adx14)}</span>
              <span className={`ml-2 inline-block px-1.5 py-0.5 rounded-full text-[10px] border ${
                row.regime.confidence === 'HIGH' ? 'bg-green-50 border-green-200 text-green-800'
                  : row.regime.confidence === 'MEDIUM' ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-muted border-border text-muted-foreground'
              }`}>
                {confidenceBadgeLabel(row.regime.confidence)}
              </span>
            </p>
            <p className="text-muted-foreground">
              EMA Stack: <span className="text-foreground">{emaStackString(row.regime.ema20, row.regime.ema50, row.regime.ema200)}</span>
              {'  '}Persistence: <span className="text-foreground">{directionalPersistenceLabel(row.regime.directionalPersistence)}</span>
            </p>
            <p className="text-muted-foreground">
              Volatility: <span className="text-foreground">{regimeVolatilityLabel(row.regime.atrPercentile)}</span>
              {volTrend && volTrend !== 'flat' && (
                <span className={volTrend === 'expanding' ? 'text-amber-600' : 'text-muted-foreground'}> ({volTrend} vs. yesterday)</span>
              )}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No regime data available for this market.</p>
        )}
      </section>

      {/* D. Previous day summary */}
      <section>
        <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Previous Day</h3>
        {row.previousDay ? (
          <p className="text-xs tabular-nums text-muted-foreground">
            {weekdayDateLabel(row.previousDay.date)}:{'  '}
            Open <span className="text-foreground">{row.previousDay.open.toFixed(precision)}</span>{'  '}
            High <span className="text-foreground">{row.previousDay.high.toFixed(precision)}</span>{'  '}
            Low <span className="text-foreground">{row.previousDay.low.toFixed(precision)}</span>{'  '}
            Close <span className="text-foreground">{row.previousDay.close.toFixed(precision)}</span>{'  '}
            Range{' '}
            <span className="text-foreground">
              {(row.previousDay.high - row.previousDay.low).toFixed(precision)}
              {row.assetClass === 'FX' && fxPipCount(row.previousDay.high - row.previousDay.low, row.displayPrecision) != null &&
                ` (${fxPipCount(row.previousDay.high - row.previousDay.low, row.displayPrecision)} pips)`}
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No prior-day data available.</p>
        )}
        {row.yesterdayTradeOutcome && (
          <p className="text-xs mt-1">
            <span className="text-muted-foreground">Your trade: </span>
            <span className="font-medium">{row.yesterdayTradeOutcome.direction}</span>
            <span className="text-muted-foreground"> → </span>
            <span className="font-medium">{row.yesterdayTradeOutcome.triggered ? 'Triggered' : 'Not triggered'}</span>
            {row.yesterdayTradeOutcome.resultR != null && (
              <>
                <span className="text-muted-foreground"> → </span>
                <span className={`font-medium ${row.yesterdayTradeOutcome.resultR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {formatR(row.yesterdayTradeOutcome.resultR)}
                </span>
              </>
            )}
          </p>
        )}
      </section>

      {/* E. Historical edge */}
      <section>
        <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
          Historical Edge {row.direction && `(${row.symbol} · ${row.direction}${row.historicalEdge.tier === 'zone' ? ` · ${zoneLabel(row.preferredZone)}` : ''})`}
        </h3>
        {row.historicalEdge.tier !== 'none' ? (
          <p className="text-xs tabular-nums">
            <span className="text-muted-foreground">Avg R: </span>
            <span className={`font-medium ${(row.historicalEdge.avgR ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {formatR(row.historicalEdge.avgR)}
            </span>
            <span className="text-muted-foreground">{'  '}Win Rate: </span>
            <span className="font-medium text-foreground">{formatPercent(row.historicalEdge.winRate)}</span>
            <span className="text-muted-foreground">{'  '}Trades: </span>
            <span className="font-medium text-foreground">{row.historicalEdge.trades}</span>
            <span className="text-muted-foreground"> ({historicalEdgeTierLabel(row.historicalEdge.tier)}
              {row.historicalEdge.quality ? `, ${row.historicalEdge.quality} quality` : ''})</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No trade history for this market yet.</p>
        )}
      </section>

      {/* F. News & event risk */}
      <section className="space-y-2">
        <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">News &amp; Event Risk</h3>
        <MarketNews symbols={[row.symbol]} />
        {row.eventRiskItems.length > 0 && (
          <div className="space-y-1.5">
            {row.eventRiskItems.map((ev, i) => (
              <div key={i} className="text-xs rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-amber-800">
                    ⚠ {new Date(ev.eventTimeUk).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })} UK — {ev.eventName}
                  </span>
                  {ev.riskScore != null && (
                    <span className="tabular-nums font-medium text-amber-800 ml-2">{(ev.riskScore * 10).toFixed(1)}/10</span>
                  )}
                </div>
                {ev.analystWarning && <p className="text-amber-700 mt-0.5">{ev.analystWarning}</p>}
                {(ev.forecast || ev.previous || ev.actual) && (
                  <p className="text-amber-700 mt-0.5 tabular-nums">
                    {ev.forecast && <>Forecast: {ev.forecast} </>}
                    {ev.previous && <>Previous: {ev.previous} </>}
                    {ev.actual && <>Actual: {ev.actual}</>}
                  </p>
                )}
              </div>
            ))}
            {row.eventRiskOverflowCount > 0 && (
              <p className="text-[11px] text-muted-foreground">and {row.eventRiskOverflowCount} more event{row.eventRiskOverflowCount === 1 ? '' : 's'}</p>
            )}
          </div>
        )}
      </section>

      {/* G. Coaching note */}
      {row.coachingNote && (
        <section>
          <button
            type="button"
            onClick={() => setCoachingOpen(v => !v)}
            className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
          >
            Why this allocation? {coachingOpen ? '▾' : '▸'}
          </button>
          {coachingOpen && (
            <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">{personaliseNote(row.coachingNote)}</p>
          )}
        </section>
      )}
    </div>
  )
}
