'use client'
import { useState, useMemo } from 'react'

interface ShadowOutcome {
  shadow_outcome_id: string
  trade_outcome_status: string
  result_r: number | null
  outcome_timestamp: string | null
  shadow_trade: {
    shadow_trade_id: string
    entry: number
    stop: number
    target: number
    rr: number
    direction: string | null
    session: string | null
    template_source: string
    generated_at: string
    opportunity: {
      date: string
      market: { symbol: string; asset_class: string; display_precision: number | null } | null
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

interface Props {
  shadowOutcomes: ShadowOutcome[]
  actualTrades: ActualTrade[]
}

const STATUS_STYLES: Record<string, string> = {
  TARGET_HIT:    'bg-green-100 text-green-800',
  STOP_HIT:      'bg-red-100 text-red-800',
  EXPIRY:        'bg-muted text-muted-foreground',
  TRIGGERED:     'bg-blue-50 text-blue-700',
  NOT_TRIGGERED: 'bg-slate-100 text-slate-600',
}

const DATE_RANGES = [
  { label: 'Today', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
  { label: 'All time', days: 0 },
]

function fmtPrice(price: number, precision: number | null | undefined): string {
  return price.toFixed(precision ?? 4)
}

function shadowResultR(outcome: ShadowOutcome): number | null {
  if (outcome.result_r !== null) return outcome.result_r
  const st = outcome.shadow_trade
  if (!st) return null
  if (outcome.trade_outcome_status === 'TARGET_HIT') return st.rr
  if (outcome.trade_outcome_status === 'STOP_HIT') return -1
  return null
}

export function ShadowMonitoringPanel({ shadowOutcomes, actualTrades }: Props) {
  const [sessionFilter, setSessionFilter] = useState('ALL')
  const [assetFilter, setAssetFilter] = useState('ALL')
  const [outcomeFilter, setOutcomeFilter] = useState('ALL')
  const [dateRangeDays, setDateRangeDays] = useState(1) // default: today only

  // Apply date range filter to outcomes table
  const dateFilteredOutcomes = useMemo(() => {
    if (dateRangeDays === 0) return shadowOutcomes
    const cutoff = new Date(Date.now() - dateRangeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    return shadowOutcomes.filter(o => {
      const date = o.shadow_trade?.opportunity?.date ?? ''
      return date >= cutoff
    })
  }, [shadowOutcomes, dateRangeDays])

  // Summary always uses ALL data
  const resolved = shadowOutcomes.filter(o =>
    ['TARGET_HIT', 'STOP_HIT', 'EXPIRY'].includes(o.trade_outcome_status)
  )
  const triggered = shadowOutcomes.filter(o =>
    ['TARGET_HIT', 'STOP_HIT', 'TRIGGERED'].includes(o.trade_outcome_status)
  )
  const wins = shadowOutcomes.filter(o => o.trade_outcome_status === 'TARGET_HIT')
  const shadowWinRate = triggered.length > 0 ? wins.length / triggered.length : null
  const shadowTriggerRate = shadowOutcomes.length > 0 ? triggered.length / shadowOutcomes.length : null
  const shadowTotalR = triggered.reduce((sum, o) => sum + (shadowResultR(o) ?? 0), 0)
  const shadowAvgRr = triggered.length > 0
    ? triggered.reduce((s, o) => s + (o.shadow_trade?.rr ?? 0), 0) / triggered.length
    : null

  // Actual summary
  const actualTriggered = actualTrades.filter(t => t.triggered && t.result_r !== null)
  const actualWins = actualTriggered.filter(t => (t.result_r ?? 0) > 0)
  const actualWinRate = actualTriggered.length > 0 ? actualWins.length / actualTriggered.length : null
  const actualTotalR = actualTriggered.reduce((sum, t) => sum + (t.result_r ?? 0), 0)
  const actualTriggerRate = actualTrades.length > 0 ? actualTriggered.length / actualTrades.length : null

  // Per-market (all time)
  const byMarket = new Map<string, {
    symbol: string; assetClass: string; total: number; triggered: number;
    wins: number; totalR: number; avgRr: number; rrCount: number
  }>()
  for (const o of shadowOutcomes) {
    const st = o.shadow_trade
    const symbol = st?.opportunity?.market?.symbol
    const assetClass = st?.opportunity?.market?.asset_class ?? ''
    if (!symbol) continue
    const existing = byMarket.get(symbol) ?? { symbol, assetClass, total: 0, triggered: 0, wins: 0, totalR: 0, avgRr: 0, rrCount: 0 }
    const isTriggered = ['TARGET_HIT', 'STOP_HIT', 'TRIGGERED'].includes(o.trade_outcome_status)
    const r = shadowResultR(o) ?? 0
    byMarket.set(symbol, {
      ...existing,
      total: existing.total + 1,
      triggered: existing.triggered + (isTriggered ? 1 : 0),
      wins: existing.wins + (o.trade_outcome_status === 'TARGET_HIT' ? 1 : 0),
      totalR: existing.totalR + r,
      avgRr: existing.avgRr + (st?.rr ?? 0),
      rrCount: existing.rrCount + 1,
    })
  }
  const marketRows = [...byMarket.values()].sort((a, b) => b.totalR - a.totalR)

  // Filtered outcomes for table
  const filtered = dateFilteredOutcomes.filter(o => {
    const st = o.shadow_trade
    const opp = st?.opportunity
    if (sessionFilter !== 'ALL' && st?.session !== sessionFilter) return false
    if (assetFilter !== 'ALL' && opp?.market?.asset_class !== assetFilter) return false
    if (outcomeFilter !== 'ALL' && o.trade_outcome_status !== outcomeFilter) return false
    return true
  })

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3">
        <p className="text-xs text-amber-800 font-medium">
          Shadow benchmark data is restricted to management. Analysts do not have visibility of these metrics.
          Shadow trades execute at the midpoint of the suggested entry range using median ATR-normalised stop/target distances.
        </p>
      </div>

      {/* Summary */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Shadow vs Actual — Since Platform Launch</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shadow Benchmark</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Total setups</span><span className="font-medium">{shadowOutcomes.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Resolved</span><span className="font-medium">{resolved.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger rate</span><span className="font-medium">{shadowTriggerRate !== null ? `${Math.round(shadowTriggerRate * 100)}%` : '—'}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate</span><span className="font-medium">{shadowWinRate !== null ? `${Math.round(shadowWinRate * 100)}%` : '—'}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Avg planned RR</span><span className="font-medium">{shadowAvgRr !== null ? `${shadowAvgRr.toFixed(1)}:1` : '—'}</span></div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total R</span>
                <span className={`font-medium ${shadowTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {shadowTotalR > 0 ? '+' : ''}{shadowTotalR.toFixed(2)}R
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Analyst Actual (30 days)</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Total setups</span><span className="font-medium">{actualTrades.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Triggered</span><span className="font-medium">{actualTriggered.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger rate</span><span className="font-medium">{actualTriggerRate !== null ? `${Math.round(actualTriggerRate * 100)}%` : '—'}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate</span><span className="font-medium">{actualWinRate !== null ? `${Math.round(actualWinRate * 100)}%` : '—'}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Avg planned RR</span><span className="font-medium text-muted-foreground">—</span></div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total R</span>
                <span className={`font-medium ${actualTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {actualTotalR > 0 ? '+' : ''}{actualTotalR.toFixed(2)}R
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delta (Shadow − Actual)</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate delta</span>
                <span className="font-medium">
                  {shadowWinRate !== null && actualWinRate !== null
                    ? `${((shadowWinRate - actualWinRate) * 100).toFixed(1)}pp` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger delta</span>
                <span className="font-medium">
                  {shadowTriggerRate !== null && actualTriggerRate !== null
                    ? `${((shadowTriggerRate - actualTriggerRate) * 100).toFixed(1)}pp` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Status</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {triggered.length < 30 ? `Accumulating (${triggered.length}/30)` : 'Ready'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Outcomes table */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Shadow Outcomes ({filtered.length}
            {dateRangeDays > 0 ? ` — last ${dateRangeDays === 1 ? '24 hours' : `${dateRangeDays} days`}` : ' — all time'})
          </h2>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Date range buttons */}
            <div className="flex items-center gap-1">
              {DATE_RANGES.map(r => (
                <button key={r.days}
                  onClick={() => setDateRangeDays(r.days)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                    dateRangeDays === r.days
                      ? 'bg-foreground text-background border-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
            <select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
              <option value="ALL">All outcomes</option>
              <option value="NOT_TRIGGERED">Not triggered</option>
              <option value="TRIGGERED">Triggered</option>
              <option value="TARGET_HIT">Target hit</option>
              <option value="STOP_HIT">Stop hit</option>
              <option value="EXPIRY">Expiry</option>
            </select>
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
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Date', 'Market', 'Session', 'Dir', 'Entry', 'Stop', 'Target', 'RR', 'Outcome', 'Result R'].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    No shadow outcomes for the selected period.
                  </td>
                </tr>
              ) : filtered.map(outcome => {
                const st = outcome.shadow_trade
                const opp = st?.opportunity
                const precision = opp?.market?.display_precision ?? 4
                const resultR = shadowResultR(outcome)
                const dir = st?.direction
                return (
                  <tr key={outcome.shadow_outcome_id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{opp?.date ?? '—'}</td>
                    <td className="px-3 py-2 font-medium text-xs whitespace-nowrap">{opp?.market?.symbol ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{st?.session ?? '—'}</td>
                    <td className="px-3 py-2">
                      {dir ? (
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          dir === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>{dir}</span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                      {st?.entry != null ? fmtPrice(Number(st.entry), precision) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-red-700 whitespace-nowrap">
                      {st?.stop != null ? fmtPrice(Number(st.stop), precision) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-green-700 whitespace-nowrap">
                      {st?.target != null ? fmtPrice(Number(st.target), precision) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                      {st?.rr != null ? `${Number(st.rr).toFixed(1)}:1` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                        STATUS_STYLES[outcome.trade_outcome_status] ?? 'bg-muted text-muted-foreground'
                      }`}>
                        {outcome.trade_outcome_status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums font-medium">
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
      {/* Per-market */}
      {marketRows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">By Market (All Time)</h2>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {['Market', 'Class', 'Setups', 'Triggered', 'Win Rate', 'Avg RR', 'Total R'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {marketRows.map(row => (
                  <tr key={row.symbol} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium text-xs">{row.symbol}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.assetClass}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.total}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">
                      {row.triggered}/{row.total} ({Math.round(row.triggered / row.total * 100)}%)
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">
                      {row.triggered > 0 ? `${Math.round(row.wins / row.triggered * 100)}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                      {row.rrCount > 0 ? `${(row.avgRr / row.rrCount).toFixed(1)}:1` : '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-xs font-medium tabular-nums ${row.totalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {row.totalR > 0 ? '+' : ''}{row.totalR.toFixed(2)}R
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

    </div>
  )
}
