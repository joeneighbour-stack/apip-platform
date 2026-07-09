'use client'

import { useState } from 'react'

interface ShadowOutcome {
  shadow_outcome_id: string
  trade_outcome_status: string
  shadow_trade: {
    entry: number
    stop: number
    target: number
    rr: number
    generated_at: string
    opportunity: {
      date: string
      session: string
      direction: string
      market: { symbol: string; asset_class: string } | null
    } | null
  } | null
}

interface ActualTrade {
  trade_id: string
  direction: string
  result_r: number | null
  triggered: boolean
  published_at: string
  analyst: { display_name: string } | null
  market: { symbol: string; asset_class: string } | null
}

interface ShadowMonitoringPanelProps {
  shadowOutcomes: ShadowOutcome[]
  actualTrades: ActualTrade[]
  summaryStats: any[]
}

const STATUS_STYLES: Record<string, string> = {
  TARGET_HIT:    'bg-green-100 text-green-800',
  STOP_HIT:      'bg-red-100 text-red-800',
  EXPIRY:        'bg-muted text-muted-foreground',
  TRIGGERED:     'bg-blue-50 text-blue-700',
  NOT_TRIGGERED: 'bg-blue-50 text-blue-700',
}

function shadowResultR(outcome: ShadowOutcome): number | null {
  const st = outcome.shadow_trade
  if (!st) return null
  if (outcome.trade_outcome_status === 'TARGET_HIT') return st.rr
  if (outcome.trade_outcome_status === 'STOP_HIT') return -1
  return null
}

export function ShadowMonitoringPanel({
  shadowOutcomes, actualTrades, summaryStats
}: ShadowMonitoringPanelProps) {
  const [sessionFilter, setSessionFilter] = useState('ALL')
  const [assetFilter, setAssetFilter] = useState('ALL')

  // Compute shadow summary
  const resolved = shadowOutcomes.filter(o =>
    ['TARGET_HIT', 'STOP_HIT', 'EXPIRY'].includes(o.trade_outcome_status)
  )
  const triggered = shadowOutcomes.filter(o =>
    ['TARGET_HIT', 'STOP_HIT'].includes(o.trade_outcome_status)
  )
  const wins = shadowOutcomes.filter(o => o.trade_outcome_status === 'TARGET_HIT')
  const shadowWinRate = triggered.length > 0 ? wins.length / triggered.length : null
  const shadowTriggerRate = resolved.length > 0 ? triggered.length / resolved.length : null
  const shadowTotalR = triggered.reduce((sum, o) => sum + (shadowResultR(o) ?? 0), 0)

  // Compute actual trade summary (last 30 days, API only)
  const actualTriggered = actualTrades.filter(t => t.triggered && t.result_r !== null)
  const actualWins = actualTriggered.filter(t => (t.result_r ?? 0) > 0)
  const actualWinRate = actualTriggered.length > 0 ? actualWins.length / actualTriggered.length : null
  const actualTotalR = actualTriggered.reduce((sum, t) => sum + (t.result_r ?? 0), 0)
  const actualTriggerRate = actualTrades.length > 0 ? actualTriggered.length / actualTrades.length : null

  // Filter shadow outcomes for table
  const filtered = shadowOutcomes.filter(o => {
    const opp = o.shadow_trade?.opportunity
    if (sessionFilter !== 'ALL' && opp?.session !== sessionFilter) return false
    if (assetFilter !== 'ALL' && opp?.market?.asset_class !== assetFilter) return false
    return true
  })

  // Per-market shadow summary
  const byMarket = new Map<string, { symbol: string; total: number; triggered: number; wins: number; totalR: number }>()
  for (const o of shadowOutcomes) {
    const symbol = o.shadow_trade?.opportunity?.market?.symbol
    if (!symbol) continue
    const existing = byMarket.get(symbol) ?? { symbol, total: 0, triggered: 0, wins: 0, totalR: 0 }
    const isTriggered = ['TARGET_HIT', 'STOP_HIT'].includes(o.trade_outcome_status)
    const r = shadowResultR(o) ?? 0
    byMarket.set(symbol, {
      ...existing,
      total: existing.total + 1,
      triggered: existing.triggered + (isTriggered ? 1 : 0),
      wins: existing.wins + (o.trade_outcome_status === 'TARGET_HIT' ? 1 : 0),
      totalR: existing.totalR + r,
    })
  }

  const marketRows = [...byMarket.values()]
    .sort((a, b) => b.totalR - a.totalR)

  return (
    <div className="space-y-6">

      {/* Warning banner */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3">
        <p className="text-xs text-amber-800 font-medium">
          Shadow benchmark data is restricted to management. Analysts do not have visibility of these metrics.
          Shadow trades use the same recommendation versions shown to analysts but execute at the midpoint of the suggested entry range.
        </p>
      </div>

      {/* Summary comparison */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Shadow vs Actual — Since Platform Launch</h2>
        <div className="grid grid-cols-3 gap-3">
          {/* Shadow */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shadow Benchmark</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total setups</span>
                <span className="font-medium">{shadowOutcomes.length}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Trigger rate</span>
                <span className="font-medium">{shadowTriggerRate !== null ? `${Math.round(shadowTriggerRate * 100)}%` : '—'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Win rate</span>
                <span className="font-medium">{shadowWinRate !== null ? `${Math.round(shadowWinRate * 100)}%` : '—'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total R</span>
                <span className={`font-medium ${shadowTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {shadowTotalR > 0 ? '+' : ''}{shadowTotalR.toFixed(2)}R
                </span>
              </div>
            </div>
          </div>

          {/* Actual */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Analyst Actual (30 days)</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total setups</span>
                <span className="font-medium">{actualTrades.length}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Trigger rate</span>
                <span className="font-medium">{actualTriggerRate !== null ? `${Math.round(actualTriggerRate * 100)}%` : '—'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Win rate</span>
                <span className="font-medium">{actualWinRate !== null ? `${Math.round(actualWinRate * 100)}%` : '—'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total R</span>
                <span className={`font-medium ${actualTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {actualTotalR > 0 ? '+' : ''}{actualTotalR.toFixed(2)}R
                </span>
              </div>
            </div>
          </div>

          {/* Delta */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delta (Shadow − Actual)</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Setups comparable</span>
                <span className="font-medium text-muted-foreground">Different windows</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Win rate delta</span>
                <span className="font-medium">
                  {shadowWinRate !== null && actualWinRate !== null
                    ? `${((shadowWinRate - actualWinRate) * 100).toFixed(1)}pp`
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">R delta</span>
                <span className="font-medium text-muted-foreground">Accumulating...</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Status</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {triggered.length < 30 ? `Accumulating (${triggered.length}/30 triggered)` : 'Ready'}
                </span>
              </div>
            </div>
          </div>
        </div>
        {triggered.length < 30 && (
          <p className="text-xs text-muted-foreground">
            {triggered.length} shadow trades triggered so far. Statistical comparison becomes meaningful at ~30+ triggered outcomes per market.
          </p>
        )}
      </section>

      {/* Per-market shadow results */}
      {marketRows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">By Market</h2>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Market</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Setups</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Triggered</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Win Rate</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Total R</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {marketRows.map(row => (
                  <tr key={row.symbol} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium text-xs">{row.symbol}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.total}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">
                      {row.triggered}/{row.total} ({Math.round(row.triggered / row.total * 100)}%)
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">
                      {row.triggered > 0 ? `${Math.round(row.wins / row.triggered * 100)}%` : '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-xs font-medium tabular-nums ${
                      row.totalR >= 0 ? 'text-green-700' : 'text-red-700'
                    }`}>
                      {row.totalR > 0 ? '+' : ''}{row.totalR.toFixed(2)}R
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent shadow outcomes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent Shadow Outcomes</h2>
          <div className="flex items-center gap-2">
            <select value={sessionFilter} onChange={e => setSessionFilter(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
              <option value="ALL">All sessions</option>
              <option value="EUROPEAN">European</option>
              <option value="US">US</option>
              <option value="APAC">APAC</option>
            </select>
            <select value={assetFilter} onChange={e => setAssetFilter(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
              <option value="ALL">All classes</option>
              <option value="FX">FX</option>
              <option value="INDEX">Index</option>
              <option value="COMMODITY">Commodity</option>
              <option value="CRYPTO">Crypto</option>
            </select>
          </div>
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Market</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Session</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Direction</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Entry</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">RR</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Outcome</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Result R</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.slice(0, 50).map(outcome => {
                const st = outcome.shadow_trade
                const opp = st?.opportunity
                const resultR = shadowResultR(outcome)
                return (
                  <tr key={outcome.shadow_outcome_id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {opp?.date ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-xs">
                      {opp?.market?.symbol ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{opp?.session ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {opp?.direction && (
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          opp.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>{opp.direction}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                      {st?.entry != null ? Number(st.entry).toFixed(4) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                      {st?.rr != null ? `${Number(st.rr).toFixed(1)}:1` : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        STATUS_STYLES[outcome.trade_outcome_status] ?? 'bg-muted text-muted-foreground'
                      }`}>
                        {outcome.trade_outcome_status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums font-medium">
                      {resultR !== null
                        ? <span className={resultR >= 0 ? 'text-green-700' : 'text-red-700'}>
                            {resultR > 0 ? '+' : ''}{resultR.toFixed(2)}R
                          </span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
