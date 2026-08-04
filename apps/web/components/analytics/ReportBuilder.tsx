'use client'
import { useEffect, useState } from 'react'
import {
  type MetricsTrade, type MetricsPublication, type AttributionRow,
  triggeredTrades, isTriggeredWithResult, computeSummary, cumulativeSeries, drawdownSeries,
  rollingWindows, monthlyMatrix, attributionBy, computeTradeStatistics, resultDistribution,
  distinctAnalystCount,
} from '@/lib/metrics'
import {
  type ReportData, type ReportSections, type ReportAttributionDimension, type ReportSafeTrade,
  sanitiseReport, MIN_ANALYSTS_FOR_TRADE_LEVEL_SECTIONS,
} from '@/lib/reportSanitiser'
import { COMPANY_NAME, FCA_REGULATORY_STATEMENT, DISCLAIMER_PARAGRAPHS, PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import { formatDate } from '@/lib/format'
import type { DateRange } from '@/lib/dateRanges'
import { PerformanceReport } from './report/PerformanceReport'

interface Props {
  trades: MetricsTrade[]
  pubs: MetricsPublication[]
  previousTrades: MetricsTrade[] | null
  previousPubs: MetricsPublication[]
  dateRange: DateRange
  comparisonLabel: string
  defaultTitle: string
  defaultSubtitle: string
  dataThroughDate: string
  onClose: () => void
}

const SECTION_DEFS: { key: keyof ReportSections; label: string }[] = [
  { key: 'executiveSummary', label: 'Executive Summary' },
  { key: 'cumulativePerformance', label: 'Cumulative Performance' },
  { key: 'drawdown', label: 'Drawdown' },
  { key: 'rollingPerformance', label: 'Rolling Performance' },
  { key: 'monthlyPerformance', label: 'Monthly Performance' },
  { key: 'attribution', label: 'Attribution' },
  { key: 'contribution', label: 'Contribution Analysis' },
  { key: 'tradeStatistics', label: 'Trade Statistics' },
  { key: 'bestWorst', label: 'Best / Worst Trades' },
  { key: 'methodology', label: 'Methodology' },
]

const DEFAULT_SECTIONS: ReportSections = {
  executiveSummary: true, cumulativePerformance: true, drawdown: true, rollingPerformance: true,
  monthlyPerformance: true, attribution: true, contribution: true, tradeStatistics: true,
  bestWorst: true, methodology: true,
}

// Report-safe attribution dimensions only -- 'analyst' is not a member of this union
// and no UI here offers it, so there is no control that could expose it.
const DIMENSION_OPTIONS: { key: ReportAttributionDimension; label: string }[] = [
  { key: 'asset_class', label: 'Asset Class' },
  { key: 'market', label: 'Market' },
  { key: 'strategy', label: 'Strategy' },
]

function dimensionFn(dim: ReportAttributionDimension): (t: MetricsTrade) => { key: string; label: string } {
  if (dim === 'asset_class') return t => ({ key: t.asset_class, label: t.asset_class })
  if (dim === 'market') return t => ({ key: t.market_id, label: t.symbol })
  return () => ({ key: 'HUMAN_ANALYST', label: 'Human Analyst' })
}

function toReportSafeTrade(t: MetricsTrade): ReportSafeTrade {
  return { date: t.published_at.slice(0, 10), symbol: t.symbol, direction: t.direction, resultR: t.result_r ?? 0 }
}

interface Preset {
  name: string
  title: string
  subtitle: string
  sections: ReportSections
  attributionDimensions: ReportAttributionDimension[]
}

const PRESETS_KEY = 'apip-analytics-report-presets'

function loadPresets(): Preset[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(window.localStorage.getItem(PRESETS_KEY) ?? '[]') } catch { return [] }
}

function savePresets(presets: Preset[]) {
  window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
}

export function ReportBuilder({
  trades, pubs, previousTrades, previousPubs, dateRange, comparisonLabel,
  defaultTitle, defaultSubtitle, dataThroughDate, onClose,
}: Props) {
  const [title, setTitle] = useState(defaultTitle)
  const [subtitle, setSubtitle] = useState(defaultSubtitle)
  const [sections, setSections] = useState<ReportSections>(DEFAULT_SECTIONS)
  const [attributionDimensions, setAttributionDimensions] = useState<ReportAttributionDimension[]>(['asset_class'])
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [errors, setErrors] = useState<string[] | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetName, setPresetName] = useState('')

  useEffect(() => { setPresets(loadPresets()) }, [])

  function toggleSection(key: keyof ReportSections) {
    setSections(s => ({ ...s, [key]: !s[key] }))
  }
  function toggleDimension(key: ReportAttributionDimension) {
    setAttributionDimensions(dims => dims.includes(key) ? dims.filter(d => d !== key) : [...dims, key])
  }

  function applyPreset(preset: Preset) {
    setTitle(preset.title)
    setSubtitle(preset.subtitle)
    setSections(preset.sections)
    setAttributionDimensions(preset.attributionDimensions)
  }
  function saveCurrentAsPreset() {
    if (!presetName.trim()) return
    const next = [...presets.filter(p => p.name !== presetName), { name: presetName, title, subtitle, sections, attributionDimensions }]
    setPresets(next)
    savePresets(next)
    setPresetName('')
  }
  function deletePreset(name: string) {
    const next = presets.filter(p => p.name !== name)
    setPresets(next)
    savePresets(next)
  }

  function handleGenerate() {
    const distinctAnalysts = distinctAnalystCount(trades)
    const allowTradeLevelSections = distinctAnalysts >= MIN_ANALYSTS_FOR_TRADE_LEVEL_SECTIONS

    const summary = computeSummary(trades, pubs)
    const previousSummary = previousTrades ? computeSummary(previousTrades, previousPubs) : null

    const attribution: Partial<Record<ReportAttributionDimension, AttributionRow[]>> = {}
    const contribution: Partial<Record<ReportAttributionDimension, AttributionRow[]>> = {}
    for (const dim of attributionDimensions) {
      const rows = attributionBy(trades, dimensionFn(dim))
      attribution[dim] = rows
      contribution[dim] = rows
    }

    const triggered = triggeredTrades(trades).filter(isTriggeredWithResult)
    const sortedByResult = [...triggered].sort((a, b) => (b.result_r ?? 0) - (a.result_r ?? 0))
    const best = sortedByResult.slice(0, 10).map(toReportSafeTrade)
    const worst = sortedByResult.slice(-10).reverse().map(toReportSafeTrade)

    const data: ReportData = {
      universe: {
        title, subtitle,
        periodLabel: `${formatDate(dateRange.start)} – ${formatDate(dateRange.end)}`,
        filterSummary: subtitle,
        tradeCount: triggered.length,
        generatedAt: new Date().toISOString(),
        dataThrough: dataThroughDate,
      },
      sections: { ...sections, bestWorst: sections.bestWorst && allowTradeLevelSections },
      attributionDimensions,
      summary,
      comparison: previousSummary ? { current: summary, previous: previousSummary, label: comparisonLabel } : null,
      cumulative: cumulativeSeries(trades),
      drawdown: drawdownSeries(trades),
      rolling: rollingWindows(trades, new Date()),
      monthly: monthlyMatrix(trades),
      attribution,
      contribution,
      tradeStats: computeTradeStatistics(trades, pubs),
      distribution: resultDistribution(trades),
      bestWorst: allowTradeLevelSections ? { best, worst } : null,
      distinctAnalystCount: distinctAnalysts,
      compliance: {
        logoPresent: true,
        companyName: COMPANY_NAME,
        fcaStatement: FCA_REGULATORY_STATEMENT,
        disclaimer: DISCLAIMER_PARAGRAPHS,
        pastPerformanceWarning: PAST_PERFORMANCE_WARNING,
      },
    }

    const result = sanitiseReport(data)
    if (!result.ok) {
      setErrors(result.errors)
      setReportData(null)
      return
    }
    setErrors(null)
    setReportData(data)

    // The report mounts off-screen (not display:none) specifically so chart libraries
    // have already measured their container by the time print fires -- still nudge a
    // resize event as defence-in-depth before triggering the native print dialog.
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'))
      setTimeout(() => window.print(), 80)
    })
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 print:hidden" onClick={onClose} />
      <div className="fixed inset-x-4 top-8 bottom-8 sm:inset-x-auto sm:right-8 sm:w-[26rem] bg-card border border-border rounded-lg shadow-xl z-50 flex flex-col print:hidden">
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <p className="text-sm font-semibold">Generate Report</p>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto grow">
          {presets.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Saved Presets</p>
              <div className="flex flex-wrap gap-1.5">
                {presets.map(p => (
                  <span key={p.name} className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border">
                    <button onClick={() => applyPreset(p)} className="hover:text-primary transition-colors">{p.name}</button>
                    <button onClick={() => deletePreset(p.name)} className="text-muted-foreground hover:text-red-600">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Report Title</p>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full text-sm px-2.5 py-1.5 rounded-md border border-border bg-background" />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Subtitle / Description</p>
            <input value={subtitle} onChange={e => setSubtitle(e.target.value)}
              className="w-full text-sm px-2.5 py-1.5 rounded-md border border-border bg-background" />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Sections to Include</p>
            <div className="space-y-1">
              {SECTION_DEFS.map(s => (
                <label key={s.key} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={sections[s.key]} onChange={() => toggleSection(s.key)} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Attribution Breakdown (report-safe)</p>
            <div className="space-y-1">
              {DIMENSION_OPTIONS.map(d => (
                <label key={d.key} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={attributionDimensions.includes(d.key)} onChange={() => toggleDimension(d.key)} />
                  {d.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground">Save as Preset</p>
            <div className="flex gap-2">
              <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Preset name"
                className="flex-1 text-xs px-2.5 py-1.5 rounded-md border border-border bg-background" />
              <button onClick={saveCurrentAsPreset} className="text-xs px-2.5 py-1.5 rounded-md border border-border hover:border-primary/50 transition-colors">
                Save
              </button>
            </div>
          </div>

          {errors && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-1">
              <p className="text-xs font-medium text-red-700">Report generation blocked</p>
              <ul className="text-xs text-red-700 list-disc pl-4">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Analyst identities are never included in generated reports. The FCA regulatory statement,
            disclaimer, sanctions statement and past-performance warning are mandatory and cannot be
            removed here.
          </p>
        </div>

        <div className="p-4 border-t border-border shrink-0">
          <button onClick={handleGenerate}
            className="w-full text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            Generate Report
          </button>
        </div>
      </div>

      {reportData && <PerformanceReport data={reportData} />}
    </>
  )
}
