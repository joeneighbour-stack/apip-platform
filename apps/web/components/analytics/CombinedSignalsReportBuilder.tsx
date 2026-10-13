'use client'
import { useState } from 'react'
import {
  type SignalTypeData, type SignalTypeKey, type CombinedCumulativePoint,
  TYPE_LABELS, TYPE_ORDER, buildKeyCallouts,
} from '@/lib/combinedSignalAnalytics'
import type { ReportSafeUniverse } from '@/lib/reportSanitiser'
import { COMPANY_NAME, FCA_REGULATORY_STATEMENT, DISCLAIMER_PARAGRAPHS, PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import { formatR, formatPercent, formatDate } from '@/lib/format'
import { ReportHeader } from './report/ReportHeader'
import { ReportFooter } from './report/ReportFooter'
import { CombinedCumulativeChart } from './CombinedCumulativeChart'

// Same reasoning as PatternReportBuilder.tsx/AiSignalsReportBuilder.tsx's own header
// comments: a deliberately separate component, not shared with the other two signal-type
// reports or the internal analyst ReportBuilder -- this is an external, client-facing
// capability showcase spanning all three signal types at once, with its own fixed
// structure (no section toggles, no title/subtitle editing, no presets).
// TYPE_LABELS/TYPE_ORDER/buildKeyCallouts live in lib/combinedSignalAnalytics.ts (shared
// with CombinedSignalsTab.tsx) rather than being imported from that tab file directly --
// the tab dynamic-imports this report builder, so a static import back the other way
// would be a real circular module dependency.

interface Props {
  analyst: SignalTypeData
  patterns: SignalTypeData
  ai: SignalTypeData
  cumulativeR: CombinedCumulativePoint[]
  totalSignalsPerDay: number
  onClose: () => void
}

function monthYear(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

interface CombinedReportData {
  periodLabel: string
  dataThroughDate: string
  types: Record<SignalTypeKey, SignalTypeData>
  cumulativeR: CombinedCumulativePoint[]
  totalSignalsPerDay: number
  callouts: string[]
}

function buildReportData(
  analyst: SignalTypeData, patterns: SignalTypeData, ai: SignalTypeData,
  cumulativeR: CombinedCumulativePoint[], totalSignalsPerDay: number,
): CombinedReportData {
  const types: Record<SignalTypeKey, SignalTypeData> = { analyst, patterns, ai }
  const firstDates = TYPE_ORDER.map(k => types[k].summary.firstSignalDate).filter((d): d is string => d !== null)
  const lastDates = TYPE_ORDER.map(k => types[k].summary.lastSignalDate).filter((d): d is string => d !== null)
  const earliest = firstDates.length > 0 ? firstDates.reduce((a, b) => b < a ? b : a) : null
  const latest = lastDates.length > 0 ? lastDates.reduce((a, b) => b > a ? b : a) : null

  return {
    periodLabel: earliest && latest ? `${monthYear(earliest)} – ${monthYear(latest)}` : 'No data available',
    dataThroughDate: latest ? formatDate(latest) : 'N/A',
    types,
    cumulativeR,
    totalSignalsPerDay,
    callouts: buildKeyCallouts(types),
  }
}

function ComparisonTable({ types }: { types: Record<SignalTypeKey, SignalTypeData> }) {
  return (
    <table className="w-full text-[9pt]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="border-b border-black/20 text-left">
          <th className="py-1.5 pr-2 font-semibold">Signal Type</th>
          <th className="py-1.5 px-2 font-semibold text-right">Total Signals</th>
          <th className="py-1.5 px-2 font-semibold text-right">Win Rate</th>
          <th className="py-1.5 px-2 font-semibold text-right">Avg R</th>
          <th className="py-1.5 px-2 font-semibold text-right">Total R</th>
          <th className="py-1.5 px-2 font-semibold text-right">Max DD (R)</th>
          <th className="py-1.5 pl-2 font-semibold text-right">Since</th>
        </tr>
      </thead>
      <tbody>
        {TYPE_ORDER.map(key => {
          const d = types[key]
          return (
            <tr key={key} className="border-b border-black/10">
              <td className="py-1.5 pr-2">{TYPE_LABELS[key]}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{d.summary.totalSignals.toLocaleString()}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{formatPercent(d.summary.winRate)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{formatR(d.summary.avgR)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{formatR(d.summary.totalR)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{formatR(d.summary.maxDrawdownR)}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{d.summary.firstSignalDate ? formatDate(d.summary.firstSignalDate) : '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// Rendered off-screen (not display:none) so Recharts' ResponsiveContainer has real
// layout dimensions before printing -- same reasoning as the other report builders.
function CombinedSignalsReportView({ data }: { data: CombinedReportData }) {
  const headerUniverse: ReportSafeUniverse = {
    title: 'Acuity Signal Intelligence — Combined Performance Report',
    subtitle: data.periodLabel,
    periodLabel: '',
    filterSummary: data.periodLabel,
    tradeCount: TYPE_ORDER.reduce((s, k) => s + data.types[k].summary.totalSignals, 0),
    generatedAt: new Date().toISOString(),
    dataThrough: data.dataThroughDate,
  }

  return (
    <div className="absolute -left-[9999px] top-0 print:static print:left-auto w-[210mm] print:w-auto bg-white text-black text-[10pt] leading-snug">
      {/* PAGE 1 -- Cover & Signal Output */}
      <section className="break-after-page p-2">
        <ReportHeader universe={headerUniverse} />
        <p className="mt-1 mb-4 text-[9pt] font-medium border border-black/20 rounded px-3 py-2 bg-black/[0.03]">
          {PAST_PERFORMANCE_WARNING}
        </p>

        <div className="mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Signal Output</h2>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {TYPE_ORDER.map(key => {
              const d = data.types[key]
              return (
                <div key={key} className="border border-black/15 rounded px-2.5 py-2">
                  <p className="text-[7.5pt] text-black/60">{TYPE_LABELS[key]}</p>
                  <p className="text-[13pt] font-semibold tabular-nums">{d.summary.totalSignals.toLocaleString()}</p>
                  <p className="text-[7.5pt] text-black/60">
                    {d.summary.firstSignalDate && d.summary.lastSignalDate
                      ? `${formatDate(d.summary.firstSignalDate)} – ${formatDate(d.summary.lastSignalDate)}`
                      : 'No signals yet'}
                  </p>
                </div>
              )
            })}
          </div>
          <p className="text-[9pt] leading-relaxed">
            Across all signal types, Acuity publishes an average of {data.totalSignalsPerDay.toFixed(1)} signals per trading day.
          </p>
        </div>

        <ReportFooter pageLabel="Page 1" />
      </section>

      {/* PAGE 2 -- Performance Comparison */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Performance Comparison</h2>
        <ComparisonTable types={data.types} />
        <ReportFooter pageLabel="Page 2" />
      </section>

      {/* PAGE 3 -- Cumulative R chart */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Cumulative Performance by Signal Type (R)</h2>
        <div className="mb-2"><CombinedCumulativeChart data={data.cumulativeR} /></div>
        <p className="text-[8.5pt] text-black/70">
          Cumulative R measures the total return expressed as a multiple of initial risk across all closed signals of each type.
        </p>
        <ReportFooter pageLabel="Page 3" />
      </section>

      {/* PAGE 4 -- Key Callouts */}
      <section className="break-after-page p-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2">Key Callouts</h2>
        {data.callouts.length === 0 ? (
          <p className="text-[9pt] text-black/60">Insufficient data to generate callouts yet.</p>
        ) : (
          <ul className="list-disc pl-4 space-y-1.5 text-[9pt]">
            {data.callouts.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        )}
        <ReportFooter pageLabel="Page 4" />
      </section>

      {/* FINAL PAGE -- Methodology & Regulatory. FCA statement, disclaimer, sanctions
          line and past-performance warning are always rendered -- there is no toggle
          anywhere in this report that could omit them. */}
      <section className="p-2">
        <div className="text-[8.5pt] leading-relaxed text-black/80 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-black">Methodology, Risk &amp; Regulatory Information</h2>

          <div className="space-y-1">
            <h3 className="text-[9pt] font-semibold text-black">Methodology</h3>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>This report combines three independently tracked signal types: Analyst Signals (recommendations published by Acuity&rsquo;s human analyst team), Pattern Signals (Acuity&rsquo;s chart pattern recognition engine), and AI Signals (Acuity&rsquo;s AI signal engine).</li>
              <li>R (risk multiple) measures each signal&rsquo;s outcome relative to its initial planned risk (stop distance), normalising results so they are directly comparable across signal types, instruments, and position sizes.</li>
              <li>AI Signal statistics include trades that closed at expiry with a recorded R, alongside signals that closed via take-profit or stop-loss. Pattern Signal statistics currently count only take-profit/stop-loss closes.</li>
              <li>Pattern and AI Signals are generated entirely algorithmically and tracked in real time from publication; Analyst Signals are published by human analysts.</li>
            </ul>
          </div>

          <div className="space-y-1">
            <h3 className="text-[9pt] font-semibold text-black">Regulatory Statement</h3>
            <p>{FCA_REGULATORY_STATEMENT}</p>
          </div>

          <div className="space-y-1">
            <h3 className="text-[9pt] font-semibold text-black">Disclaimer</h3>
            {DISCLAIMER_PARAGRAPHS.map((p, i) => <p key={i}>{p}</p>)}
          </div>

          <p className="font-semibold text-black">{PAST_PERFORMANCE_WARNING}</p>

          <p className="text-[7.5pt] text-black/50 pt-2 border-t border-black/10">
            © {new Date().getFullYear()} {COMPANY_NAME}. This document is confidential and intended solely for the named recipient.
          </p>
        </div>
        <ReportFooter pageLabel="Final Page" />
      </section>
    </div>
  )
}

export function CombinedSignalsReportBuilder({ analyst, patterns, ai, cumulativeR, totalSignalsPerDay, onClose }: Props) {
  const [reportData, setReportData] = useState<CombinedReportData | null>(null)

  function handleGenerate() {
    const data = buildReportData(analyst, patterns, ai, cumulativeR, totalSignalsPerDay)
    setReportData(data)

    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'))
      setTimeout(() => window.print(), 80)
    })
  }

  const hasData = TYPE_ORDER.some(key => ({ analyst, patterns, ai }[key].summary.totalSignals > 0))

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 print:hidden" onClick={onClose} />
      <div className="fixed inset-x-4 top-8 bottom-8 sm:inset-x-auto sm:right-8 sm:w-[26rem] bg-card border border-border rounded-lg shadow-xl z-50 flex flex-col print:hidden">
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <p className="text-sm font-semibold">Generate Combined Performance Report</p>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto grow text-xs text-muted-foreground">
          <p>
            A fixed, client-ready summary spanning all three signal types: signal output,
            performance comparison, cumulative performance, and key callouts drawn from
            live data.
          </p>
          <p>No signal type here carries analyst identity, so this report is safe to share externally.</p>
        </div>

        <div className="p-4 border-t border-border shrink-0">
          <button onClick={handleGenerate} disabled={!hasData}
            className="w-full text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            Generate Report
          </button>
          {!hasData && (
            <p className="text-[11px] text-muted-foreground mt-1.5">No data available yet.</p>
          )}
        </div>
      </div>

      {reportData && <CombinedSignalsReportView data={reportData} />}
    </>
  )
}
