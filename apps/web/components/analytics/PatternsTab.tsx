'use client'
import { useEffect, useMemo, useState } from 'react'
import type { PatternSummary, PatternBreakdownRow } from '@/lib/patternAnalytics'

type DateRangeKey = '30D' | '90D' | '12M' | 'ALL'
const DATE_RANGES: { key: DateRangeKey; label: string; days: number | null }[] = [
  { key: '30D', label: 'Last 30 days', days: 30 },
  { key: '90D', label: 'Last 90 days', days: 90 },
  { key: '12M', label: 'Last 12 months', days: 365 },
  { key: 'ALL', label: 'All time', days: null },
]

const GRANULARITY_OPTIONS = ['ALL', '1h', '4h', '1d']
const DIRECTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'BUY', label: 'Buy' },
  { value: 'SELL', label: 'Sell' },
]
const ASSET_CLASS_OPTIONS = ['ALL', 'FX', 'Equity', 'Commodity', 'Crypto', 'Index']

function fmtPct(v: number | null): string {
  return v !== null ? `${Math.round(v * 100)}%` : '—'
}
function fmtR(v: number | null): string {
  if (v === null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}R`
}

function BreakdownTable({ title, firstColumnLabel, rows, showFullName }: {
  title: string
  firstColumnLabel: string
  rows: PatternBreakdownRow[]
  showFullName?: boolean
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-muted/40">
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 py-2 text-xs font-medium text-muted-foreground">{firstColumnLabel}</th>
              {showFullName && <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Full Name</th>}
              <th className="px-4 py-2 text-xs font-medium text-muted-foreground text-right">Count</th>
              <th className="px-4 py-2 text-xs font-medium text-muted-foreground text-right">Trigger %</th>
              <th className="px-4 py-2 text-xs font-medium text-muted-foreground text-right">Win %</th>
              <th className="px-4 py-2 text-xs font-medium text-muted-foreground text-right">Avg R</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={showFullName ? 6 : 5} className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No patterns for this filter.
                </td>
              </tr>
            ) : rows.map(row => (
              <tr key={row.key} className="border-b border-border/50">
                <td className="px-4 py-2 font-medium">{showFullName ? row.key : row.label}</td>
                {showFullName && <td className="px-4 py-2 text-muted-foreground">{row.label}</td>}
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{row.count}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtPct(row.triggerPct)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtPct(row.winPct)}</td>
                <td className={`px-4 py-2 text-right tabular-nums font-medium ${
                  row.avgR !== null ? (row.avgR >= 0 ? 'text-green-700' : 'text-red-700') : ''
                }`}>{fmtR(row.avgR)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function PatternsTab() {
  const [dateRange, setDateRange] = useState<DateRangeKey>('ALL')
  const [granularity, setGranularity] = useState('ALL')
  const [direction, setDirection] = useState('ALL')
  const [assetClass, setAssetClass] = useState('ALL')

  const [summary, setSummary] = useState<PatternSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  useEffect(() => {
    const params = new URLSearchParams()
    const preset = DATE_RANGES.find(r => r.key === dateRange)!
    if (preset.days !== null) {
      const from = new Date(Date.now() - preset.days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      params.set('from', from)
      params.set('to', today)
    }
    if (granularity !== 'ALL') params.set('granularity', granularity)
    if (direction !== 'ALL') params.set('direction', direction)
    if (assetClass !== 'ALL') params.set('assetClass', assetClass)

    setLoading(true)
    setError(null)
    fetch(`/api/analytics/patterns?${params.toString()}`)
      .then(r => r.json())
      .then((data: PatternSummary | { error: string }) => {
        if ('error' in data) { setError(data.error); return }
        setSummary(data)
      })
      .catch(() => setError('Failed to load pattern trade data.'))
      .finally(() => setLoading(false))
  }, [dateRange, granularity, direction, assetClass, today])

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Patterns</p>
          <p className="text-2xl font-semibold tabular-nums">{summary ? summary.totalPatterns : '—'}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Trigger Rate</p>
          <p className="text-2xl font-semibold tabular-nums">{summary ? fmtPct(summary.triggerRate) : '—'}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Win Rate</p>
          <p className="text-2xl font-semibold tabular-nums">{summary ? fmtPct(summary.winRate) : '—'}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avg R</p>
          <p className={`text-2xl font-semibold tabular-nums ${
            summary?.avgR != null ? (summary.avgR >= 0 ? 'text-green-700' : 'text-red-700') : ''
          }`}>{summary ? fmtR(summary.avgR) : '—'}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {DATE_RANGES.map(r => (
            <button key={r.key}
              onClick={() => setDateRange(r.key)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                dateRange === r.key
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}>
              {r.label}
            </button>
          ))}
        </div>
        <select value={granularity} onChange={e => setGranularity(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
          {GRANULARITY_OPTIONS.map(g => (
            <option key={g} value={g}>{g === 'ALL' ? 'All granularities' : g}</option>
          ))}
        </select>
        <select value={direction} onChange={e => setDirection(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
          {DIRECTION_OPTIONS.map(d => (
            <option key={d.value} value={d.value}>{d.value === 'ALL' ? 'All directions' : d.label}</option>
          ))}
        </select>
        <select value={assetClass} onChange={e => setAssetClass(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
          {ASSET_CLASS_OPTIONS.map(a => (
            <option key={a} value={a}>{a === 'ALL' ? 'All asset classes' : a}</option>
          ))}
        </select>
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
      ) : summary && (
        <div className="space-y-4">
          <BreakdownTable title="By Pattern Family" firstColumnLabel="Family" rows={summary.byFamily} showFullName />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BreakdownTable title="By Granularity" firstColumnLabel="Granularity" rows={summary.byGranularity} />
            <BreakdownTable title="By Asset Class" firstColumnLabel="Asset Class" rows={summary.byAssetClass} />
          </div>
        </div>
      )}
    </div>
  )
}
