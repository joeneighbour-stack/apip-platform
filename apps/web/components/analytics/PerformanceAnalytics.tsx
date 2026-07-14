'use client'

import { useState, useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, Legend
} from 'recharts'

interface Analyst { analyst_id: string; display_name: string }
interface Market { market_id: string; symbol: string; asset_class: string }
interface Trade {
  trade_id: string
  analyst_id: string
  direction: string
  result_r: number | null
  triggered: boolean
  published_at: string
  historical_backfill: boolean
  market: { market_id: string; symbol: string; asset_class: string } | null
}

interface Props {
  analysts: Analyst[]
  markets: Market[]
  trades: Trade[]
}

function deriveSession(publishedAt: string): 'EUROPEAN' | 'US' | 'APAC' | 'OTHER' {
  const date = new Date(publishedAt)
  const ukHour = (date.getUTCHours() + 1) % 24
  const ukMin = date.getUTCMinutes()
  const ukTime = ukHour * 60 + ukMin
  if (ukTime >= 6 * 60 && ukTime <= 7 * 60 + 20) return 'EUROPEAN'
  if (ukTime >= 12 * 60 && ukTime <= 13 * 60 + 20) return 'US'
  if (ukTime >= 15 * 60 && ukTime <= 16 * 60 + 30) return 'APAC'
  return 'OTHER'
}

function monthKey(dateStr: string) { return dateStr.slice(0, 7) }
function monthLabel(key: string) {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

function generateMonthOptions(trades: Trade[]) {
  if (trades.length === 0) return []
  const keys = new Set(trades.map(t => monthKey(t.published_at)))
  return [...keys].sort()
}

function computeStats(trades: Trade[]) {
  const totalR = trades.reduce((s, t) => s + (t.result_r ?? 0), 0)
  const count = trades.length
  const withResult = trades.filter(t => t.result_r !== null)
  const wins = withResult.filter(t => (t.result_r ?? 0) > 0).length
  const winRate = withResult.length > 0 ? wins / withResult.length : null
  const avgR = count > 0 ? totalR / count : 0
  const apiTrades = trades.filter(t => !t.historical_backfill)
  const triggeredCount = apiTrades.filter(t => t.triggered).length
  const triggerRate = apiTrades.length > 0 ? triggeredCount / apiTrades.length : null
  return { totalR, count, winRate, avgR, triggerRate }
}

const ANALYST_COLOURS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444',
  '#06b6d4', '#f97316', '#ec4899', '#84cc16', '#14b8a6'
]

function MultiSelect({
  label, options, selected, onChange, placeholder
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (vals: string[]) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const allSelected = selected.length === 0
  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  return (
    <div className="relative">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <button
        onClick={() => { setOpen(!open); setSearch('') }}
        className="w-full text-left text-xs px-2.5 py-2 rounded-md border border-border bg-background flex items-center justify-between gap-2"
      >
        <span className="truncate">{allSelected ? placeholder : `${selected.length} selected`}</span>
        <span className="text-muted-foreground shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-full bg-card border border-border rounded-md shadow-lg z-50 flex flex-col max-h-56">
          {options.length > 6 && (
            <div className="p-2 border-b border-border shrink-0">
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search..." onClick={e => e.stopPropagation()} autoFocus
                className="w-full text-xs px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30" />
            </div>
          )}
          <div className="overflow-y-auto">
            <button className="w-full text-left text-xs px-3 py-2 hover:bg-muted transition-colors font-medium"
              onClick={() => { onChange([]); setOpen(false); setSearch('') }}>
              {allSelected ? '✓ ' : '  '}All
            </button>
            {filtered.map(opt => (
              <button key={opt.value} className="w-full text-left text-xs px-3 py-2 hover:bg-muted transition-colors"
                onClick={() => {
                  const next = selected.includes(opt.value)
                    ? selected.filter(v => v !== opt.value)
                    : [...selected, opt.value]
                  onChange(next)
                }}>
                {selected.includes(opt.value) ? '✓ ' : '  '}{opt.label}
              </button>
            ))}
            {filtered.length === 0 && <p className="text-xs text-muted-foreground px-3 py-2">No matches</p>}
          </div>
        </div>
      )}
    </div>
  )
}

export function PerformanceAnalytics({ analysts, markets, trades }: Props) {
  const monthOptions = useMemo(() => generateMonthOptions(trades), [trades])
  const earliestMonth = monthOptions[0] ?? ''
  const latestMonth = monthOptions[monthOptions.length - 1] ?? ''

  const [selectedAnalysts, setSelectedAnalysts] = useState<string[]>([])
  const [selectedAssetClasses, setSelectedAssetClasses] = useState<string[]>([])
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([])
  const [selectedDirections, setSelectedDirections] = useState<string[]>([])
  const [selectedSessions, setSelectedSessions] = useState<string[]>([])
  const [fromMonth, setFromMonth] = useState(earliestMonth)
  const [toMonth, setToMonth] = useState(latestMonth)
  const [showAllMonths, setShowAllMonths] = useState(false)
  const [activeOnly, setActiveOnly] = useState(true)

  const assetClasses = useMemo(() =>
    [...new Set(markets.map(m => m.asset_class))].sort(), [markets])

  const filteredMarkets = useMemo(() =>
    selectedAssetClasses.length === 0
      ? markets
      : markets.filter(m => selectedAssetClasses.includes(m.asset_class)),
    [markets, selectedAssetClasses])

  const filtered = useMemo(() => {
    return trades.filter(t => {
      const key = monthKey(t.published_at)
      if (key < fromMonth || key > toMonth) return false
      if (selectedAnalysts.length > 0 && !selectedAnalysts.includes(t.analyst_id)) return false
      if (selectedAssetClasses.length > 0 && !selectedAssetClasses.includes(t.market?.asset_class ?? '')) return false
      if (selectedMarkets.length > 0 && !selectedMarkets.includes(t.market?.market_id ?? '')) return false
      if (selectedDirections.length > 0 && !selectedDirections.includes(t.direction)) return false
      if (selectedSessions.length > 0 && !selectedSessions.includes(deriveSession(t.published_at))) return false
      return true
    })
  }, [trades, fromMonth, toMonth, selectedAnalysts, selectedAssetClasses, selectedMarkets, selectedDirections, selectedSessions])

  const stats = useMemo(() => computeStats(filtered), [filtered])

  const monthlyBreakdown = useMemo(() => {
    const byMonth = new Map<string, Trade[]>()
    for (const t of filtered) {
      const key = monthKey(t.published_at)
      if (!byMonth.has(key)) byMonth.set(key, [])
      byMonth.get(key)!.push(t)
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, ts]) => {
        const s = computeStats(ts)
        return { key, label: monthLabel(key), ...s }
      })
  }, [filtered])

  const analystBreakdown = useMemo(() => {
    const byAnalyst = new Map<string, Trade[]>()
    for (const t of filtered) {
      if (!byAnalyst.has(t.analyst_id)) byAnalyst.set(t.analyst_id, [])
      byAnalyst.get(t.analyst_id)!.push(t)
    }
    return [...byAnalyst.entries()].map(([id, ts]) => {
      const analyst = analysts.find(a => a.analyst_id === id)
      return { id, name: analyst?.display_name ?? 'Unknown', ...computeStats(ts) }
    }).sort((a, b) => b.totalR - a.totalR)
  }, [filtered, analysts])

  const analystMonthlyData = useMemo(() => {
    if (selectedAnalysts.length <= 1) return []
    const allMonths = [...new Set(filtered.map(t => monthKey(t.published_at)))].sort()
    return allMonths.map(key => {
      const row: Record<string, any> = { label: monthLabel(key) }
      for (const id of selectedAnalysts) {
        const analyst = analysts.find(a => a.analyst_id === id)
        const name = analyst?.display_name.split(' ')[0] ?? id.slice(0, 6)
        const ts = filtered.filter(t => t.analyst_id === id && monthKey(t.published_at) === key)
        row[name] = ts.reduce((s, t) => s + (t.result_r ?? 0), 0)
      }
      return row
    })
  }, [filtered, selectedAnalysts, analysts])

  const hasFilters = selectedAnalysts.length > 0 || selectedAssetClasses.length > 0 ||
    selectedMarkets.length > 0 || selectedDirections.length > 0 || selectedSessions.length > 0

  function clearFilters() {
    setSelectedAnalysts([])
    setSelectedAssetClasses([])
    setSelectedMarkets([])
    setSelectedDirections([])
    setSelectedSessions([])
    setFromMonth(earliestMonth)
    setToMonth(latestMonth)
  }

  return (
    <div className="space-y-6">

      {/* Filter panel */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">Filters</p>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Clear all
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <div>
            <p className="text-xs text-muted-foreground mb-1">From month</p>
            <select value={fromMonth} onChange={e => setFromMonth(e.target.value)}
              className="w-full text-xs px-2 py-2 rounded-md border border-border bg-background">
              {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">To month</p>
            <select value={toMonth} onChange={e => setToMonth(e.target.value)}
              className="w-full text-xs px-2 py-2 rounded-md border border-border bg-background">
              {monthOptions.filter(m => m >= fromMonth).map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
          <MultiSelect label="Analysts"
            options={(activeOnly ? analysts.filter((a: any) => a.active !== false) : analysts).map(a => ({ value: a.analyst_id, label: a.display_name }))}
            selected={selectedAnalysts} onChange={setSelectedAnalysts} placeholder="All analysts" />
          <MultiSelect label="Asset class"
            options={assetClasses.map(c => ({ value: c, label: c }))}
            selected={selectedAssetClasses}
            onChange={vals => { setSelectedAssetClasses(vals); setSelectedMarkets([]) }}
            placeholder="All classes" />
          <MultiSelect label="Markets"
            options={filteredMarkets.map(m => ({ value: m.market_id, label: m.symbol }))}
            selected={selectedMarkets} onChange={setSelectedMarkets} placeholder="All markets" />
          <MultiSelect label="Direction"
            options={[{ value: 'BUY', label: 'BUY' }, { value: 'SELL', label: 'SELL' }]}
            selected={selectedDirections} onChange={setSelectedDirections} placeholder="Both" />
          <MultiSelect label="Session"
            options={[
              { value: 'EUROPEAN', label: 'European' },
              { value: 'US', label: 'US' },
              { value: 'APAC', label: 'APAC' },
              { value: 'OTHER', label: 'Other' },
            ]}
            selected={selectedSessions} onChange={setSelectedSessions} placeholder="All sessions" />
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={activeOnly} onChange={e => { setActiveOnly(e.target.checked); setSelectedAnalysts([]) }}
              className="rounded" />
            Active analysts only
          </label>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Return</p>
          <p className={`text-2xl font-semibold tabular-nums mt-1 ${stats.totalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {stats.totalR > 0 ? '+' : ''}{stats.totalR.toFixed(2)}R
          </p>
          <p className="text-xs text-muted-foreground mt-1">{stats.count} trades</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Avg R per trade</p>
          <p className={`text-2xl font-semibold tabular-nums mt-1 ${stats.avgR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {stats.avgR.toFixed(2)}R
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Win Rate</p>
          <p className="text-2xl font-semibold tabular-nums mt-1">
            {stats.winRate !== null ? `${Math.round(stats.winRate * 100)}%` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Trigger Rate</p>
          <p className="text-2xl font-semibold tabular-nums mt-1">
            {stats.triggerRate !== null ? `${Math.round(stats.triggerRate * 100)}%` : '—'}
          </p>
        </div>
      </div>

      {/* Monthly chart */}
      {monthlyBreakdown.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">
            Monthly return — {monthLabel(fromMonth)} to {monthLabel(toMonth)}
            <span className="ml-2 text-muted-foreground/60">({monthlyBreakdown.length} months)</span>
          </p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              {selectedAnalysts.length > 1 && analystMonthlyData.length > 0 ? (
                <LineChart data={analystMonthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                    interval={Math.max(0, Math.floor(analystMonthlyData.length / 8))} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {selectedAnalysts.map((id, i) => {
                    const name = analysts.find(a => a.analyst_id === id)?.display_name.split(' ')[0] ?? id
                    return <Line key={id} type="monotone" dataKey={name}
                      stroke={ANALYST_COLOURS[i % ANALYST_COLOURS.length]} strokeWidth={2} dot={false} />
                  })}
                </LineChart>
              ) : (
                <BarChart data={monthlyBreakdown} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                    interval={Math.max(0, Math.floor(monthlyBreakdown.length / 8))} />
                  <YAxis hide />
                  <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}R`, 'Return']} contentStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Bar dataKey="totalR" radius={[2, 2, 0, 0]}>
                    {monthlyBreakdown.map((entry, i) => (
                      <Cell key={i} fill={entry.totalR >= 0 ? '#22c55e' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Monthly table */}
      {monthlyBreakdown.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Month-by-month breakdown</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {['Month', 'Trades', 'Total R', 'Avg R', 'Win Rate', 'Trigger Rate'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {([...monthlyBreakdown].reverse().slice(0, showAllMonths ? undefined : 12)).map(row => (
                  <tr key={row.key} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{row.label}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.count}</td>
                    <td className={`px-4 py-2.5 tabular-nums font-medium ${row.totalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {row.totalR > 0 ? '+' : ''}{row.totalR.toFixed(2)}R
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.avgR.toFixed(2)}R</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {row.winRate !== null ? `${Math.round(row.winRate * 100)}%` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {row.triggerRate !== null ? `${Math.round(row.triggerRate * 100)}%` : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/50 border-t border-border">
                <tr>
                  <td className="px-4 py-2.5 font-medium text-xs">Total</td>
                  <td className="px-4 py-2.5 tabular-nums text-xs font-medium">{stats.count}</td>
                  <td className={`px-4 py-2.5 tabular-nums text-xs font-bold ${stats.totalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {stats.totalR > 0 ? '+' : ''}{stats.totalR.toFixed(2)}R
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-xs text-muted-foreground">{stats.avgR.toFixed(2)}R</td>
                  <td className="px-4 py-2.5 tabular-nums text-xs">
                    {stats.winRate !== null ? `${Math.round(stats.winRate * 100)}%` : '—'}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-xs">
                    {stats.triggerRate !== null ? `${Math.round(stats.triggerRate * 100)}%` : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {monthlyBreakdown.length > 12 && (
            <button onClick={() => setShowAllMonths(!showAllMonths)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-2">
              {showAllMonths ? `Show less ▲` : `Show all ${monthlyBreakdown.length} months ▼`}
            </button>
          )}
        </div>
      )}

      {/* Analyst table */}
      {analystBreakdown.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">By analyst</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {['Analyst', 'Trades', 'Total R', 'Avg R', 'Win Rate', 'Trigger Rate'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {analystBreakdown.map((row, i) => (
                  <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: ANALYST_COLOURS[i % ANALYST_COLOURS.length] }} />
                      {row.name}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.count}</td>
                    <td className={`px-4 py-2.5 tabular-nums font-medium ${row.totalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {row.totalR > 0 ? '+' : ''}{row.totalR.toFixed(2)}R
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.avgR.toFixed(2)}R</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {row.winRate !== null ? `${Math.round(row.winRate * 100)}%` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {row.triggerRate !== null ? `${Math.round(row.triggerRate * 100)}%` : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="rounded-lg border border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">No trades match the current filters.</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Win rate based on result_r. Trigger rate based on triggered flag.
        Return figures include all historical data.
        Session derived from publication time (UK).
      </p>
    </div>
  )
}
