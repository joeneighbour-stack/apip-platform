// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Recompute historical shadow trade outcomes
// ============================================================================
// Re-monitors every historical shadow trade from max(generated_at,
// monitor_from) using Azure 5-minute bars and the fixed monitor logic (see
// entryScanFrom() in monitorShadowTrades.ts -- a trade may never trigger on a
// bar before its own generated_at). replayShadowTrade() below applies exactly
// the same entry / stop / target / ambiguous / expiry rules as
// monitorShadowTrades.ts, as a pure function over the full bar history.
//
// Excluded (reported, never changed):
//   - markets without reliable Azure data (EXCLUDED_MARKETS)
//   - CANCELLED / CANCELLED_BEFORE_TRIGGER outcomes (deliberate cancellations,
//     e.g. migrations/064_cancel_premature_triggers.sql)
//   - trades whose window (scan start to expiry) touches a weekday with
//     incomplete Azure 5-min data (see incompleteWeekdays())
//   - trades whose scan window hasn't started yet
//
// Run:
//   npx tsx src/scripts/recomputeShadowOutcomes.ts --dry-run --out=changes.json
//   npx tsx src/scripts/recomputeShadowOutcomes.ts --apply
//     Writes one shadow_outcome_recomputes row (migrations/072) per changed
//     outcome, then updates shadow_trade_outcomes. Requires migration 072.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRICES_TABLE_CONN
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getCandles } from '../lib/azurePrices.js'

const EXCLUDED_MARKETS = new Set(['USDTRY', 'Solana', 'Litecoin'])
const CANCELLED_STATUSES = new Set(['CANCELLED', 'CANCELLED_BEFORE_TRIGGER'])
const R_TOLERANCE = 1e-9
// A weekday with fewer 5-min bars than this share of the symbol's median
// weekday count is treated as an Azure data gap (e.g. 2026-07-15..08-03 and
// 2026-08-17..09-03 have no non-crypto 5-min bars at all).
const MIN_DAY_COVERAGE = 0.8

// ── Types ───────────────────────────────────────────────────────────────────

export interface Bar { ts: number; o: number; h: number; l: number; c: number }

export interface ReplayTrade {
  direction: 'BUY' | 'SELL'
  entry: number
  stop: number
  target: number
  entry_mode: 'ENTER_NOW' | 'WAIT_FOR_PREFERRED_ZONE'
  generated_price: number | null
  generated_at: string
  monitor_from: string | null
  expires_at: string
}

export interface ReplayOutcome {
  status: string
  triggered_at: string | null
  triggered_price: number | null
  trigger_source: string | null
  closed_at: string | null
  exit_price: number | null
  exit_reason: string | null
  result_r: number | null
  exit_bar_ts: number | null
}

// ── Monitor rules (mirrors monitorShadowTrades.ts) ──────────────────────────

function entryScanFrom(trade: { generated_at: string; monitor_from: string | null }): number {
  const generatedAt = Date.parse(trade.generated_at)
  if (!trade.monitor_from) return generatedAt
  return Math.max(generatedAt, Date.parse(trade.monitor_from))
}

function calcResultR(direction: 'BUY' | 'SELL', entry: number, exitPrice: number, stop: number): number {
  const risk = Math.abs(entry - stop)
  if (risk === 0) return 0
  return direction === 'BUY' ? (exitPrice - entry) / risk : (entry - exitPrice) / risk
}

/** Index of the first bar with ts*1000 >= ms (bars sorted ascending). */
function firstBarAtOrAfter(bars: Bar[], ms: number): number {
  let lo = 0, hi = bars.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid]!.ts * 1000 < ms) lo = mid + 1; else hi = mid
  }
  return lo
}

/**
 * Replays one shadow trade over `bars` as of `nowMs`, using the same rules
 * as monitorShadowTrades.ts (with the max(generated_at, monitor_from) gate).
 */
export function replayShadowTrade(trade: ReplayTrade, bars: Bar[], nowMs: number): ReplayOutcome {
  const expiresMs = Date.parse(trade.expires_at)
  const dir = trade.direction
  const entry = Number(trade.entry), stop = Number(trade.stop), target = Number(trade.target)
  const base: ReplayOutcome = {
    status: 'NOT_TRIGGERED', triggered_at: null, triggered_price: null, trigger_source: null,
    closed_at: null, exit_price: null, exit_reason: null, result_r: null, exit_bar_ts: null,
  }

  // ── Entry ──
  let triggeredMs: number
  let triggered: Pick<ReplayOutcome, 'triggered_at' | 'triggered_price' | 'trigger_source'>
  if (trade.entry_mode === 'ENTER_NOW') {
    if (nowMs >= expiresMs && Date.parse(trade.generated_at) >= expiresMs) {
      return { ...base, status: 'EXPIRY', exit_reason: 'EXPIRED_NOT_TRIGGERED', closed_at: new Date(expiresMs).toISOString() }
    }
    triggeredMs = Date.parse(trade.generated_at)
    triggered = {
      triggered_at: new Date(triggeredMs).toISOString(),
      triggered_price: trade.generated_price ?? entry,
      trigger_source: 'ENTER_NOW_AT_GENERATION',
    }
  } else {
    let hit: typeof triggered | null = null
    triggeredMs = NaN
    for (let i = firstBarAtOrAfter(bars, entryScanFrom(trade)); i < bars.length; i++) {
      const bar = bars[i]!
      if (bar.ts * 1000 >= expiresMs || bar.ts * 1000 > nowMs) break
      let price: number | null = null, source: string | null = null
      if (dir === 'BUY') {
        if (bar.o < entry) { price = bar.o; source = 'GAP_FILL_BAR_OPEN' }
        else if (bar.l <= entry) { price = entry; source = 'FIVE_MIN_BAR_TOUCH' }
      } else {
        if (bar.o > entry) { price = bar.o; source = 'GAP_FILL_BAR_OPEN' }
        else if (bar.h >= entry) { price = entry; source = 'FIVE_MIN_BAR_TOUCH' }
      }
      if (price !== null) {
        triggeredMs = bar.ts * 1000
        hit = { triggered_at: new Date(triggeredMs).toISOString(), triggered_price: price, trigger_source: source }
        break
      }
    }
    if (!hit) {
      return nowMs >= expiresMs
        ? { ...base, status: 'EXPIRY', exit_reason: 'EXPIRED_NOT_TRIGGERED', closed_at: new Date(expiresMs).toISOString() }
        : base
    }
    triggered = hit
  }

  // ── Post-trigger ──
  const lastBarBeforeExpiry = (): Bar | undefined => {
    const idx = firstBarAtOrAfter(bars, expiresMs) - 1
    return idx >= 0 ? bars[idx] : undefined
  }
  const expire = (): ReplayOutcome => {
    const lastBar = lastBarBeforeExpiry()
    const closed_at = new Date(expiresMs).toISOString()
    if (!lastBar) return { ...base, ...triggered, status: 'EXPIRY', closed_at, exit_reason: 'EXPIRY_PRICE_UNAVAILABLE' }
    const r = calcResultR(dir, entry, lastBar.c, stop)
    return {
      ...base, ...triggered, status: r >= 0 ? 'CLOSED_PROFIT' : 'CLOSED_LOSS', closed_at,
      exit_price: lastBar.c, exit_reason: 'EXPIRY_WITH_PRICE', result_r: r, exit_bar_ts: lastBar.ts,
    }
  }

  for (let i = firstBarAtOrAfter(bars, triggeredMs); i < bars.length; i++) {
    const bar = bars[i]!
    const barMs = bar.ts * 1000
    if (barMs > nowMs) break
    if (barMs >= expiresMs) return expire()

    const stopHit   = dir === 'BUY' ? bar.l <= stop   : bar.h >= stop
    const targetHit = dir === 'BUY' ? bar.h >= target : bar.l <= target
    const closed_at = new Date(barMs).toISOString()
    if (stopHit && targetHit) {
      return { ...base, ...triggered, status: 'AMBIGUOUS', closed_at, exit_reason: 'AMBIGUOUS_SAME_BAR', exit_bar_ts: bar.ts }
    }
    if (targetHit) {
      return { ...base, ...triggered, status: 'TARGET_HIT', closed_at, exit_price: target,
        exit_reason: 'TARGET_CROSSED', result_r: calcResultR(dir, entry, target, stop), exit_bar_ts: bar.ts }
    }
    if (stopHit) {
      return { ...base, ...triggered, status: 'STOP_HIT', closed_at, exit_price: stop,
        exit_reason: 'STOP_CROSSED', result_r: -1.0, exit_bar_ts: bar.ts }
    }
  }
  // No bar at/after expiry -- the monitor force-expires once now >= expires_at.
  if (nowMs >= expiresMs) return expire()
  return { ...base, ...triggered, status: 'TRIGGERED' }
}

// ── Comparison ──────────────────────────────────────────────────────────────

function sameTime(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return Date.parse(a) === Date.parse(b)
}

function sameR(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) <= R_TOLERANCE
}

/** Which audited fields differ between the stored and recomputed outcome. */
export function changedFields(
  old: { status: string; result_r: number | null; triggered_at: string | null; closed_at: string | null },
  next: ReplayOutcome,
): string[] {
  const fields: string[] = []
  if (old.status !== next.status) fields.push('status')
  if (!sameR(old.result_r, next.result_r)) fields.push('result_r')
  if (!sameTime(old.triggered_at, next.triggered_at)) fields.push('triggered_at')
  if (!sameTime(old.closed_at, next.closed_at)) fields.push('closed_at')
  return fields
}

// ── Azure coverage ──────────────────────────────────────────────────────────

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Weekdays (UTC) in [fromMs, toMs] on which `bars` has less than
 * MIN_DAY_COVERAGE of the symbol's median weekday bar count -- days the
 * recompute can't be trusted on. Weekends are never counted as gaps.
 */
export function incompleteWeekdays(bars: Bar[], fromMs: number, toMs: number): Set<string> {
  const perDay = new Map<string, number>()
  for (const b of bars) {
    const d = isoDate(b.ts * 1000)
    perDay.set(d, (perDay.get(d) ?? 0) + 1)
  }
  const weekdayCounts = [...perDay].filter(([d]) => ![0, 6].includes(new Date(d).getUTCDay())).map(([, n]) => n).sort((a, b) => a - b)
  const median = weekdayCounts[Math.floor(weekdayCounts.length / 2)] ?? 0
  const gaps = new Set<string>()
  for (let ms = Date.parse(isoDate(fromMs)); ms <= toMs; ms += 24 * 60 * 60 * 1000) {
    const d = isoDate(ms)
    if ([0, 6].includes(new Date(d).getUTCDay())) continue
    if ((perDay.get(d) ?? 0) < median * MIN_DAY_COVERAGE) gaps.add(d)
  }
  return gaps
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function loadAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if ((data ?? []).length < 1000) return rows
  }
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const missing = Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRICES_TABLE_CONN: process.env.PRICES_TABLE_CONN })
    .filter(([, v]) => !v).map(([k]) => k)
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}`)
    process.exit(1)
  }

  const isApply = process.argv.includes('--apply')
  const outPath = process.argv.find(a => a.startsWith('--out='))?.split('=')[1]
  const db: SupabaseClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const nowMs = Date.now()
  const batchId = randomUUID()

  console.log(`Mode: ${isApply ? 'APPLY' : 'DRY RUN'}  batch=${batchId}`)

  const trades = await loadAll<any>((from, to) => db.from('shadow_trades')
    .select(`
      shadow_trade_id, opportunity_id, shadow_system, entry_variant, direction, entry, stop, target,
      entry_mode, generated_price, generated_at, monitor_from, expires_at,
      opportunities!inner ( markets!inner ( symbol, price_data_symbol ) ),
      shadow_trade_outcomes ( shadow_outcome_id, trade_outcome_status, result_r, triggered_at, closed_at,
        triggered_price, trigger_source, exit_price, exit_reason, exit_bar_timestamp, raw_price_evidence )
    `)
    .order('shadow_trade_id')
    .range(from, to))
  console.log(`Shadow trades loaded: ${trades.length}`)

  const excluded: { shadow_trade_id: string; symbol: string; reason: string }[] = []
  const candidates: any[] = []
  for (const t of trades) {
    const symbol = t.opportunities.markets.symbol as string
    const outcome = t.shadow_trade_outcomes?.[0]
    if (!outcome) { excluded.push({ shadow_trade_id: t.shadow_trade_id, symbol, reason: 'no outcome row' }); continue }
    if (EXCLUDED_MARKETS.has(symbol)) { excluded.push({ shadow_trade_id: t.shadow_trade_id, symbol, reason: 'market without reliable Azure data' }); continue }
    if (CANCELLED_STATUSES.has(outcome.trade_outcome_status)) { excluded.push({ shadow_trade_id: t.shadow_trade_id, symbol, reason: `cancelled (${outcome.trade_outcome_status})` }); continue }
    candidates.push(t)
  }

  // One bar fetch per symbol, spanning every candidate's scan window.
  const bySymbol = new Map<string, any[]>()
  for (const t of candidates) {
    const sym = t.opportunities.markets.price_data_symbol as string
    bySymbol.set(sym, [...(bySymbol.get(sym) ?? []), t])
  }

  const changes: any[] = []
  let unchanged = 0
  for (const [sym, symTrades] of bySymbol) {
    const fromTs = Math.floor(Math.min(...symTrades.map(t => entryScanFrom(t))) / 1000) - 300
    const toTs = Math.floor(Math.min(nowMs, Math.max(...symTrades.map(t => Date.parse(t.expires_at)))) / 1000) + 300
    const candles = await getCandles(sym, '5', fromTs, toTs)
    const bars: Bar[] = candles.s === 'ok'
      ? candles.t.map((ts, i) => ({ ts, o: candles.o[i]!, h: candles.h[i]!, l: candles.l[i]!, c: candles.c[i]! }))
      : []

    // Today is still in progress -- never count it as a gap.
    const gapDays = incompleteWeekdays(bars, fromTs * 1000, nowMs - 24 * 60 * 60 * 1000)

    for (const t of symTrades) {
      const symbol = t.opportunities.markets.symbol as string
      const scanFrom = entryScanFrom(t)
      if (scanFrom > nowMs) {
        excluded.push({ shadow_trade_id: t.shadow_trade_id, symbol, reason: 'scan window not started yet' }); continue
      }
      // The trade's whole possible life: from its scan start (or the ENTER_NOW
      // trigger) to expiry. Any incomplete Azure day inside it makes the replay
      // untrustworthy, so the trade is excluded rather than recomputed.
      const windowEnd = Math.min(nowMs, Date.parse(t.expires_at))
      const touchedGaps: string[] = []
      for (let ms = Date.parse(isoDate(scanFrom)); ms <= windowEnd; ms += 24 * 60 * 60 * 1000) {
        if (gapDays.has(isoDate(ms))) touchedGaps.push(isoDate(ms))
      }
      if (touchedGaps.length > 0) {
        excluded.push({ shadow_trade_id: t.shadow_trade_id, symbol, reason: `window touches incomplete Azure 5-min day(s): ${touchedGaps.join(',')}` }); continue
      }

      const o = t.shadow_trade_outcomes[0]
      const old = {
        status: o.trade_outcome_status as string,
        result_r: o.result_r != null ? Number(o.result_r) : null,
        triggered_at: o.triggered_at as string | null,
        closed_at: o.closed_at as string | null,
      }
      const next = replayShadowTrade(t, bars, nowMs)
      const fields = changedFields(old, next)
      if (fields.length === 0) { unchanged++; continue }

      const preGeneration = old.triggered_at !== null && Date.parse(old.triggered_at) < Date.parse(t.generated_at)
      changes.push({
        shadow_trade_id: t.shadow_trade_id,
        shadow_outcome_id: o.shadow_outcome_id,
        symbol, price_data_symbol: sym,
        shadow_system: t.shadow_system ?? 'ANALYST_MIRROR', entry_variant: t.entry_variant,
        entry_mode: t.entry_mode, generated_at: t.generated_at, monitor_from: t.monitor_from, expires_at: t.expires_at,
        fields,
        reason: preGeneration ? 'triggered_before_generated_at' : 'recompute_other',
        old: { ...old, triggered_price: o.triggered_price, trigger_source: o.trigger_source, exit_price: o.exit_price,
          exit_reason: o.exit_reason, exit_bar_timestamp: o.exit_bar_timestamp, raw_price_evidence: o.raw_price_evidence },
        new: next,
      })
    }
    await new Promise(r => setTimeout(r, 200))
  }

  // ── Report ──
  const pre = changes.filter(c => c.reason === 'triggered_before_generated_at')
  const other = changes.filter(c => c.reason !== 'triggered_before_generated_at')
  const excludedByReason = new Map<string, number>()
  for (const e of excluded) {
    const key = EXCLUDED_MARKETS.has(e.symbol) ? `${e.reason} [${e.symbol}]`
      : e.reason.startsWith('window touches') ? 'window touches incomplete Azure 5-min day(s)' : e.reason
    excludedByReason.set(key, (excludedByReason.get(key) ?? 0) + 1)
  }

  console.log('\n=== RECOMPUTE SUMMARY ===')
  console.log(`Recomputed: ${unchanged + changes.length}`)
  console.log(`Unchanged:  ${unchanged}`)
  console.log(`Changed:    ${changes.length}  (pre-generation triggers: ${pre.length}, other: ${other.length})`)
  console.log(`Excluded:   ${excluded.length}`)
  for (const [reason, n] of excludedByReason) console.log(`  ${reason}: ${n}`)

  if (outPath) {
    await writeFile(outPath, JSON.stringify({ batchId, nowMs, changes, excluded }, null, 1))
    console.log(`\nChanges written to ${outPath}`)
  }

  if (!isApply) { console.log('\nDRY RUN -- nothing written.'); return }

  for (const c of changes) {
    const { error: auditErr } = await db.from('shadow_outcome_recomputes').insert({
      recompute_batch_id: batchId,
      shadow_trade_id: c.shadow_trade_id,
      shadow_outcome_id: c.shadow_outcome_id,
      old_status: c.old.status, old_result_r: c.old.result_r, old_triggered_at: c.old.triggered_at, old_closed_at: c.old.closed_at,
      new_status: c.new.status, new_result_r: c.new.result_r, new_triggered_at: c.new.triggered_at, new_closed_at: c.new.closed_at,
      reason: c.reason,
    })
    if (auditErr) throw new Error(`audit insert failed for ${c.shadow_trade_id}: ${auditErr.message}`)
    const { error: updErr } = await db.from('shadow_trade_outcomes').update({
      trade_outcome_status: c.new.status,
      triggered_at: c.new.triggered_at,
      triggered_price: c.new.triggered_price,
      trigger_source: c.new.trigger_source,
      trigger_bar_timestamp: c.new.trigger_source && c.new.trigger_source !== 'ENTER_NOW_AT_GENERATION' ? c.new.triggered_at : null,
      closed_at: c.new.closed_at,
      exit_price: c.new.exit_price,
      exit_reason: c.new.exit_reason,
      exit_bar_timestamp: c.new.exit_bar_ts !== null ? new Date(c.new.exit_bar_ts * 1000).toISOString() : null,
      result_r: c.new.result_r,
      // MFE/MAE and bar counts are no longer valid for the new path -- cleared
      // rather than left describing the old one.
      mfe_r: null, mae_r: null, mfe_price: null, mae_price: null,
      bars_to_trigger: null, bars_to_close: null, raw_price_evidence: null,
    }).eq('shadow_outcome_id', c.shadow_outcome_id)
    if (updErr) throw new Error(`outcome update failed for ${c.shadow_trade_id}: ${updErr.message}`)
  }
  console.log(`\nApplied ${changes.length} changes (batch ${batchId}).`)
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
