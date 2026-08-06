'use client'
import { useState } from 'react'
import { ZoneLadder } from './ZoneLadder'
import { PriceChart } from './PriceChart'
import { formatR, formatPercent } from '@/lib/format'
import {
  weekdayDateLabel, fxPipCount, zoneLabel,
  regimeTrendLabelWithAdx, confidenceBadgeLabel,
  computeZoneBoundaries, computeSharedYDomain, atrPercentileShortLabel, volatilityStateWord,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
  newsHeadline: string | null
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

function eventTimeUk(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
}

export function MarketDetailCard({ row, newsHeadline }: Props) {
  const [newsOpen, setNewsOpen] = useState(false)
  const precision = row.displayPrecision ?? 4
  const zoneBoundaries = computeZoneBoundaries(row.priceHistory)
  const yDomain = computeSharedYDomain(zoneBoundaries, row.entryLow, row.entryHigh)
  const totalEventCount = row.eventRiskItems.length + row.eventRiskOverflowCount

  return (
    <div className="border-t border-border bg-muted/20 p-5 space-y-4">
      {/* Header: symbol, direction, and the coaching note as an info tooltip */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{row.symbol}</span>
        {row.direction && (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
            row.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {row.direction}
          </span>
        )}
        {row.coachingNote && (
          <span
            title={personaliseNote(row.coachingNote)}
            aria-label="Why this allocation"
            className="w-4 h-4 flex items-center justify-center text-[10px] rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 cursor-help"
          >
            ℹ
          </span>
        )}
      </div>

      {row.isDoNotUse && (
        <p className="text-xs font-medium text-red-700">Levels outdated — recommendation requires recalculation.</p>
      )}

      {/* Zone ladder + price chart, sharing one price scale, rendered as a single unit */}
      <section>
        <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Zone &amp; Price (21 Days)</h3>
        <div className="flex border border-border rounded-md overflow-hidden">
          <ZoneLadder
            currentZone={row.currentZone}
            preferredZone={row.preferredZone}
            direction={row.direction}
            entryLow={row.entryLow}
            entryHigh={row.entryHigh}
            displayPrecision={row.displayPrecision}
            currentPrice={row.currentPrice}
            currentPriceSource={row.currentPriceSource}
            triggerProbability={row.triggerProbability}
            zoneBoundaries={zoneBoundaries}
            yDomain={yDomain}
          />
          <div className="flex-1 min-w-0">
            <PriceChart
              data={row.priceHistory}
              direction={row.direction}
              zoneBoundaries={zoneBoundaries}
              yDomain={yDomain}
              entryLow={row.entryLow}
              entryHigh={row.entryHigh}
              stopMid={row.riskMid}
              targetMid={row.targetMid}
              displayPrecision={row.displayPrecision}
            />
          </div>
        </div>
      </section>

      {/* Compact data grid: guidance levels, regime, historical edge */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Guidance Levels</p>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Entry</span>
              <span className="text-sm font-medium tabular-nums">
                {row.entryLow != null && row.entryHigh != null ? `${row.entryLow.toFixed(precision)}–${row.entryHigh.toFixed(precision)}` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Stop</span>
              <span className="text-sm font-medium tabular-nums">{row.riskRange || '—'}</span>
            </div>
            {row.riskAtrDistance != null && (
              <p className="text-[10px] text-muted-foreground text-right -mt-0.5">{row.riskAtrDistance.toFixed(1)} ATR to stop</p>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Target</span>
              <span className="text-sm font-medium tabular-nums">{row.targetRange || '—'}</span>
            </div>
            {row.targetAtrDistance != null && (
              <p className="text-[10px] text-muted-foreground text-right -mt-0.5">{row.targetAtrDistance.toFixed(1)} ATR to tgt</p>
            )}
          </div>
          {(row.volatilityWarning || row.isEntryPassed) && (
            <p className="text-[10px] text-amber-700 mt-2">{row.volatilityWarning || 'Price beyond entry range'}</p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Regime</p>
          {row.regime ? (
            <div className="space-y-1">
              <p className="text-sm font-medium tabular-nums text-foreground">
                {regimeTrendLabelWithAdx(row.regime.trendState, row.regime.adx14)}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Confidence</span>
                <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] border ${
                  row.regime.confidence === 'HIGH' ? 'bg-green-50 border-green-200 text-green-800'
                    : row.regime.confidence === 'MEDIUM' ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-muted border-border text-muted-foreground'
                }`}>
                  {confidenceBadgeLabel(row.regime.confidence)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Volatility</span>
                <span className="text-xs font-medium tabular-nums">{volatilityStateWord(row.regime.atrPercentile)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">ATR</span>
                <span className="text-xs font-medium tabular-nums">{atrPercentileShortLabel(row.regime.atrPercentile)}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No regime data.</p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Historical Edge</p>
          {row.direction && (
            <p className="text-xs text-muted-foreground mb-1">
              {row.direction} · {row.symbol}{row.historicalEdge.tier === 'zone' ? ` · ${zoneLabel(row.preferredZone)}` : ''}
            </p>
          )}
          {row.historicalEdge.tier !== 'none' ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Win Rate</span>
                <span className="text-sm font-medium tabular-nums">{formatPercent(row.historicalEdge.winRate)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Avg R</span>
                <span className={`text-sm font-medium tabular-nums ${(row.historicalEdge.avgR ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {formatR(row.historicalEdge.avgR)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Trades</span>
                <span className="text-sm font-medium tabular-nums">{row.historicalEdge.trades}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {historicalEdgeTierLabel(row.historicalEdge.tier)}{row.historicalEdge.quality ? ` · ${row.historicalEdge.quality}` : ''}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No trade history yet.</p>
          )}
        </div>
      </div>

      {/* Previous day, single compact box */}
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Previous Day
          {row.previousDay && <span className="normal-case font-normal text-foreground ml-1.5">{weekdayDateLabel(row.previousDay.date)}</span>}
        </p>
        {row.previousDay ? (
          <p className="text-xs tabular-nums mt-1">
            O: <span className="font-medium">{row.previousDay.open.toFixed(precision)}</span>{'  '}
            H: <span className="font-medium">{row.previousDay.high.toFixed(precision)}</span>{'  '}
            L: <span className="font-medium">{row.previousDay.low.toFixed(precision)}</span>{'  '}
            C: <span className="font-medium">{row.previousDay.close.toFixed(precision)}</span>{'  '}
            Range: <span className="font-medium">
              {(row.previousDay.high - row.previousDay.low).toFixed(precision)}
              {row.assetClass === 'FX' && fxPipCount(row.previousDay.high - row.previousDay.low, row.displayPrecision) != null &&
                ` (${fxPipCount(row.previousDay.high - row.previousDay.low, row.displayPrecision)} pips)`}
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground mt-1">No prior-day data available.</p>
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
      </div>

      {newsHeadline && (
        <div className="pl-2.5 border-l-2 border-primary/30">
          <p className="text-xs text-foreground leading-snug font-medium">{newsHeadline}</p>
        </div>
      )}

      {/* News & events, collapsible */}
      {row.eventRiskItems.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <button
            type="button"
            onClick={() => setNewsOpen(v => !v)}
            className="w-full flex items-center justify-between text-left"
          >
            <span className="text-xs font-medium text-amber-800">
              ⚠ {totalEventCount} high-impact event{totalEventCount === 1 ? '' : 's'} today
            </span>
            <span className="text-amber-700 text-xs">{newsOpen ? '▾' : '▸'}</span>
          </button>
          {!newsOpen && row.eventRiskItems[0] && (
            <p className="text-[11px] text-amber-700 mt-0.5">
              Next: {eventTimeUk(row.eventRiskItems[0].eventTimeUk)} {row.eventRiskItems[0].eventName}
            </p>
          )}
          {newsOpen && (
            <div className="space-y-1.5 mt-2">
              {row.eventRiskItems.map((ev, i) => (
                <div key={i} className="text-xs rounded-md border border-amber-200 bg-card px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-amber-800">
                      ⚠ {eventTimeUk(ev.eventTimeUk)} UK — {ev.eventName}
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
                <p className="text-[11px] text-amber-700">and {row.eventRiskOverflowCount} more event{row.eventRiskOverflowCount === 1 ? '' : 's'}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
