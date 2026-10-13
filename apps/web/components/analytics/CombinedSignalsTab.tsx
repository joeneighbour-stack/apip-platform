'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  type SignalTypeData, TYPE_LABELS, TYPE_ORDER, buildKeyCallouts,
} from '@/lib/combinedSignalAnalytics'
import { formatR, formatPercent, formatDate, positivityClass } from '@/lib/format'
import { PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import { CombinedCumulativeChart } from './LazyCharts'

// Combined Signals reports use their own component (CombinedSignalsReportBuilder), not
// PatternReportBuilder/AiSignalsReportBuilder -- see that file's own header comment.
// Dynamic-imported for the same reason as the other tabs' own report builder imports:
// keeps recharts out of the initial bundle until the user clicks "Generate Report".
const CombinedSignalsReportBuilder = dynamic(
  () => import('./CombinedSignalsReportBuilder').then(m => ({ default: m.CombinedSignalsReportBuilder })),
  { ssr: false },
)

interface CombinedApiResponse {
  analyst: SignalTypeData
  patterns: SignalTypeData
  ai: SignalTypeData
  // AI-only -- analyst/patterns have no reiteration concept (see /api/analytics/combined's
  // own comment). The `ai` row's own totalSignals/winRate/avgR/totalR are already
  // deduplicated (is_reiteration = false), same figures the AI Signals tab itself shows.
  aiReiterations: number
  combined: {
    cumulativeR: { date: string; analyst: number | null; patterns: number | null; ai: number | null }[]
  }
}

function dateRangeLabel(first: string | null, last: string | null): string {
  if (!first || !last) return 'No signals yet'
  return `${formatDate(first)} – ${formatDate(last)}`
}

// Headline is totalPublished (every row actually published, including AI reiterations)
// rather than totalSignals (the deduplicated, performance-relevant count used in the
// comparison table below) -- this strip is about signal OUTPUT, not performance.
//
// No triggered subtitle on any tile, including Analyst Signals: `triggered` on
// actual_trades looked like a real ~35% "did price enter the zone" rate overall, but
// broken down by source it's set to true on 100% of MANUAL_BACKFILL rows (91% of the
// table) -- an import-time default, not a real outcome -- and only genuinely selective
// (~29%) on the live ACUITY_PERFORMANCE_API feed. The table-wide figure (93.7% true) is
// therefore an import-methodology artifact, not a meaningful trigger rate, so it's
// omitted here the same way it already is for Pattern/AI Signals (which have no
// untriggered state to distinguish at all).
function SummaryTile({ label, data }: { label: string; data: SignalTypeData }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{data.summary.totalPublished.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{dateRangeLabel(data.summary.firstSignalDate, data.summary.lastSignalDate)}</p>
    </div>
  )
}

export function CombinedSignalsTab() {
  const [data, setData] = useState<CombinedApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/analytics/combined')
      .then(r => r.json())
      .then((json: CombinedApiResponse | { error: string }) => {
        if ('error' in json) { setError(json.error); return }
        setData(json)
      })
      .catch(() => setError('Failed to load combined signal data.'))
      .finally(() => setLoading(false))
  }, [])

  const callouts = useMemo(() => data ? buildKeyCallouts({ analyst: data.analyst, patterns: data.patterns, ai: data.ai }) : [], [data])

  return (
    <>
    {/* print:hidden is scoped to the dashboard chrome only, matching PatternsTab.tsx/
        AiSignalsTab.tsx's own root return -- CombinedSignalsReportBuilder (and the print
        layout it mounts) renders as a sibling below, outside this div. */}
    <div className="space-y-6 print:hidden">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-border p-12 text-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : data && (
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="grid grow grid-cols-1 gap-3 sm:grid-cols-3">
              <SummaryTile label="Analyst Signals" data={data.analyst} />
              <SummaryTile label="Pattern Signals" data={data.patterns} />
              <SummaryTile label="AI Signals" data={data.ai} />
            </div>
            <button onClick={() => setReportOpen(true)}
              className="shrink-0 text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              Generate Report
            </button>
          </div>

          {/* No "signals per trading day" callout here -- actual_trades's historical
              (MANUAL_BACKFILL) rows only ever recorded triggered trades, not every
              published recommendation, so totalPublished for Analyst Signals undercounts
              true publication volume and any per-day average built from it would be
              understated and misleading (same reasoning already applied to the removed
              "X% triggered" callout: don't show a number the underlying data can't
              actually support). */}

          {/* Total Signals here is totalPublished (so the three rows are comparable
              signal-output figures) -- Win Rate/Avg R/Total R/Max DD still reflect each
              type's own canonical performance population (deduplicated for AI), so the
              AI row's own "Total Signals" number won't match the sample size behind its
              other columns. That's the deliberate tradeoff: a comparable headline count
              across rows, at the cost of one row's internal consistency. */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Performance Comparison</p>
            <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {['Signal Type', 'Total Signals', 'Win Rate', 'Avg R', 'Total R', 'Max DD (R)', 'Since'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {TYPE_ORDER.map(key => {
                    const d = data[key]
                    return (
                      <tr key={key} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap">{TYPE_LABELS[key]}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">
                          {d.summary.totalPublished.toLocaleString()}
                          {key === 'ai' && data.aiReiterations > 0 && (
                            <span className="text-[11px] text-muted-foreground/70"> (of which {data.aiReiterations.toLocaleString()} reiterations)</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatPercent(d.summary.winRate)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{formatR(d.summary.avgR)}</td>
                        <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${positivityClass(d.summary.totalR)}`}>{formatR(d.summary.totalR)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-red-700 whitespace-nowrap">{formatR(d.summary.maxDrawdownR)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{d.summary.firstSignalDate ? formatDate(d.summary.firstSignalDate) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <CombinedCumulativeChart data={data.combined.cumulativeR} />

          {callouts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Key Callouts</p>
              <ul className="space-y-2">
                {callouts.map((c, i) => (
                  <li key={i} className="rounded-lg border border-border bg-muted/30 p-4 text-sm">{c}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs font-medium border border-border rounded-md px-3 py-2 bg-muted/20 text-muted-foreground">
            {PAST_PERFORMANCE_WARNING}
          </p>
        </div>
      )}
    </div>

    {reportOpen && data && (
      <CombinedSignalsReportBuilder
        analyst={data.analyst} patterns={data.patterns} ai={data.ai}
        cumulativeR={data.combined.cumulativeR}
        onClose={() => setReportOpen(false)}
      />
    )}
    </>
  )
}
