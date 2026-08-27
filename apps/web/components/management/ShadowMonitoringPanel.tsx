'use client'
import { useState, useMemo, Fragment } from 'react'
import { useLivePrices } from '@/hooks/useLivePrices'
import { UnrealisedR } from '@/components/shared/UnrealisedR'
import { ShadowSinceLaunchStats } from './ShadowSinceLaunchStats'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts'

type EntryVariant = 'CONSERVATIVE' | 'MID' | 'AGGRESSIVE'
type ShadowSystem = 'ANALYST_MIRROR' | 'OPTIMAL'

interface ShadowOutcome {
  shadow_outcome_id: string
  trade_outcome_status: string
  result_r: number | null
  mfe_r: number | null
  mae_r: number | null
  raw_price_evidence: Record<string, any> | null
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
    entry_variant: EntryVariant | null
    shadow_system: ShadowSystem | null
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
  // All variants x both systems -- feeds the variant-grouped trade table (further
  // scoped by the system tab, ANALYST_MIRROR/OPTIMAL), the Variant Performance tab,
  // and (via the system-scoped systemCanonicalOutcomes memo below) the aggregate
  // stats sections. Filtered upstream in shadow/page.tsx.
  shadowOutcomes: ShadowOutcome[]
  // ANALYST_MIRROR + MID only, fixed regardless of the system tab -- kept for
  // API-compatibility with shadow/page.tsx; not read anywhere in this component
  // (AnalystShadowBreakdown, the one consumer that needs a fixed ANALYST_MIRROR
  // baseline, is fed its own separate data via getShadowBreakdownData in page.tsx,
  // not this prop).
  canonicalShadowOutcomes: ShadowOutcome[]
  actualTrades: ActualTrade[]
  actualPublications: ActualPublication[]
  // Rendered between "Since Platform Launch" and "Shadow Outcomes" -- the Analyst vs Shadow
  // Breakdown grid lives in its own component (own data fetch, own client state) but needs to
  // appear in the middle of this panel's section order, not after it.
  breakdownSlot?: React.ReactNode
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

// mfe_r/mae_r are only written at close (monitorShadowTrades.ts) -- for a still-open
// TRIGGERED trade they're null, and the current running value instead lives in
// raw_price_evidence.running_mfe_r/running_mae_r (written on every monitor run that
// processes a new bar). Falls back to null when neither is available (NOT_TRIGGERED,
// or a TRIGGERED trade with no bar processed yet this run).
function effectiveMfe(outcome: ShadowOutcome): number | null {
  if (outcome.mfe_r !== null) return outcome.mfe_r  // closed trade — use final value
  const evidence = outcome.raw_price_evidence as any
  return typeof evidence?.running_mfe_r === 'number' ? evidence.running_mfe_r : null
}

function effectiveMae(outcome: ShadowOutcome): number | null {
  if (outcome.mae_r !== null) return outcome.mae_r  // closed trade — use final value
  const evidence = outcome.raw_price_evidence as any
  return typeof evidence?.running_mae_r === 'number' ? evidence.running_mae_r : null
}

function monthLabel(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short' })
}

// Same status set byMarket already used inline for "has this setup actually
// triggered (or gone further)" -- extracted here so the Variant Performance tab's
// Triggered % uses the identical definition rather than a second, subtly
// different one.
const TRIGGERED_OR_BEYOND = ['TARGET_HIT', 'STOP_HIT', 'TRIGGERED', 'CLOSED_PROFIT', 'CLOSED_LOSS']

const ENTRY_VARIANTS: EntryVariant[] = ['CONSERVATIVE', 'MID', 'AGGRESSIVE']
const VARIANT_LABELS: Record<EntryVariant, string> = {
  CONSERVATIVE: 'Conservative',
  MID: 'Mid',
  AGGRESSIVE: 'Aggressive',
}
const SYSTEM_LABELS: Record<ShadowSystem, string> = {
  ANALYST_MIRROR: 'Analyst Mirror', OPTIMAL: 'Optimal Signal',
}

function statusColour(status: string): string {
  switch (status) {
    case 'TARGET_HIT':
    case 'CLOSED_PROFIT': return 'text-green-700 font-medium'
    case 'STOP_HIT':
    case 'CLOSED_LOSS':   return 'text-red-700 font-medium'
    case 'TRIGGERED':     return 'text-blue-600'
    case 'NOT_TRIGGERED': return 'text-slate-500'
    case 'EXPIRY':         return 'text-muted-foreground'
    default:               return 'text-muted-foreground'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'TARGET_HIT':    return 'Target'
    case 'STOP_HIT':      return 'Stop'
    case 'CLOSED_PROFIT': return 'Profit'
    case 'CLOSED_LOSS':   return 'Loss'
    case 'TRIGGERED':     return 'Open'
    case 'NOT_TRIGGERED': return 'Pending'
    case 'EXPIRY':         return 'Expired'
    default:               return status.replace(/_/g, ' ')
  }
}

// Variant cell -- one column per entry variant in the grouped trade table (Fix 3).
function VariantCell({ outcome }: { outcome: ShadowOutcome | null }) {
  if (!outcome) return <td className="px-3 py-2 text-xs text-muted-foreground">—</td>
  const status = outcome.trade_outcome_status
  const r = shadowResultR(outcome)
  return (
    <td className="px-3 py-2 text-xs">
      <span className={statusColour(status)}>{statusLabel(status)}</span>
      {r !== null && (
        <span className={`ml-1 tabular-nums ${r >= 0 ? 'text-green-700' : 'text-red-700'}`}>
          {r > 0 ? '+' : ''}{r.toFixed(2)}R
        </span>
      )}
    </td>
  )
}

export function ShadowMonitoringPanel({ shadowOutcomes, canonicalShadowOutcomes, actualTrades, actualPublications, breakdownSlot }: Props) {
  // Live prices for TRIGGERED shadow trades
  const triggeredSymbols = [...new Set(shadowOutcomes
    .filter(o => o.trade_outcome_status === 'TRIGGERED')
    .map(o => o.shadow_trade?.opportunity?.market?.symbol)
    .filter(Boolean) as string[]
  )]
  const { prices: livePrices } = useLivePrices(triggeredSymbols)

  // Outer tab: the existing panel (all sections below, now scoped by the system
  // tab underneath it) vs the new Variant Performance summary (Fix 5) -- separate
  // from, and unaffected by, the system tab, since it deliberately spans both
  // systems (one row per variant x system).
  const [pageTab, setPageTab] = useState<'MONITOR' | 'VARIANTS'>('MONITOR')
  // System tab: which shadow_system every section in the Trade Monitor tab is
  // scoped to. Defaults to ANALYST_MIRROR since that's the pre-existing single
  // shadow system this whole panel was built around.
  const [system, setSystem] = useState<ShadowSystem>('ANALYST_MIRROR')

  const [sessionFilter, setSessionFilter] = useState('ALL')
  const [assetFilter, setAssetFilter] = useState('ALL')
  const [outcomeFilter, setOutcomeFilter] = useState('ALL')
  const [dateRangeDays, setDateRangeDays] = useState(1)
  const [comparisonWindow, setComparisonWindow] = useState(30)

  // Rows generated before migrations/061_strategy_learning.sql have shadow_system
  // = null in the database (the column default only applies to new inserts, not
  // backfilled onto existing rows) -- treated as ANALYST_MIRROR here since every
  // shadow trade before that migration WAS the analyst-mirror system, just not
  // yet labelled as one.
  const systemFilteredOutcomes = useMemo(() =>
    shadowOutcomes.filter(o => (o.shadow_trade?.shadow_system ?? 'ANALYST_MIRROR') === system),
    [shadowOutcomes, system])

  // Canonical outcomes for the currently-selected system tab: MID only, within
  // whichever shadow_system is active. Used by the aggregate stats sections (period
  // comparison, Since Platform Launch, By Market) so those totals respond to the
  // system tab instead of always reading ANALYST_MIRROR. The canonicalShadowOutcomes
  // prop (ANALYST_MIRROR + MID, fixed) remains separately available and is used
  // only by AnalystShadowBreakdown's like-for-like analyst-vs-shadow comparison.
  const systemCanonicalOutcomes = useMemo(() =>
    shadowOutcomes.filter(o =>
      (o.shadow_trade?.shadow_system ?? 'ANALYST_MIRROR') === system
      && (o.shadow_trade?.entry_variant ?? 'MID') === 'MID'
    ),
    [shadowOutcomes, system])

  // Simple aggregate comparison: all shadow trade outcomes vs all analyst actual
  // trades for the period, grouped by date only -- not restricted to markets
  // triggered by both. A prior version keyed both sides by `marketId::date`, which
  // zeroed out analyst R for any day the analyst didn't trade the exact same market
  // as a given shadow setup, and could double-count analyst R when multiple shadow
  // outcomes existed for the same market/date.
  //
  // Scoped to systemCanonicalOutcomes (MID only, within the selected system
  // tab) -- these totals respond to the system tab rather than summing across all
  // 3 entry variants (which is what systemFilteredOutcomes -- the trade table's
  // own scope -- would do). See Variant Performance for the per-variant breakdown.
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
    for (const outcome of systemCanonicalOutcomes) {
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
  }, [systemCanonicalOutcomes, actualTrades, comparisonWindow])

  const totalShadowR = dailyComparison.length > 0 ? dailyComparison[dailyComparison.length - 1]!.cumulativeShadowR : 0
  const totalAnalystR = dailyComparison.length > 0 ? dailyComparison[dailyComparison.length - 1]!.cumulativeAnalystR : 0
  const deltaR = totalShadowR - totalAnalystR

  const byMarket = new Map<string, { symbol: string; assetClass: string; total: number; triggered: number; wins: number; totalR: number; avgRr: number; rrCount: number }>()
  for (const o of systemCanonicalOutcomes) {
    const st = o.shadow_trade
    const symbol = st?.opportunity?.market?.symbol
    const assetClass = st?.opportunity?.market?.asset_class ?? ''
    if (!symbol) continue
    const existing = byMarket.get(symbol) ?? { symbol, assetClass, total: 0, triggered: 0, wins: 0, totalR: 0, avgRr: 0, rrCount: 0 }
    const isTriggered = TRIGGERED_OR_BEYOND.includes(o.trade_outcome_status)
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
    if (dateRangeDays === 0) return systemFilteredOutcomes
    const cutoff = new Date(Date.now() - dateRangeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    return systemFilteredOutcomes.filter(o => (o.shadow_trade as any)?.opportunity?.date >= cutoff)
  }, [systemFilteredOutcomes, dateRangeDays])

  const filtered = dateFilteredOutcomes.filter(o => {
    const st = o.shadow_trade as any
    if (sessionFilter !== 'ALL' && st?.session !== sessionFilter) return false
    if (assetFilter !== 'ALL' && st?.opportunity?.market?.asset_class !== assetFilter) return false
    if (outcomeFilter !== 'ALL' && o.trade_outcome_status !== outcomeFilter) return false
    return true
  })

  // Fix 3: one row per market+date+direction (== one opportunity, within the
  // already-selected system tab), three variant columns instead of three
  // separate rows. Click-to-expand pattern -- this file had no expand/collapse
  // state before; matches the Fragment-wrapped expand-row convention already used
  // elsewhere in the app (e.g. TradeHistoryTable.tsx), not a pre-existing pattern
  // in this specific file.
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null)

  const tradeGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string; symbol: string; assetClass: string; precision: number | null
      direction: string; date: string; session: string | null
      variants: Record<EntryVariant, ShadowOutcome | null>
    }>()
    for (const outcome of filtered) {
      const st = outcome.shadow_trade
      const opp = st?.opportunity
      const marketId = opp?.market?.market_id
      const symbol = opp?.market?.symbol
      const date = opp?.date
      const direction = st?.direction
      const variant = st?.entry_variant
      if (!marketId || !symbol || !date || !direction || !variant) continue
      const key = `${marketId}::${date}::${direction}`
      const existing = groups.get(key) ?? {
        key, symbol, assetClass: opp?.market?.asset_class ?? '',
        precision: opp?.market?.display_precision ?? null,
        direction, date, session: st?.session ?? null,
        variants: { CONSERVATIVE: null, MID: null, AGGRESSIVE: null },
      }
      existing.variants[variant] = outcome
      groups.set(key, existing)
    }
    return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [filtered])

  // Fix 5: Variant Performance -- one row per (entry_variant x shadow_system)
  // combination, computed from the full shadowOutcomes prop (both systems, not
  // scoped to the system tab above -- this view deliberately compares across
  // systems). Asset-class and direction filters. A regime filter was asked for
  // separately, but no regime field is fetched anywhere for shadow trades (not
  // in the current query, not added by the entry_variant/shadow_system/mfe_r/
  // mae_r additions) and this section is explicitly "no additional query
  // needed" -- there's no regime data available to filter by without one, so
  // that dropdown isn't implemented.
  const [vpAssetFilter, setVpAssetFilter] = useState('ALL')
  const [vpDirectionFilter, setVpDirectionFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL')

  const variantPerformanceRows = useMemo(() => {
    type Agg = {
      variant: EntryVariant; system: ShadowSystem
      total: number; triggered: number; closed: number; wins: number
      totalR: number; totalMfe: number; mfeCount: number; totalMae: number; maeCount: number
    }
    const byKey = new Map<string, Agg>()
    for (const o of shadowOutcomes) {
      const st = o.shadow_trade
      if (vpAssetFilter !== 'ALL' && st?.opportunity?.market?.asset_class !== vpAssetFilter) continue
      if (vpDirectionFilter !== 'ALL' && st?.direction !== vpDirectionFilter) continue
      const variant = st?.entry_variant
      const system = st?.shadow_system ?? 'ANALYST_MIRROR'
      if (!variant) continue
      const key = `${variant}::${system}`
      const existing = byKey.get(key) ?? {
        variant, system, total: 0, triggered: 0, closed: 0, wins: 0,
        totalR: 0, totalMfe: 0, mfeCount: 0, totalMae: 0, maeCount: 0,
      }
      existing.total++
      if (TRIGGERED_OR_BEYOND.includes(o.trade_outcome_status)) existing.triggered++
      const r = shadowResultR(o)
      if (r !== null) {
        existing.closed++
        existing.totalR += r
        if (r > 0) existing.wins++
      }
      const mfe = effectiveMfe(o)
      const mae = effectiveMae(o)
      if (mfe !== null) { existing.totalMfe += mfe; existing.mfeCount++ }
      if (mae !== null) { existing.totalMae += mae; existing.maeCount++ }
      byKey.set(key, existing)
    }
    return [...byKey.values()]
      // Only rows with at least 10 closed trades -- too thin a sample otherwise.
      .filter(a => a.closed >= 10)
      .map(a => ({
        variant: a.variant, system: a.system, trades: a.closed,
        triggeredPct: a.total > 0 ? a.triggered / a.total : null,
        winRate: a.closed > 0 ? a.wins / a.closed : null,
        avgR: a.closed > 0 ? a.totalR / a.closed : null,
        avgMfe: a.mfeCount > 0 ? a.totalMfe / a.mfeCount : null,
        avgMae: a.maeCount > 0 ? a.totalMae / a.maeCount : null,
      }))
      .sort((x, y) => (y.avgR ?? -Infinity) - (x.avgR ?? -Infinity))
  }, [shadowOutcomes, vpAssetFilter, vpDirectionFilter])

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3">
        <p className="text-xs text-amber-800 font-medium">
          Shadow benchmark data is restricted to management. Analysts do not have visibility of these metrics.
          Shadow trades execute at the midpoint of the suggested entry range using median ATR-normalised stop/target distances.
        </p>
      </div>

      {/* Fix 5: outer tab -- Trade Monitor (everything below, scoped by the system
          tab underneath) vs Variant Performance (spans both systems). Styled to
          match ManagementTabs.tsx's border-b-2/-mb-px underline pattern -- the only
          existing tab component in the management dashboard. */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setPageTab('MONITOR')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            pageTab === 'MONITOR'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Trade Monitor
        </button>
        <button
          onClick={() => setPageTab('VARIANTS')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            pageTab === 'VARIANTS'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Variant Performance
        </button>
      </div>

      {pageTab === 'VARIANTS' ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Variant Performance ({variantPerformanceRows.length})</h2>
            <div className="flex items-center gap-2">
              <select value={vpDirectionFilter} onChange={e => setVpDirectionFilter(e.target.value as 'ALL' | 'BUY' | 'SELL')}
                className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
                <option value="ALL">Both directions</option>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
              <select value={vpAssetFilter} onChange={e => setVpAssetFilter(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
                <option value="ALL">All classes</option>
                <option value="FX">FX</option>
                <option value="INDEX">Index</option>
                <option value="COMMODITY">Commodity</option>
                <option value="CRYPTO">Crypto</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            One row per entry variant &times; shadow system, across both systems and every closed trade regardless
            of asset class or direction unless filtered above. Rows with fewer than 10 closed trades are hidden as
            too thin a sample. No regime filter -- no regime field is fetched for shadow trades, and this view is
            computed entirely from data already on the page.
          </p>
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {['Variant', 'System', 'Triggered %', 'Win Rate', 'Avg R', 'Avg MFE', 'Avg MAE', 'Trades'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {variantPerformanceRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-xs text-muted-foreground">
                      No variant/system combination has 10+ closed trades yet
                      {vpAssetFilter !== 'ALL' || vpDirectionFilter !== 'ALL' ? ' for this filter' : ''}.
                    </td>
                  </tr>
                ) : variantPerformanceRows.map(row => (
                  <tr key={`${row.variant}::${row.system}`} className="hover:bg-muted/30">
                    <td className="px-3 py-2 text-xs font-medium whitespace-nowrap">{VARIANT_LABELS[row.variant]}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{SYSTEM_LABELS[row.system]}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {row.triggeredPct !== null ? `${Math.round(row.triggeredPct * 100)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {row.winRate !== null ? `${Math.round(row.winRate * 100)}%` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-xs tabular-nums font-medium ${
                      row.avgR !== null ? (row.avgR >= 0 ? 'text-green-700' : 'text-red-700') : ''
                    }`}>
                      {row.avgR !== null ? `${row.avgR > 0 ? '+' : ''}${row.avgR.toFixed(2)}R` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-green-700">
                      {row.avgMfe !== null ? `+${row.avgMfe.toFixed(2)}R` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-red-600">
                      {row.avgMae !== null ? row.avgMae.toFixed(2) + 'R' : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{row.trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
      <>
      {/* System tab -- scopes the grouped trade table further down
          (systemFilteredOutcomes) AND the aggregate stats sections below
          (Period comparison, Since Platform Launch, By Market), which read
          from systemCanonicalOutcomes (MID within the selected system). */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => { setSystem('ANALYST_MIRROR'); setExpandedGroupKey(null) }}
          className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
            system === 'ANALYST_MIRROR'
              ? 'bg-foreground text-background border-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}>
          Analyst Mirror
        </button>
        <button
          onClick={() => { setSystem('OPTIMAL'); setExpandedGroupKey(null) }}
          className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
            system === 'OPTIMAL'
              ? 'bg-foreground text-background border-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}>
          Optimal Signal
        </button>
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

      <ShadowSinceLaunchStats
        shadowOutcomes={systemCanonicalOutcomes}
        actualTrades={actualTrades}
        actualPublications={actualPublications}
      />

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
                {['Date', 'Market', 'Session', 'Dir', 'Conservative', 'Mid', 'Aggressive', ''].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tradeGroups.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    No shadow outcomes for the selected period.
                  </td>
                </tr>
              ) : tradeGroups.map(group => {
                const isExpanded = expandedGroupKey === group.key
                const hasAnyTrade = ENTRY_VARIANTS.some(v => group.variants[v] !== null)
                const currentPrice = livePrices[group.symbol] ?? null

                return (
                  <Fragment key={group.key}>
                    <tr
                      onClick={() => hasAnyTrade && setExpandedGroupKey(isExpanded ? null : group.key)}
                      className={`transition-colors ${hasAnyTrade ? 'cursor-pointer hover:bg-muted/30' : 'hover:bg-muted/30'}`}
                    >
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{group.date}</td>
                      <td className="px-3 py-2 font-medium text-xs whitespace-nowrap">{group.symbol}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{group.session ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          group.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>{group.direction}</span>
                      </td>
                      <VariantCell outcome={group.variants.CONSERVATIVE} />
                      <VariantCell outcome={group.variants.MID} />
                      <VariantCell outcome={group.variants.AGGRESSIVE} />
                      <td className="px-3 py-2 text-xs text-muted-foreground/60">
                        {hasAnyTrade ? (isExpanded ? '▲' : '▼') : ''}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="px-4 py-3 bg-muted/20 border-t border-border">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {ENTRY_VARIANTS.map(variant => {
                              const outcome = group.variants[variant]
                              const st = outcome?.shadow_trade
                              const isOpenTriggered = outcome?.trade_outcome_status === 'TRIGGERED'
                              return (
                                <div key={variant} className="space-y-1">
                                  <p className="text-xs font-medium">{VARIANT_LABELS[variant]}</p>
                                  {!outcome || !st ? (
                                    <p className="text-xs text-muted-foreground">No trade</p>
                                  ) : (
                                    <>
                                      <p className="text-xs tabular-nums text-muted-foreground">
                                        Entry {fmtPrice(Number(st.entry), group.precision)}
                                        {' · '}<span className="text-red-700">Stop {fmtPrice(Number(st.stop), group.precision)}</span>
                                        {' · '}<span className="text-green-700">Target {fmtPrice(Number(st.target), group.precision)}</span>
                                        {' · '}{Number(st.rr).toFixed(1)}:1
                                      </p>
                                      {/* MFE/MAE, per variant, only when the trade has triggered -- final
                                          value once closed, running value (raw_price_evidence) while still
                                          open, via effectiveMfe/effectiveMae. */}
                                      {(() => {
                                        const mfe = effectiveMfe(outcome)
                                        const mae = effectiveMae(outcome)
                                        if (mfe === null || mae === null) return null
                                        return (
                                          <div className="text-xs text-muted-foreground mt-1">
                                            <span className="text-red-600">MAE {mae.toFixed(2)}R</span>
                                            <span className="mx-2">&middot;</span>
                                            <span className="text-green-600">MFE +{mfe.toFixed(2)}R</span>
                                            {isOpenTriggered && (
                                              <span className="ml-1.5 text-muted-foreground/70">(live)</span>
                                            )}
                                          </div>
                                        )
                                      })()}
                                      {isOpenTriggered && (
                                        <p className="text-xs mt-1">
                                          <UnrealisedR
                                            entry={Number(st.entry)}
                                            stop={Number(st.stop)}
                                            target={Number(st.target)}
                                            direction={group.direction as 'BUY' | 'SELL'}
                                            currentPrice={currentPrice}
                                          />
                                        </p>
                                      )}
                                    </>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
      </>
      )}
    </div>
  )
}
