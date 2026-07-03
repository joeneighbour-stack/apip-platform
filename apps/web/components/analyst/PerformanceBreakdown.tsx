'use client'

import { useState, useMemo } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'

interface Trade {
  trade_id: string
  direction: string
  result_r: number | null
  triggered: boolean
  published_at: string
  historical_backfill: boolean
  market: { symbol: string; asset_class: string } | null
}

interface PerformanceBreakdownProps {
  trades: Trade[]
}

const ASSET_CLASSES = ['ALL', 'FX', 'INDEX', 'COMMODITY', 'EQUITY', 'CRYPTO']
const DIRECTIONS = ['ALL', 'BUY', 'SELL']

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7) // 'YYYY-MM'
}

function monthLabel(key: string) {
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

interface Stats {
  totalR: number
  tradeCount: number
  wins: number
  winRate: number | null
  months: { key: string; label: string; totalR: number; count: number }[]
}

function computeStats(trades: Trade[]): Stats {
  const totalR = trades.reduce((sum, t) => sum + (t.result_r ?? 0), 0)
  const tradeCount = trades.length
  const platformTrades = trades.filter(t => !t.historical_backfill)
  const wins = platformTrades.filter(t => t.triggered && (t.result_r ?? 0) > 0).length
  const winRate = platformTrades.length > 0 ? wins / platformTrades.filter(t => t.triggered).length : null

  const byMonth = new Map<string, { totalR: number; count: number }>()
  for (const t of trades) {
    const key = monthKey(t.published_at)
    const existing = byMonth.get(key) ?? { totalR: 0, count: 0 }
    byMonth.set(key, { totalR: existing.totalR + (t.result_r ?? 0), count: existing.count + 1 })
  }

  const months = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => ({ key, label: monthLabel(key), ...val }))

  return { totalR, tradeCount, wins, winRate, months }
}

export function PerformanceBreakdown({ trades }: PerformanceBreakdownProps) {
  const [assetClass, setAssetClass] = useState('ALL')
  const [direction, setDirection] = useState('ALL')
  const [market, setMarket] = useState('ALL')

  // Available markets from trade data
  const markets = useMemo(() => {
    const symbols = [...new Set(trades.map(t => t.market?.symbol).filter(Boolean))] as string[]
    return ['ALL', ...symbols.sort()]
  }, [trades])

  // Filtered trades
  const filtered = useMemo(() => {
    return trades.filter(t => {
      if (assetClass !== 'ALL' && t.market?.asset_class !== assetClass) return false
      if (direction !== 'ALL' && t.direction !== direction) return false
      if (market !== 'ALL' && t.market?.symbol !== market) return false
      return true
    })
  }, [trades, assetClass, direction, market])

  const stats = useMemo(() => computeStats(filtered), [filtered])

  // Breakdown by asset class (when not filtered)
  const byAssetClass = useMemo(() => {
    const groups = new Map<string, Trade[]>()
    for (const t of trades) {
      const cls = t.market?.asset_class ?? 'UNKNOWN'
      if (!groups.has(cls)) groups.set(cls, [])
      groups.get(cls)!.push(t)
    }
    return [...groups.entries()]
      .map(([cls, ts]) => ({ cls, ...computeStats(ts) }))
      .sort((a, b) => b.totalR - a.totalR)
  }, [trades])

  // Breakdown by direction
  const byDirection = useMemo(() => {
    return ['BUY', 'SELL'].map(dir => {
      const ts = trades.filter(t => t.direction === dir)
      return { dir, ...computeStats(ts) }
    })
  }, [trades])

  const hasFilter = assetClass !== 'ALL' || direction !== 'ALL' || market !== 'ALL'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Performance Breakdown</h2>
        <div className="flex items-center gap-2">
          <select value={assetClass} onChange={e => { setAssetClass(e.target.value); setMarket('ALL') }}
            className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
            {ASSET_CLASSES.map(c => <option key={c} value={c}>{c === 'ALL' ? 'All classes' : c}</option>)}
          </select>
          <select value={market} onChange={e => setMarket(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
            {markets.map(m => <option key={m} value={m}>{m === 'ALL' ? 'All markets' : m}</option>)}
          </select>
          <select value={direction} onChange={e => setDirection(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
            {DIRECTIONS.map(d => <option key={d} value={d}>{d === 'ALL' ? 'All directions' : d}</option>)}
          </select>
          {hasFilter && (
            <button onClick={() => { setAssetClass('ALL'); setDirection('ALL'); setMarket('ALL') }}
              className="text-xs px-2 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Summary stats for current filter */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Return</p>
          <p className={`text-2xl font-semibold tabular-nums mt-1 ${stats.totalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {stats.totalR > 0 ? '+' : ''}{stats.totalR.toFixed(2)}R
          </p>
          <p className="text-xs text-muted-foreground mt-1">{stats.tradeCount} trades</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Win Rate</p>
          <p className="text-2xl font-semibold tabular-nums mt-1">
            {stats.winRate !== null ? `${Math.round(stats.winRate * 100)}%` : <span className="text-lg text-muted-foreground">—</span>}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Platform trades only</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Avg R per trade</p>
          <p className={`text-2xl font-semibold tabular-nums mt-1 ${stats.tradeCount > 0 && stats.totalR / stats.tradeCount >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {stats.tradeCount > 0 ? `${(stats.totalR / stats.tradeCount).toFixed(2)}R` : '—'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">All history</p>
        </div>
      </div>

      {/* Monthly R trend for filtered selection */}
      {stats.months.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Monthly return trend</p>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.months} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                  interval={Math.floor(stats.months.length / 12)} />
                <YAxis hide />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}R`, 'Return']} contentStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Bar dataKey="totalR" radius={[2, 2, 0, 0]}>
                  {stats.months.map((entry, i) => (
                    <Cell key={i} fill={entry.totalR >= 0 ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Asset class breakdown */}
      {!hasFilter && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">By asset class</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Class</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Trades</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Total R</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Avg R</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Win Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byAssetClass.map(row => (
                  <tr key={row.cls} className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setAssetClass(row.cls)}>
                    <td className="px-4 py-2.5 font-medium">{row.cls}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.tradeCount}</td>
                    <td className={`px-4 py-2.5 tabular-nums font-medium ${row.totalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {row.totalR > 0 ? '+' : ''}{row.totalR.toFixed(2)}R
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {(row.totalR / row.tradeCount).toFixed(2)}R
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {row.winRate !== null ? `${Math.round(row.winRate * 100)}%` : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Click a row to filter by that asset class</p>
        </div>
      )}

      {/* Direction breakdown */}
      {!hasFilter && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">By direction</p>
          <div className="grid grid-cols-2 gap-3">
            {byDirection.map(row => (
              <div key={row.dir}
                className="rounded-lg border border-border bg-card p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setDirection(row.dir)}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    row.dir === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>{row.dir}</span>
                  <span className="text-xs text-muted-foreground">{row.tradeCount} trades</span>
                </div>
                <p className={`text-xl font-semibold tabular-nums ${row.totalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {row.totalR > 0 ? '+' : ''}{row.totalR.toFixed(2)}R
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Avg {(row.totalR / Math.max(row.tradeCount, 1)).toFixed(2)}R per trade
                  {row.winRate !== null ? ` · ${Math.round(row.winRate * 100)}% win rate` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Win rate shown for platform-tracked trades only. Historical backfill data included in return figures.
      </p>
    </div>
  )
}
