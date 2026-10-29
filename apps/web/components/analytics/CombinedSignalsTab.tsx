'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  type EnrichedSignal, type SignalTypeKey, type SignalTypeData, type CumulativeRPoint,
  TYPE_LABELS, TYPE_ORDER, buildSignalTypeData, mergeCumulativeSeries, normaliseToIndex,
  buildAssetClassBreakdown, buildDayOfWeekBreakdown, buildMonthBreakdown, buildYearGrid, buildTopMarkets,
  buildKeyCallouts, monthYear,
} from '@/lib/combinedSignalAnalytics'
import type { PatternTradePoint } from '@/lib/patternAnalytics'
import type { AiTradePoint } from '@/lib/aiSignalAnalytics'
import { formatR, formatPercent, formatDate, positivityClass } from '@/lib/format'
import { PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import { CombinedCumulativeChart, SignalsByPeriodChart } from './LazyCharts'
import { Tooltip } from '@/components/ui/Tooltip'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { type CombinedFilterState, DEFAULT_COMBINED_FILTERS, hasActiveCombinedFilters } from '@/lib/analyticsFilters'
import { DATE_PRESET_OPTIONS, resolveDateRange } from '@/lib/dateRanges'

// Combined Signals reports use their own component (CombinedSignalsReportBuilder), not
// PatternReportBuilder/AiSignalsReportBuilder -- see that file's own header comment.
// Dynamic-imported for the same reason as the other tabs' own report builder imports:
// keeps recharts out of the initial bundle until the user clicks "Generate Report".
const CombinedSignalsReportBuilder = dynamic(
  () => import('./CombinedSignalsReportBuilder').then(m => ({ default: m.CombinedSignalsReportBuilder })),
  { ssr: false },
)

// Raw actual_trades row shape returned by /api/analytics/trades -- no shared type for
// this exists elsewhere (MetricsTrade is an already-normalized shape built from this),
// so it's defined locally, same convention as PatternTradePoint/AiTradePoint already
// being imported as-is for the other two raw sources.
interface Analyst { analyst_id: string; display_name: string; active: boolean }

interface RawAnalystRow {
  analyst_id: string
  direction: string | null
  result_r: number | null
  triggered: boolean | null
  published_at: string
  session: string | null
  market: { market_id: string; symbol: string; asset_class: string } | null
}

// Same outcome-status gating /api/analytics/combined's route applies server-side --
// duplicated here now that this tab builds EnrichedSignal arrays client-side instead of
// receiving them pre-built.
const PATTERN_OUTCOME_STATUSES = new Set(['Closed - Profit', 'Closed - Loss'])
const AI_OUTCOME_STATUSES = new Set(['Closed - Profit', 'Closed - Loss', 'Closed - Flat', 'Expired'])

// Same literal option sets as AnalyticsFilters.tsx's own (unexported) constants --
// duplicated rather than shared, matching this codebase's existing convention of
// self-contained sibling tab components (see e.g. PatternsTab.tsx/AiSignalsTab.tsx's
// identical copies).
const DIRECTION_OPTIONS = [{ value: 'BUY', label: 'BUY' }, { value: 'SELL', label: 'SELL' }]
const SESSION_OPTIONS = [
  { value: 'EUROPEAN', label: 'European' }, { value: 'US', label: 'US' },
  { value: 'APAC', label: 'APAC' }, { value: 'CRYPTO', label: 'Crypto' },
]

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Computed, not hardcoded to 2026 -- this code will still be running in 2027+, and a
// literal year check would silently mislabel every future "current year" row as a plain
// completed year instead of "YTD".
const CURRENT_YEAR = new Date().getUTCFullYear()

function dateRangeLabel(first: string | null, last: string | null): string {
  if (!first || !last) return 'No signals yet'
  return `${formatDate(first)} – ${formatDate(last)}`
}

// Same CumulativeRPoint <-> NormalisedPoint rebasing wrapper /api/analytics/combined's
// route used to keep private to itself (toIndexedCumulative) -- needed here now that
// the normalised equity curve is built client-side from filtered data instead of
// arriving pre-built in the API response.
function toIndexedCumulative(points: CumulativeRPoint[]): CumulativeRPoint[] {
  return normaliseToIndex(points.map(p => ({ date: p.date, value: p.cumulativeR })))
    .map(p => ({ date: p.date, cumulativeR: p.value }))
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

// Fixed, literal Tailwind class strings (never interpolated) so the production build's
// content scanner can actually see them -- a dynamically-built class name like
// `bg-green-500/${n}` would be invisible to Tailwind's purge step and silently render
// unstyled. Hue stays constant (green-500/red-500); only opacity steps by magnitude,
// same shading idea as MonthlyPerformanceMatrix.tsx's own rgba-based heat map.
const POSITIVE_TIERS = ['bg-green-500/10', 'bg-green-500/20', 'bg-green-500/30', 'bg-green-500/45', 'bg-green-500/60']
const NEGATIVE_TIERS = ['bg-red-500/10', 'bg-red-500/20', 'bg-red-500/30', 'bg-red-500/45', 'bg-red-500/60']

function yearCellClass(value: number | null, maxAbs: number): string {
  if (value === null || value === 0) return ''
  const tiers = value > 0 ? POSITIVE_TIERS : NEGATIVE_TIERS
  const ratio = maxAbs > 0 ? Math.min(Math.abs(value) / maxAbs, 1) : 0
  const idx = Math.min(tiers.length - 1, Math.floor(ratio * tiers.length))
  return tiers[idx]!
}

const PAYOUT_RATIO_TOOLTIP = 'Average winning trade R divided by average losing trade R. A ratio above 1.0 means winners are larger than losers on average.'
const BREAK_EVEN_WIN_RATE_TOOLTIP = 'The minimum win rate needed to break even given the current payout ratio. Calculated as 1 ÷ (1 + Payout Ratio).'

const COMPARISON_HEADERS: { label: string; tooltip?: string }[] = [
  { label: 'Signal Type' },
  { label: 'Total Signals' },
  { label: 'Win Rate' },
  { label: 'Avg R' },
  { label: 'Total R' },
  { label: 'Max DD (R)' },
  { label: 'Payout Ratio', tooltip: PAYOUT_RATIO_TOOLTIP },
  { label: 'Break-Even WR', tooltip: BREAK_EVEN_WIN_RATE_TOOLTIP },
  { label: 'Since' },
]

function PeriodTable({ rows, firstColumnLabel }: {
  rows: { key: string; trades: number; winRate: number | null; avgR: number | null }[]
  firstColumnLabel: string
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {[firstColumnLabel, 'Trades', 'Win Rate', 'Avg R'].map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(row => (
            <tr key={row.key} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-2.5 font-medium whitespace-nowrap">{row.key}</td>
              <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.trades.toLocaleString()}</td>
              <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatPercent(row.winRate)}</td>
              <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${positivityClass(row.avgR)}`}>{formatR(row.avgR)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface Props {
  analysts: Analyst[]
}

export function CombinedSignalsTab({ analysts }: Props) {
  const [filters, setFilters] = useState<CombinedFilterState>(DEFAULT_COMBINED_FILTERS)
  const [moreOpen, setMoreOpen] = useState(false)

  const [rawAnalyst, setRawAnalyst] = useState<RawAnalystRow[]>([])
  const [rawPatterns, setRawPatterns] = useState<PatternTradePoint[]>([])
  const [rawAi, setRawAi] = useState<AiTradePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)

  const dateRange = useMemo(
    () => resolveDateRange(filters.datePreset, filters.customStart ?? undefined, filters.customEnd ?? undefined),
    [filters.datePreset, filters.customStart, filters.customEnd]
  )

  // No raw "/api/analytics/combined/raw" endpoint exists -- /api/analytics/combined only
  // returns pre-aggregated SignalTypeData, which can't be re-filtered client-side. Fetches
  // from the same three raw endpoints PatternsTab.tsx/AiSignalsTab.tsx and
  // AnalyticsPage.tsx already use, scoped server-side to the current date window via
  // ?from= (all three routes already support it) -- refetches whenever dateRange.start
  // changes, i.e. only when a filter actually moves the date window, not on every filter
  // change (asset class/market/direction/etc. stay client-side-only, same as before).
  // No ?to= is sent, so a CUSTOM range's end boundary is still enforced by the client-side
  // filter predicates below, which remain a safety net for that and for dateRange.start
  // itself (the server-side from= already guarantees every returned row satisfies it).
  // The three requests run in parallel (Promise.all) with per-source error isolation --
  // one source returning an error/unexpected shape degrades only that source's data to
  // [] rather than discarding all three, even ones that already succeeded.
  useEffect(() => {
    setLoading(true)
    setError(null)

    const failures: string[] = []

    async function fetchRows<T>(label: string, url: string, extract: (json: any) => T[] | null): Promise<T[]> {
      try {
        const res = await fetch(url)
        const json = await res.json()
        const rows = extract(json)
        if (rows === null) {
          console.error(`[combined] ${label} fetch returned an unexpected response:`, json)
          failures.push(label)
          return []
        }
        return rows
      } catch (err) {
        console.error(`[combined] ${label} fetch failed:`, err)
        failures.push(label)
        return []
      }
    }

    const from = dateRange.start

    Promise.all([
      fetchRows<RawAnalystRow>('Analyst', `/api/analytics/trades?from=${from}`, json => Array.isArray(json) ? json : null),
      fetchRows<PatternTradePoint>('Patterns', `/api/analytics/patterns?from=${from}`, json => (json && !('error' in json) && Array.isArray(json.trades)) ? json.trades : null),
      fetchRows<AiTradePoint>('AI Signals', `/api/analytics/ai-signals?from=${from}`, json => (json && !('error' in json) && Array.isArray(json.trades)) ? json.trades : null),
    ]).then(([analystRows, patternRows, aiRows]) => {
      setRawAnalyst(analystRows)
      setRawPatterns(patternRows)
      setRawAi(aiRows)
      if (failures.length > 0) {
        setError(`Failed to load: ${failures.join(', ')}. Showing data from the remaining source${failures.length < 3 ? 's' : ''} only.`)
      }
    }).finally(() => setLoading(false))
  }, [dateRange.start])

  // Filter option lists are derived from the full unfiltered fetch, not the
  // currently-filtered subset -- same reasoning as PatternsTab.tsx/AiSignalsTab.tsx:
  // keeps the option lists stable as other filters change instead of shrinking/growing
  // confusingly.
  const assetClassOptions = useMemo(() => {
    const classes = new Set<string>()
    for (const t of rawAnalyst) if (t.market?.asset_class) classes.add(t.market.asset_class)
    for (const t of rawPatterns) if (t.asset_class) classes.add(t.asset_class)
    for (const t of rawAi) if (t.asset_class) classes.add(t.asset_class)
    return [...classes].sort().map(c => ({ value: c, label: c }))
  }, [rawAnalyst, rawPatterns, rawAi])

  // Market options are symbols, not market_ids -- pattern_trades/ai_trades carry no
  // market_id at all (only actual_trades does, via the market join), so filters.marketIds
  // holds symbols uniformly across all three types here, same as PatternsTab.tsx/
  // AiSignalsTab.tsx. Narrowed by selected asset classes.
  const marketOptions = useMemo(() => {
    const bySymbol = new Map<string, string>()
    for (const t of rawAnalyst) if (t.market?.symbol && !bySymbol.has(t.market.symbol)) bySymbol.set(t.market.symbol, t.market.asset_class ?? '')
    for (const t of rawPatterns) if (t.symbol && !bySymbol.has(t.symbol)) bySymbol.set(t.symbol, t.asset_class ?? '')
    for (const t of rawAi) if (t.symbol && !bySymbol.has(t.symbol)) bySymbol.set(t.symbol, t.asset_class ?? '')
    const symbols = filters.assetClasses.length === 0
      ? [...bySymbol.keys()]
      : [...bySymbol.entries()].filter(([, ac]) => filters.assetClasses.includes(ac)).map(([sym]) => sym)
    return symbols.sort().map(sym => ({ value: sym, label: sym }))
  }, [rawAnalyst, rawPatterns, rawAi, filters.assetClasses])

  // Labelled via the `analysts` prop (threaded through from AnalyticsPage.tsx, which
  // already has the full list from its own server parent) -- falls back to the raw
  // analyst_id for any id present in the trade data but missing from that list, same
  // defensive convention as AnalyticsPage.tsx's own analystNameById lookups. Analyst-only:
  // patterns/ai have no analyst_id concept.
  const analystOptions = useMemo(() => {
    const nameById = new Map(analysts.map(a => [a.analyst_id, a.display_name]))
    const ids = [...new Set(rawAnalyst.map(t => t.analyst_id))].sort()
    return ids.map(id => ({ value: id, label: nameById.get(id) ?? id }))
  }, [rawAnalyst, analysts])

  const analystOn = filters.signalTypes.length === 0 || filters.signalTypes.includes('analyst')
  const patternsOn = filters.signalTypes.length === 0 || filters.signalTypes.includes('patterns')
  const aiOn = filters.signalTypes.length === 0 || filters.signalTypes.includes('ai')

  // Analyst/Trigger Status only apply to the Analyst subset (patterns/ai have no
  // analyst_id, and their own `triggered`-equivalent concepts are out of scope here per
  // the task). Session only has real effect on Analyst rows too -- actual_trades has a
  // genuine `session` column, but pattern_trades/ai_trades don't (see the Pattern/AI tabs'
  // own identical notes), so filters.sessions is applied here and nowhere else below.
  const filteredAnalystRows = useMemo(() => rawAnalyst.filter(t => {
    const d = t.published_at.slice(0, 10)
    if (d < dateRange.start || d > dateRange.end) return false
    if (filters.analystIds.length > 0 && !filters.analystIds.includes(t.analyst_id)) return false
    if (filters.assetClasses.length > 0 && (!t.market?.asset_class || !filters.assetClasses.includes(t.market.asset_class))) return false
    if (filters.marketIds.length > 0 && (!t.market?.symbol || !filters.marketIds.includes(t.market.symbol))) return false
    if (filters.directions.length > 0 && (!t.direction || !filters.directions.includes(t.direction))) return false
    if (filters.sessions.length > 0 && !filters.sessions.includes(t.session ?? '')) return false
    if (filters.triggerStatus === 'TRIGGERED' && !t.triggered) return false
    if (filters.triggerStatus === 'NOT_TRIGGERED' && t.triggered) return false
    return true
  }), [rawAnalyst, filters, dateRange])

  const filteredPatternRows = useMemo(() => rawPatterns.filter(t => {
    const d = t.published_at.slice(0, 10)
    if (d < dateRange.start || d > dateRange.end) return false
    if (filters.assetClasses.length > 0 && (!t.asset_class || !filters.assetClasses.includes(t.asset_class))) return false
    if (filters.marketIds.length > 0 && (!t.symbol || !filters.marketIds.includes(t.symbol))) return false
    if (filters.directions.length > 0 && (!t.direction || !filters.directions.includes(t.direction))) return false
    return true
  }), [rawPatterns, filters, dateRange])

  const filteredAiRows = useMemo(() => rawAi.filter(t => {
    const d = t.published_at.slice(0, 10)
    if (d < dateRange.start || d > dateRange.end) return false
    if (filters.assetClasses.length > 0 && (!t.asset_class || !filters.assetClasses.includes(t.asset_class))) return false
    if (filters.marketIds.length > 0 && (!t.symbol || !filters.marketIds.includes(t.symbol))) return false
    if (filters.directions.length > 0 && (!t.direction || !filters.directions.includes(t.direction))) return false
    return true
  }), [rawAi, filters, dateRange])

  const aiDeduped = useMemo(() => filteredAiRows.filter(t => !t.is_reiteration), [filteredAiRows])
  const aiReiterations = filteredAiRows.length - aiDeduped.length

  // Deselecting a signal type (the toggle buttons below) zeroes its EnrichedSignal array
  // entirely -- that one change then naturally propagates everywhere a type's signals
  // feed into: the Signal Output strip, the Performance Comparison row (also explicitly
  // hidden below), the equity curve (mergeCumulativeSeries never gets a point for that
  // type, so its line simply doesn't appear), and every pooled breakdown (By Asset
  // Class/Day/Month/Year/Top Markets/Key Callouts) -- "narrow all three signal types
  // simultaneously" from the task's own framing, not just the two sections it names by
  // example.
  const analystSignals: EnrichedSignal[] = useMemo(() => !analystOn ? [] : filteredAnalystRows.map(t => ({
    date: t.published_at.slice(0, 10), rr: t.result_r ?? null,
    assetClass: t.market?.asset_class ?? null, symbol: t.market?.symbol ?? null,
  })), [filteredAnalystRows, analystOn])

  const patternSignals: EnrichedSignal[] = useMemo(() => !patternsOn ? [] : filteredPatternRows.map(t => ({
    date: t.published_at.slice(0, 10),
    rr: t.status !== null && PATTERN_OUTCOME_STATUSES.has(t.status) && t.rr !== null ? t.rr : null,
    assetClass: t.asset_class ?? null, symbol: t.symbol ?? null,
  })), [filteredPatternRows, patternsOn])

  const aiSignals: EnrichedSignal[] = useMemo(() => !aiOn ? [] : aiDeduped.map(t => ({
    date: t.published_at.slice(0, 10),
    rr: t.status !== null && AI_OUTCOME_STATUSES.has(t.status) && t.rr !== null ? t.rr : null,
    assetClass: t.asset_class ?? null, symbol: t.symbol ?? null,
  })), [aiDeduped, aiOn])

  const analystData = useMemo(
    () => buildSignalTypeData(analystSignals, analystOn ? filteredAnalystRows.length : 0),
    [analystSignals, filteredAnalystRows, analystOn]
  )
  const patternsData = useMemo(
    () => buildSignalTypeData(patternSignals, patternsOn ? filteredPatternRows.length : 0),
    [patternSignals, filteredPatternRows, patternsOn]
  )
  const aiData = useMemo(
    () => buildSignalTypeData(aiSignals, aiOn ? filteredAiRows.length : 0),
    [aiSignals, filteredAiRows, aiOn]
  )

  const cumulativeR = useMemo(
    () => mergeCumulativeSeries(analystData.cumulativeR, patternsData.cumulativeR, aiData.cumulativeR),
    [analystData, patternsData, aiData]
  )
  const normalisedCumulative = useMemo(() => mergeCumulativeSeries(
    toIndexedCumulative(analystData.cumulativeR), toIndexedCumulative(patternsData.cumulativeR), toIndexedCumulative(aiData.cumulativeR),
  ), [analystData, patternsData, aiData])

  const byAssetClass = useMemo(
    () => buildAssetClassBreakdown(analystSignals, patternSignals, aiSignals),
    [analystSignals, patternSignals, aiSignals]
  )
  const byDayOfWeek = useMemo(
    () => buildDayOfWeekBreakdown(analystSignals, patternSignals, aiSignals),
    [analystSignals, patternSignals, aiSignals]
  )
  const byMonth = useMemo(
    () => buildMonthBreakdown(analystSignals, patternSignals, aiSignals),
    [analystSignals, patternSignals, aiSignals]
  )
  const byYear = useMemo(
    () => buildYearGrid(analystSignals, patternSignals, aiSignals),
    [analystSignals, patternSignals, aiSignals]
  )
  const topMarkets = useMemo(
    () => buildTopMarkets(analystSignals, patternSignals, aiSignals, 20),
    [analystSignals, patternSignals, aiSignals]
  )

  const typeData: Record<SignalTypeKey, SignalTypeData> = useMemo(
    () => ({ analyst: analystData, patterns: patternsData, ai: aiData }),
    [analystData, patternsData, aiData]
  )

  // Pooled payout ratio/break-even win rate across whichever signal types are currently
  // selected -- totalPublished is irrelevant here (only summary.payoutRatio/
  // breakEvenWinRate are read), so 0 is passed rather than recomputing a real figure.
  const combinedSummary = useMemo(
    () => buildSignalTypeData([...analystSignals, ...patternSignals, ...aiSignals], 0).summary,
    [analystSignals, patternSignals, aiSignals]
  )

  // Only rows for selected signal types render (empty filters.signalTypes = all three) --
  // the task's own explicit requirement for this table.
  const visibleTypes = useMemo(
    () => TYPE_ORDER.filter(key => filters.signalTypes.length === 0 || filters.signalTypes.includes(key)),
    [filters.signalTypes]
  )

  const callouts = useMemo(() => buildKeyCallouts(typeData), [typeData])

  // Computed live from each type's own firstSignalDate rather than hardcoded -- the
  // task's own example wording ("Analyst Signals: Jan 2017, ...") happens to match
  // today's real data, but asserting fixed dates here would silently go stale (or wrong)
  // the moment the underlying history changes.
  const indexCaption = useMemo(() => {
    const parts = TYPE_ORDER.map(key => {
      const first = typeData[key].summary.firstSignalDate
      return `${TYPE_LABELS[key]}: ${first ? monthYear(first) : 'no data yet'}`
    })
    return `All series rebased to 100 at start. A value of 150 = +50% relative growth from inception. ${parts.join(', ')}.`
  }, [typeData])

  const maxAbsYearR = useMemo(() => {
    const values = byYear.flatMap(row => [row.analyst, row.pattern, row.ai]).filter((v): v is number => v !== null).map(Math.abs)
    return values.length > 0 ? Math.max(...values) : 0
  }, [byYear])

  // Toggle one signal type on/off. filters.signalTypes: [] means "all three" -- there's
  // no separate representation for "zero selected", so a selection collapses back to []
  // once all three end up on, and the last remaining active type can't be turned off
  // (there would be nothing left to mean).
  function toggleSignalType(key: SignalTypeKey) {
    setFilters(f => {
      const current = f.signalTypes.length === 0 ? [...TYPE_ORDER] : f.signalTypes
      if (current.length === 1 && current.includes(key)) return f
      const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key]
      return { ...f, signalTypes: next.length === TYPE_ORDER.length ? [] : next }
    })
  }

  return (
    <>
    {/* print:hidden is scoped to the dashboard chrome only, matching PatternsTab.tsx/
        AiSignalsTab.tsx's own root return -- CombinedSignalsReportBuilder (and the print
        layout it mounts) renders as a sibling below, outside this div. */}
    <div className="space-y-6 print:hidden">
      {/* Filter bar -- styled to match AnalyticsFilters.tsx (the Analyst Signals tab's
          own filter card) for visual consistency across tabs. Signal Type is this tab's
          own addition (no equivalent on the single-type tabs): toggle buttons, not a
          MultiSelect, since there are only three fixed options and "which signal types
          contribute" is this tab's headline control. */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">Filters</p>
          {hasActiveCombinedFilters(filters) && (
            <button onClick={() => setFilters(DEFAULT_COMBINED_FILTERS)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Clear all
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Date</p>
          <div className="flex flex-wrap gap-1.5">
            {DATE_PRESET_OPTIONS.map(opt => (
              <button key={opt.key} onClick={() => setFilters(f => ({ ...f, datePreset: opt.key }))}
                className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                  filters.datePreset === opt.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/50'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
          {filters.datePreset === 'CUSTOM' && (
            <div className="flex items-center gap-2 pt-1">
              <input type="date" value={filters.customStart ?? ''} onChange={e => setFilters(f => ({ ...f, customStart: e.target.value || null }))}
                className="text-xs px-2 py-1.5 rounded-md border border-border bg-background" />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="date" value={filters.customEnd ?? ''} onChange={e => setFilters(f => ({ ...f, customEnd: e.target.value || null }))}
                className="text-xs px-2 py-1.5 rounded-md border border-border bg-background" />
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Signal Type</p>
          <div className="flex flex-wrap gap-1.5">
            {TYPE_ORDER.map(key => {
              const active = filters.signalTypes.length === 0 || filters.signalTypes.includes(key)
              return (
                <button key={key} onClick={() => toggleSignalType(key)}
                  className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/50'
                  }`}>
                  {TYPE_LABELS[key]}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <MultiSelect label="Asset Class" options={assetClassOptions} selected={filters.assetClasses}
            onChange={v => setFilters(f => ({ ...f, assetClasses: v, marketIds: [] }))} placeholder="All classes" />
          <MultiSelect label="Market" options={marketOptions} selected={filters.marketIds}
            onChange={v => setFilters(f => ({ ...f, marketIds: v }))} placeholder="All markets" />
        </div>

        <div className="border-t border-border pt-3">
          <button onClick={() => setMoreOpen(!moreOpen)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {moreOpen ? '▲ Fewer filters' : '▼ More filters'}
          </button>
          {moreOpen && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mt-3">
              <MultiSelect label="Direction" options={DIRECTION_OPTIONS} selected={filters.directions}
                onChange={v => setFilters(f => ({ ...f, directions: v }))} placeholder="Both" />
              <MultiSelect label="Session" options={SESSION_OPTIONS} selected={filters.sessions}
                onChange={v => setFilters(f => ({ ...f, sessions: v }))} placeholder="All sessions" />
              <MultiSelect label="Analyst (internal only)" options={analystOptions} selected={filters.analystIds}
                onChange={v => setFilters(f => ({ ...f, analystIds: v }))} placeholder="All analysts" />
              <div>
                <p className="text-xs text-muted-foreground mb-1">Trigger Status (Analyst only)</p>
                <select value={filters.triggerStatus} onChange={e => setFilters(f => ({ ...f, triggerStatus: e.target.value as CombinedFilterState['triggerStatus'] }))}
                  className="w-full text-xs px-2 py-2 rounded-md border border-border bg-background">
                  <option value="ALL">All</option>
                  <option value="TRIGGERED">Triggered</option>
                  <option value="NOT_TRIGGERED">Not Triggered / Expired</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-border p-12 text-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Signal output strip */}
          <div className="flex items-start justify-between gap-4">
            <div className="grid grow grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <SummaryTile label="Analyst Signals" data={analystData} />
              <SummaryTile label="Pattern Signals" data={patternsData} />
              <SummaryTile label="AI Signals" data={aiData} />
              <div className="rounded-lg border border-border bg-card p-4 space-y-1">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payout Ratio</p>
                  <Tooltip content={PAYOUT_RATIO_TOOLTIP}>
                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground/60 text-[9px] cursor-default select-none leading-none">i</span>
                  </Tooltip>
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {combinedSummary.payoutRatio != null ? combinedSummary.payoutRatio.toFixed(2) : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4 space-y-1">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">BE Win Rate</p>
                  <Tooltip content={BREAK_EVEN_WIN_RATE_TOOLTIP}>
                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground/60 text-[9px] cursor-default select-none leading-none">i</span>
                  </Tooltip>
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {combinedSummary.breakEvenWinRate != null ? formatPercent(combinedSummary.breakEvenWinRate) : '—'}
                </p>
              </div>
            </div>
            <button onClick={() => setReportOpen(true)}
              className="shrink-0 text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              Generate Report
            </button>
          </div>

          {/* Performance comparison table. Total Signals here is totalPublished (so the
              three rows are comparable signal-output figures) -- Win Rate/Avg R/Total R/
              Max DD still reflect each type's own canonical performance population
              (deduplicated for AI), so the AI row's own "Total Signals" number won't
              match the sample size behind its other columns. That's the deliberate
              tradeoff: a comparable headline count across rows, at the cost of one row's
              internal consistency. Only rows for the selected Signal Types render. */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Performance Comparison</p>
            <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {COMPARISON_HEADERS.map(h => (
                      <th key={h.label} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                        {h.tooltip ? (
                          <div className="flex items-center gap-1">
                            <span>{h.label}</span>
                            <Tooltip content={h.tooltip}>
                              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground/60 text-[9px] cursor-default select-none leading-none">i</span>
                            </Tooltip>
                          </div>
                        ) : h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleTypes.map(key => {
                    const d = typeData[key]
                    return (
                      <tr key={key} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap">{TYPE_LABELS[key]}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">
                          {d.summary.totalPublished.toLocaleString()}
                          {key === 'ai' && aiReiterations > 0 && (
                            <span className="text-[11px] text-muted-foreground/70"> (of which {aiReiterations.toLocaleString()} reiterations)</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatPercent(d.summary.winRate)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{formatR(d.summary.avgR)}</td>
                        <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${positivityClass(d.summary.totalR)}`}>{formatR(d.summary.totalR)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-red-700 whitespace-nowrap">{formatR(d.summary.maxDrawdownR)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">
                          {d.summary.payoutRatio != null ? d.summary.payoutRatio.toFixed(2) : '—'}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">
                          {d.summary.breakEvenWinRate != null ? `${(d.summary.breakEvenWinRate * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{d.summary.firstSignalDate ? formatDate(d.summary.firstSignalDate) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Normalised equity curves -- replaces the old raw-R 3-line chart */}
          <CombinedCumulativeChart data={normalisedCumulative} caption={indexCaption} />

          {/* By Asset Class */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">By Asset Class</p>
            <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {['Asset Class', 'Analyst R', 'Pattern R', 'AI R', 'Combined Total R', 'Combined Win Rate'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {byAssetClass.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">No data.</td></tr>
                  ) : byAssetClass.map(row => (
                    <tr key={row.assetClass} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap">{row.assetClass}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{formatR(row.analystR)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{formatR(row.patternR)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{formatR(row.aiR)}</td>
                      <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${positivityClass(row.combinedTotalR)}`}>{formatR(row.combinedTotalR)}</td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatPercent(row.combinedWinRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* By Day of Week */}
          <div className="space-y-2">
            <SignalsByPeriodChart
              title="Average R by Day of Week — all signal types combined"
              data={byDayOfWeek.map(r => ({ key: r.day, avgR: r.avgR }))}
            />
            <PeriodTable firstColumnLabel="Day" rows={byDayOfWeek.map(r => ({ key: r.day, trades: r.trades, winRate: r.winRate, avgR: r.avgR }))} />
          </div>

          {/* By Month of Year */}
          <div className="space-y-2">
            <SignalsByPeriodChart
              title="Average R by Month of Year — all signal types combined"
              data={byMonth.map(r => ({ key: r.month, avgR: r.avgR }))}
            />
            <PeriodTable firstColumnLabel="Month" rows={byMonth.map(r => ({ key: r.month, trades: r.trades, winRate: r.winRate, avgR: r.avgR }))} />
          </div>

          {/* Year-by-year heat map -- plain Tailwind-shaded table, no charting library */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Year-by-Year Total R</p>
            <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {['Year', 'Analyst', 'Pattern', 'AI', 'Combined'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {byYear.map(row => {
                    const combinedValues = [row.analyst, row.pattern, row.ai].filter((v): v is number => v !== null)
                    const combinedTotal = combinedValues.length > 0 ? round2(combinedValues.reduce((a, b) => a + b, 0)) : null
                    return (
                      <tr key={row.year}>
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap">{row.year === CURRENT_YEAR ? `${row.year} YTD` : row.year}</td>
                        {([['analyst', row.analyst], ['pattern', row.pattern], ['ai', row.ai]] as const).map(([col, value]) => (
                          <td key={col} className={`px-4 py-2.5 tabular-nums whitespace-nowrap ${yearCellClass(value, maxAbsYearR)} ${value === null ? 'text-muted-foreground' : positivityClass(value)}`}>
                            {value === null ? '—' : formatR(value)}
                          </td>
                        ))}
                        <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${combinedTotal === null ? 'text-muted-foreground' : positivityClass(combinedTotal)}`}>
                          {combinedTotal !== null ? formatR(combinedTotal) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top 20 markets combined */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground print:uppercase print:tracking-wide">Top 20 Markets Combined</p>
            <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {['Symbol', 'Analyst R', 'Pattern R', 'AI R', 'Combined R', 'Win Rate', 'Trades'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {topMarkets.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-muted-foreground">No data.</td></tr>
                  ) : topMarkets.map(row => (
                    <tr key={row.symbol} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap">{row.symbol}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.analystR !== null ? formatR(row.analystR) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.patternR !== null ? formatR(row.patternR) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.aiR !== null ? formatR(row.aiR) : '—'}</td>
                      <td className={`px-4 py-2.5 tabular-nums font-medium whitespace-nowrap ${positivityClass(row.combinedTotalR)}`}>{formatR(row.combinedTotalR)}</td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatPercent(row.combinedWinRate)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{row.trades.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

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

    {reportOpen && (
      <CombinedSignalsReportBuilder
        analyst={analystData} patterns={patternsData} ai={aiData}
        normalisedCumulative={normalisedCumulative}
        cumulativeR={cumulativeR}
        byAssetClass={byAssetClass}
        byDayOfWeek={byDayOfWeek}
        byMonth={byMonth}
        byYear={byYear}
        topMarkets={topMarkets}
        filters={filters}
        onClose={() => setReportOpen(false)}
      />
    )}
    </>
  )
}
