import { notFound } from 'next/navigation'
import { getAnalystProfileData } from '@/lib/analystProfile'
import { KpiSummary } from './KpiSummary'
import { PerformanceBreakdown } from './PerformanceBreakdown'
import { CompliancePanel } from './CompliancePanel'
import { TradeHistoryTable } from './TradeHistoryTable'
import { MarketNews } from './MarketNews'

interface Props {
  analystId: string
  subtitle: string
  backHref?: string
  backLabel?: string
  // 'kpi-only' renders just the KPI tiles + monthly history table (KpiSummary) -- used by
  // the analyst's own My KPIs tab, which has dedicated pages elsewhere for recommendations
  // (My Workspace), the trade log (My Monitor), and performance breakdown (the My
  // Performance tab), so showing them again here would just be duplication.
  mode?: 'full' | 'kpi-only'
}

function validityLabel(status: string | null): { label: string; color: string } | null {
  switch (status) {
    case 'DO_NOT_USE_RECALCULATE': return { label: 'Levels outdated', color: 'text-red-700' }
    case 'ENTRY_ALREADY_PASSED':   return { label: 'Entry passed', color: 'text-amber-600' }
    case 'STALE_PRICE':
    case 'CAUTION_VOLATILITY':
    case 'ZONE_CHANGED':           return { label: 'High volatility', color: 'text-amber-600' }
    default: return null
  }
}

function stripBoilerplate(note: string | null): string {
  if (!note) return ''
  return note
    .replace('Treat this as a coaching range rather than an instruction; execution judgement remains important.', '')
    .replace('The historical profile favours', 'Historical profile favours')
    .trim()
}

// Shared between the management analyst-profile page (/dashboard/management/analyst/[analystId])
// and the analyst's own "My KPIs" tab (/dashboard/analyst/performance) -- same layout, same
// data, same queries (see lib/analystProfile.ts) regardless of who's viewing. subtitle/backHref
// are the only things that differ between the two callers.
export async function AnalystProfileContent({ analystId, subtitle, backHref, backLabel = 'Back', mode = 'full' }: Props) {
  const data = await getAnalystProfileData(analystId, mode)
  if (!data.analyst) notFound()

  const {
    analyst, recommendations, eventsByMarket, kpis, kpiTrend,
    monthR, monthTradeCount, winRate, allTrades, recentTradesWithDetails,
    reviews, disputesByTradeId,
  } = data

  if (mode === 'kpi-only') {
    return <KpiSummary kpis={kpis} kpiTrend={kpiTrend} />
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{analyst.display_name}</h1>
            {!analyst.active && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Inactive</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
        {backHref && (
          <a href={backHref} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            &larr; {backLabel}
          </a>
        )}
      </div>

      {/* This month quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">This Month Return</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${monthR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {monthR > 0 ? '+' : ''}{monthR.toFixed(2)}R
          </p>
          <p className="text-xs text-muted-foreground mt-1">{monthTradeCount} closed trades</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Win Rate</p>
          <p className={`text-2xl font-semibold mt-1 ${winRate !== null && winRate >= 50 ? 'text-green-700' : 'text-muted-foreground'}`}>
            {winRate !== null ? `${winRate}%` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">All Time Trades</p>
          <p className="text-2xl font-semibold mt-1">{allTrades.length.toLocaleString()}</p>
        </div>
      </div>

      {/* Today's Recommendations */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          Today&apos;s Recommendations
          <span className="ml-2 text-xs font-normal text-muted-foreground">({recommendations.length} markets)</span>
        </h2>
        {recommendations.length === 0 ? (
          <div className="rounded-lg border border-border p-6">
            <p className="text-sm text-muted-foreground">No recommendations generated yet for today.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recommendations.map((rec: any) => {
              const opp = rec.opportunity
              const symbol = opp?.market?.symbol ?? '—'
              const direction = opp?.direction ?? null
              const action = opp?.analyst_action ?? ''
              const validity = rec.recommendation_version?.recommendation_validity_status ?? 'VALID'
              const vLabel = validityLabel(validity)
              const marketId = opp?.market?.market_id
              const events = marketId ? (eventsByMarket.get(marketId) ?? []) : []
              const isDoNotUse = validity === 'DO_NOT_USE_RECALCULATE'
              const note = stripBoilerplate(rec.coaching_note)

              return (
                <div key={rec.recommendation_id}
                  className={`rounded-lg border p-4 space-y-3 ${isDoNotUse ? 'border-red-200 bg-red-50/20 opacity-60' : 'border-border bg-card'}`}>

                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{symbol}</span>
                      {direction && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>{direction}</span>
                      )}
                      {action === 'ENTER_NOW' && !isDoNotUse && (
                        <span className="text-xs font-medium text-green-700">&#9889;</span>
                      )}
                    </div>
                    {vLabel && <span className={`text-xs font-medium ${vLabel.color}`}>{vLabel.label}</span>}
                  </div>

                  {/* Trigger / Expected R */}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Trigger <span className="font-medium text-foreground">
                      {rec.trigger_probability ? `${Math.round(rec.trigger_probability * 100)}%` : '—'}
                    </span></span>
                    <span>Expected R <span className={`font-medium ${(rec.expected_r ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {rec.expected_r != null ? `${Number(rec.expected_r) > 0 ? '+' : ''}${Number(rec.expected_r).toFixed(2)}R` : '—'}
                    </span></span>
                  </div>

                  {/* Event risk */}
                  {events.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {events.map((e, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">
                          &#9888; {e}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* News */}
                  <MarketNews symbols={[symbol]} />

                  {/* Levels */}
                  {!isDoNotUse && (
                    <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/60">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Entry</p>
                        <p className="text-xs font-medium tabular-nums">
                          {Number(rec.entry_range_low).toFixed(4)}&ndash;{Number(rec.entry_range_high).toFixed(4)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Risk</p>
                        <p className="text-xs font-medium tabular-nums">{rec.risk_range ?? '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Target</p>
                        <p className="text-xs font-medium tabular-nums">{rec.target_range ?? '—'}</p>
                      </div>
                    </div>
                  )}

                  {/* Coaching note */}
                  {note && !isDoNotUse && (
                    <p className="text-xs text-muted-foreground leading-relaxed pt-1 border-t border-border/60">
                      {note}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* KPI Summary */}
      <KpiSummary kpis={kpis} kpiTrend={kpiTrend} />

      {/* Performance Breakdown */}
      <PerformanceBreakdown trades={allTrades} />

      {/* Coaching Compliance */}
      <CompliancePanel reviews={reviews} />

      {/* 30-day Trade Log */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Trade Log &mdash; Last 30 Days</h2>
        <TradeHistoryTable
          trades={recentTradesWithDetails}
          analystId={analystId}
          disputesByTradeId={disputesByTradeId}
        />
      </section>
    </div>
  )
}
