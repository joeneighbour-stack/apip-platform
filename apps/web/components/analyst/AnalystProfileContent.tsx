import { notFound } from 'next/navigation'
import { getAnalystProfileData } from '@/lib/analystProfile'
import { KpiSummary, PerformanceBreakdown } from './LazyCharts'
import { CompliancePanel } from './CompliancePanel'

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

// Shared between the management analyst-profile page (/dashboard/management/analyst/
// [analystId], mode='kpi-only' with backHref) and the analyst's own "My KPIs" tab
// (/dashboard/analyst/performance, mode='kpi-only' with no backHref). The management
// "full profile" page (.../[analystId]/full) that used to call this with mode='full' was
// removed and hasn't come back -- that branch below is therefore currently unreachable;
// left in place rather than deleted since trimming it wasn't asked for.
export async function AnalystProfileContent({ analystId, subtitle, backHref, backLabel = 'Back', mode = 'full' }: Props) {
  const data = await getAnalystProfileData(analystId, mode)
  if (!data.analyst) notFound()

  const {
    analyst, kpis, kpiTrend,
    monthR, monthTradeCount, winRate, allTrades,
    reviews,
  } = data

  if (mode === 'kpi-only') {
    // backHref is only ever passed by the management caller (the analyst's own "My KPIs"
    // tab omits it, since that page already has its own header) -- used here as the signal
    // for whether this needs its own header, rather than a separate boolean prop.
    if (!backHref) {
      return <KpiSummary kpis={kpis} kpiTrend={kpiTrend} />
    }
    return (
      <div className="space-y-4">
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
          <div className="flex items-center gap-3 shrink-0">
            <a href={backHref} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              &larr; {backLabel}
            </a>
          </div>
        </div>
        <KpiSummary kpis={kpis} kpiTrend={kpiTrend} />
      </div>
    )
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

      {/* KPI Summary */}
      <KpiSummary kpis={kpis} kpiTrend={kpiTrend} />

      {/* Performance Breakdown */}
      <PerformanceBreakdown trades={allTrades} />

      {/* Coaching Compliance */}
      <CompliancePanel reviews={reviews} />
    </div>
  )
}
