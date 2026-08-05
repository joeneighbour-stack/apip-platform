'use client'
import { useState, useMemo } from 'react'
import { useLivePrices } from '@/hooks/useLivePrices'
import { UnrealisedR } from '@/components/shared/UnrealisedR'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts'

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
      market: { symbol: string; asset_class: string; display_precision: number | null; market_id: string } | null
    } | null
  } | null
}

interface ActualTrade {
  trade_id: string
  direction: string
  result_r: number | null
  triggered: boolean
  published_at: string
  market: { symbol: string; asset_class: string; market_id: string } | null
}

interface ActualPublication {
  published_at: string
  reconciliation_status: string
}

interface Props {
  shadowOutcomes: ShadowOutcome[]
  actualTrades: ActualTrade[]
  actualPublications: ActualPublication[]
  // Rendered between "Since Platform Launch" and "Shadow Outcomes" -- the Analyst vs Shadow
  // Breakdown grid lives in its own component (own data fetch, own client state) but needs to
  // appear in the middle of this panel's section order, not after it.
  breakdownSlot?: React.ReactNode
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

const COMPARISON_WINDOWS = [
  { label: '30 days', days: 30 },
  { label: '60 days', days: 60 },
  { label: '90 days', days: 90 },
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

function monthLabel(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short' })
}

export function ShadowMonitoringPanel({ shadowOutcomes, actualTrades, actualPublications, breakdownSlot }: Props) {
  // Live prices for TRIGGERED shadow trades
  const triggeredSymbols = [...new Set(shadowOutcomes
    .filter(o => o.trade_outcome_status === 'TRIGGERED')
    .map(o => o.shadow_trade?.opportunity?.market?.symbol)
    .filter(Boolean) as string[]
  )]
  const { prices: livePrices } = useLivePrices(triggeredSymbols)

  const [sessionFilter, setSessionFilter] = useState('ALL')
  const [assetFilter, setAssetFilter] = useState('ALL')
  const [outcomeFilter, setOutcomeFilter] = useState('ALL')
  const [dateRangeDays, setDateRangeDays] = useState(1)
  const [comparisonWindow, setComparisonWindow] = useState(30)

  // Simple aggregate comparison: all shadow trade outcomes vs all analyst actual
  // trades for the period, grouped by date only -- not restricted to markets
  // triggered by both. A prior version keyed both sides by `marketId::date`, which
  // zeroed out analyst R for any day the analyst didn't trade the exact same market
  // as a given shadow setup, and could double-count analyst R when multiple shadow
  // outcomes existed for the same market/date.
  const dailyComparison = useMemo(() => {
    const cutoff = new Date(Date.now() - comparisonWindow * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const actualRByDate = new Map<string, number>()
    for (const at of actualTrades) {
      const date = at.published_at.slice(0, 10)
      if (date < cutoff) continue
      const r = at.triggered && at.result_r !== null ? Number(at.result_r) : 0
      actualRByDate.set(date, (actualRByDate.get(date) ?? 0) + r)
    }

    const dailyData = new Map<string, { date: string; shadowR: number; analystR: number; count: number }>()
    for (const outcome of shadowOutcomes) {
      const opp = outcome.shadow_trade?.opportunity
      if (!opp?.date || opp.date < cutoff) continue
      const shadowR = shadowResultR(outcome) ?? 0
      const existing = dailyData.get(opp.date) ?? { date: opp.date, shadowR: 0, analystR: actualRByDate.get(opp.date) ?? 0, count: 0 }
      dailyData.set(opp.date, { ...existing, shadowR: existing.shadowR + shadowR, count: existing.count + 1 })
    }
    // Days with analyst trades but no shadow outcome shouldn't be dropped -- the
    // analyst side of the comparison covers the whole period, not just days the
    // shadow engine also produced a setup.
    for (const [date, r] of actualRByDate.entries()) {
      if (!dailyData.has(date)) dailyData.set(date, { date, shadowR: 0, analystR: r, count: 0 })
    }

    const sorted = [...dailyData.values()].sort((a, b) => a.date.localeCompare(b.date))
    let cumulativeShadow = 0
    let cumulativeAnalyst = 0
    return sorted.map(d => {
      cumulativeShadow += d.shadowR
      cumulativeAnalyst += d.analystR
      return {
        date: monthLabel(d.date),
        dailyShadowR: d.shadowR,
        dailyAnalystR: d.analystR,
        cumulativeShadowR: cumulativeShadow,
        cumulativeAnalystR: cumulativeAnalyst,
        count: d.count,
      }
    })
  }, [shadowOutcomes, actualTrades, comparisonWindow])

  const totalShadowR = dailyComparison.length > 0 ? dailyComparison[dailyComparison.length - 1]!.cumulativeShadowR : 0
  const totalAnalystR = dailyComparison.length > 0 ? dailyComparison[dailyComparison.length - 1]!.cumulativeAnalystR : 0
  const deltaR = totalShadowR - totalAnalystR

  const triggered = shadowOutcomes.filter(o =>
    ['TARGET_HIT', 'STOP_HIT', 'TRIGGERED', 'CLOSED_PROFIT', 'CLOSED_LOSS'].includes(o.trade_outcome_status)
  )
  const resolved = shadowOutcomes.filter(o =>
    ['TARGET_HIT', 'STOP_HIT', 'CLOSED_PROFIT', 'CLOSED_LOSS'].includes(o.trade_outcome_status)
  )
  const wins = shadowOutcomes.filter(o => ['TARGET_HIT', 'CLOSED_PROFIT'].includes(o.trade_outcome_status))
  const shadowWinRate = triggered.length > 0 ? wins.length / triggered.length : null
  const shadowTriggerRate = shadowOutcomes.length > 0 ? triggered.length / shadowOutcomes.length : null
  const shadowTotalR = triggered.reduce((s, o) => s + (shadowResultR(o) ?? 0), 0)
  const shadowAvgRr = triggered.length > 0
    ? triggered.reduce((s, o) => s + (o.shadow_trade?.rr ?? 0), 0) / triggered.length
    : null

  // "Total setups" and "Triggered"/"Trigger rate" compare against the same universe the
  // shadow side counts from (a recommendation, not an executed trade) -- analyst_publications,
  // not actual_trades. Using trade rows here previously undercounted "setups" against shadow's
  // 586, since a setup that never triggered has a publication but no actual_trades row at all.
  // Triggered is read straight off reconciliation_status (WEBHOOK_TRUE), the same signal
  // lib/metrics.ts's canonical triggerRate() and calculateKpis.ts use -- not a join to
  // actual_trades, which is known to understate this (see lib/metrics.ts comment on
  // triggerRate()). actualTrades (and its triggered/result_r fields) is still the only source
  // for Win rate and Total R, since publications don't carry a financial result.
  const actualTriggered = actualTrades.filter(t => t.triggered && t.result_r !== null)
  const actualWins = actualTriggered.filter(t => (t.result_r ?? 0) > 0)
  const actualWinRate = actualTriggered.length > 0 ? actualWins.length / actualTriggered.length : null
  const actualTotalR = actualTriggered.reduce((s, t) => s + (t.result_r ?? 0), 0)
  const actualPublicationsTriggered = actualPublications.filter(p => p.reconciliation_status === 'WEBHOOK_TRUE')
  const actualTriggerRate = actualPublications.length > 0 ? actualPublicationsTriggered.length / actualPublications.length : null

  const byMarket = new Map<string, { symbol: string; assetClass: string; total: number; triggered: number; wins: number; totalR: number; avgRr: number; rrCount: number }>()
  for (const o of shadowOutcomes) {
    const st = o.shadow_trade
    const symbol = st?.opportunity?.market?.symbol
    const assetClass = st?.opportunity?.market?.asset_class ?? ''
    if (!symbol) continue
    const existing = byMarket.get(symbol) ?? { symbol, assetClass, total: 0, triggered: 0, wins: 0, totalR: 0, avgRr: 0, rrCount: 0 }
    const isTriggered = ['TARGET_HIT', 'STOP_HIT', 'TRIGGERED', 'CLOSED_PROFIT', 'CLOSED_LOSS'].includes(o.trade_outcome_status)
    const r = shadowResultR(o) ?? 0
    byMarket.set(symbol, {
      ...existing,
      total: existing.total + 1,
      triggered: existing.triggered + (isTriggered ? 1 : 0),
      wins: existing.wins + (['TARGET_HIT', 'CLOSED_PROFIT'].includes(o.trade_outcome_status) ? 1 : 0),
      totalR: existing.totalR + r,
      avgRr: existing.avgRr + (st?.rr ?? 0),
      rrCount: existing.rrCount + 1,
    })
  }
  const marketRows = [...byMarket.values()].sort((a, b) => b.totalR - a.totalR)

  const dateFilteredOutcomes = useMemo(() => {
    if (dateRangeDays === 0) return shadowOutcomes
    const cutoff = new Date(Date.now() - dateRangeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    return shadowOutcomes.filter(o => (o.shadow_trade as any)?.opportunity?.date >= cutoff)
  }, [shadowOutcomes, dateRangeDays])

  const filtered = dateFilteredOutcomes.filter(o => {
    const st = o.shadow_trade as any
    if (sessionFilter !== 'ALL' && st?.session !== sessionFilter) return false
    if (assetFilter !== 'ALL' && st?.opportunity?.market?.asset_class !== assetFilter) return false
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

      {/* Period comparison chart */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Shadow vs Analyst &mdash; Period Comparison</h2>
          <div className="flex items-center gap-1">
            {COMPARISON_WINDOWS.map(w => (
              <button key={w.days}
                onClick={() => setComparisonWindow(w.days)}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  comparisonWindow === w.days
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}>
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Aggregate comparison: all shadow trade outcomes vs all analyst actual trades for the period, by date. Not restricted to markets triggered by both.
        </p>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shadow R ({comparisonWindow}d)</p>
            <p className={`text-2xl font-semibold tabular-nums ${totalShadowR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {totalShadowR > 0 ? '+' : ''}{totalShadowR.toFixed(2)}R
            </p>
            <p className="text-xs text-muted-foreground">{dailyComparison.length} trading days</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Analyst R ({comparisonWindow}d)</p>
            <p className={`text-2xl font-semibold tabular-nums ${totalAnalystR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {totalAnalystR > 0 ? '+' : ''}{totalAnalystR.toFixed(2)}R
            </p>
            <p className="text-xs text-muted-foreground">All markets</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Framework Edge</p>
            <p className={`text-2xl font-semibold tabular-nums ${deltaR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {deltaR > 0 ? '+' : ''}{deltaR.toFixed(2)}R
            </p>
            <p className="text-xs text-muted-foreground">Shadow minus analyst</p>
          </div>
        </div>

        {dailyComparison.length > 0 ? (
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-3">Cumulative R &mdash; Shadow vs Analyst</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyComparison} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                    interval={Math.max(0, Math.floor(dailyComparison.length / 8))} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}R`} />
                  <Tooltip
                    formatter={(v: any, name: string) => [`${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}R`, name]}
                    contentStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="cumulativeShadowR" name="Shadow" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="cumulativeAnalystR" name="Analyst" stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">No comparison data yet.</p>
          </div>
        )}
      </section>

      {/* Standard summary */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Shadow vs Actual &mdash; Since Platform Launch</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shadow Benchmark</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Total setups</span><span className="font-medium">{shadowOutcomes.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Resolved</span><span className="font-medium">{resolved.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger rate</span><span className="font-medium">{shadowTriggerRate !== null ? `${Math.round(shadowTriggerRate * 100)}%` : '—'}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate</span><span className="font-medium">{shadowWinRate !== null ? `${Math.round(shadowWinRate * 100)}%` : '—'}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Avg RR</span><span className="font-medium">{shadowAvgRr !== null ? `${shadowAvgRr.toFixed(1)}:1` : '—'}</span></div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total R</span>
                <span className={`font-medium ${shadowTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {shadowTotalR > 0 ? '+' : ''}{shadowTotalR.toFixed(2)}R
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Analyst Actual (Since Shadow Launch)</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Total setups</span><span className="font-medium">{actualPublications.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Triggered</span><span className="font-medium">{actualPublicationsTriggered.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger rate</span><span className="font-medium">{actualTriggerRate !== null ? `${Math.round(actualTriggerRate * 100)}%` : '—'}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate</span><span className="font-medium">{actualWinRate !== null ? `${Math.round(actualWinRate * 100)}%` : '—'}</span></div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total R</span>
                <span className={`font-medium ${actualTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {actualTotalR > 0 ? '+' : ''}{actualTotalR.toFixed(2)}R
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delta (Shadow &minus; Actual)</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate delta</span>
                <span className="font-medium">
                  {shadowWinRate !== null && actualWinRate !== null ? `${((shadowWinRate - actualWinRate) * 100).toFixed(1)}pp` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger delta</span>
                <span className="font-medium">
                  {shadowTriggerRate !== null && actualTriggerRate !== null ? `${((shadowTriggerRate - actualTriggerRate) * 100).toFixed(1)}pp` : '—'}
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

      {breakdownSlot}

      {/* Shadow outcomes table */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Shadow Outcomes ({filtered.length}
            {dateRangeDays > 0 ? ` — last ${dateRangeDays === 1 ? '24 hours' : `${dateRangeDays} days`}` : ' — all time'})
          </h2>
          <div className="flex items-center gap-2 flex-wrap justify-end">
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
                const st = outcome.shadow_trade as any
                const opp = st?.opportunity
                const precision = opp?.market?.display_precision ?? 4
                const resultR = shadowResultR(outcome)
                const dir = st?.direction
                const symbol = opp?.market?.symbol ?? ''
                const currentPrice = livePrices[symbol] ?? null
                const isOpenTriggered = outcome.trade_outcome_status === 'TRIGGERED'

                return (
                  <tr key={outcome.shadow_outcome_id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{opp?.date ?? '—'}</td>
                    <td className="px-3 py-2 font-medium text-xs whitespace-nowrap">{symbol || '—'}</td>
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
                      {resultR !== null ? (
                        <span className={resultR >= 0 ? 'text-green-700' : 'text-red-700'}>
                          {resultR > 0 ? '+' : ''}{resultR.toFixed(2)}R
                        </span>
                      ) : isOpenTriggered && st?.entry != null && st?.stop != null && st?.target != null ? (
                        <UnrealisedR
                          entry={Number(st.entry)}
                          stop={Number(st.stop)}
                          target={Number(st.target)}
                          direction={dir as 'BUY' | 'SELL'}
                          currentPrice={currentPrice}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* By market */}
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
