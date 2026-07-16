// ============================================================================
// APIP Shadow Trade Lifecycle Monitor
// ============================================================================
// Runs every 5 minutes via GitHub Actions cron.
// Uses Finnhub 5-minute OANDA OHLC bars as canonical price source.
// Implements the full state machine defined in APIP Shadow Trade Lifecycle v1.0.
//
// State transitions:
//   NOT_TRIGGERED → TRIGGERED                  (entry touched/gapped)
//   NOT_TRIGGERED → EXPIRY                     (expired_not_triggered)
//   NOT_TRIGGERED → CANCELLED_BEFORE_TRIGGER   (superseded)
//   TRIGGERED     → TARGET_HIT                 (target crossed)
//   TRIGGERED     → STOP_HIT                   (stop crossed)
//   TRIGGERED     → AMBIGUOUS                  (stop+target same bar)
//   TRIGGERED     → EXPIRY                     (expired with open P&L)
//
// All transitions are atomic and idempotent.
// monitor_run_id logged on every write for deduplication.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FINNHUB_CANDLE_API_KEY   (5-min OANDA bars)
//   FINNHUB_API_KEY          (quote fallback for latest forming bar)
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// ── Types ───────────────────────────────────────────────────────────────────

interface FinnhubCandle {
  c: number[]; h: number[]; l: number[]; o: number[]; t: number[]; s: string
}

interface Bar {
  ts: number   // unix seconds
  o: number; h: number; l: number; c: number
}

type TradeOutcomeStatus =
  | 'NOT_TRIGGERED' | 'TRIGGERED' | 'TARGET_HIT' | 'STOP_HIT'
  | 'EXPIRY' | 'AMBIGUOUS' | 'CANCELLED_BEFORE_TRIGGER' | 'CANCELLED'

interface ShadowTrade {
  shadow_trade_id: string
  opportunity_id: string
  recommendation_version_id: string
  direction: 'BUY' | 'SELL'
  entry: number
  stop: number
  target: number
  rr: number
  session: string
  entry_mode: 'ENTER_NOW' | 'WAIT_FOR_PREFERRED_ZONE'
  generated_price: number | null
  expires_at: string
  price_provider: string
  price_resolution: string
  created_at: string
  generated_at: string
}

interface ShadowOutcome {
  shadow_outcome_id: string
  shadow_trade_id: string
  trade_outcome_status: TradeOutcomeStatus
  triggered_price: number | null
  triggered_at: string | null
}

// ── DST-aware expiry calculation ────────────────────────────────────────────

function computeExpiresAt(
  sessionType: string,
  assetClass: string | null,
  generatedAt: Date,
): Date {
  const isCrypto = assetClass === 'CRYPTO'
  const isApac = sessionType === 'APAC'

  // Base date: today or next day
  const base = new Date(generatedAt)
  if (isApac || isCrypto) base.setUTCDate(base.getUTCDate() + 1)

  // Target UK local time
  const targetHour = isCrypto ? 12 : isApac ? 16 : 21

  // Find the UTC equivalent of targetHour in Europe/London on base date
  // Binary search approach: find UTC hour where London local = targetHour
  const dateStr = base.toISOString().slice(0, 10)
  for (let utcH = 0; utcH < 24; utcH++) {
    const candidate = new Date(`${dateStr}T${String(utcH).padStart(2,'0')}:00:00Z`)
    const londonHour = parseInt(
      candidate.toLocaleString('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', hour12: false
      }), 10
    )
    if (londonHour === targetHour) return candidate
  }
  // Fallback: approximate
  const isDST = new Date(`${dateStr}T12:00:00Z`).toLocaleString('en-GB', {
    timeZone: 'Europe/London', timeZoneName: 'short'
  }).includes('BST')
  const utcOffset = isDST ? 1 : 0
  return new Date(`${dateStr}T${String(targetHour - utcOffset).padStart(2,'0')}:00:00Z`)
}

// ── Price fetching ───────────────────────────────────────────────────────────

async function fetch5MinBars(
  finnhubSymbol: string,
  fromTs: number,
  toTs: number,
  candleKey: string,
): Promise<Bar[]> {
  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=5&from=${fromTs}&to=${toTs}&token=${candleKey}`
  const res = await fetch(url)
  if (!res.ok) return []
  const body: FinnhubCandle = await res.json()
  if (body.s !== 'ok' || !body.t?.length) return []
  return body.t.map((ts, i) => ({
    ts, o: body.o[i]!, h: body.h[i]!, l: body.l[i]!, c: body.c[i]!
  })).sort((a, b) => a.ts - b.ts)
}

async function fetchCryptoBars(
  finnhubSymbol: string,
  fromTs: number,
  toTs: number,
  candleKey: string,
): Promise<Bar[]> {
  const url = `https://finnhub.io/api/v1/crypto/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=5&from=${fromTs}&to=${toTs}&token=${candleKey}`
  const res = await fetch(url)
  if (!res.ok) return []
  const body: FinnhubCandle = await res.json()
  if (body.s !== 'ok' || !body.t?.length) return []
  return body.t.map((ts, i) => ({
    ts, o: body.o[i]!, h: body.h[i]!, l: body.l[i]!, c: body.c[i]!
  })).sort((a, b) => a.ts - b.ts)
}

// ── Result R calculation ─────────────────────────────────────────────────────

function calcResultR(
  direction: 'BUY' | 'SELL',
  triggeredPrice: number,
  exitPrice: number,
  stop: number,
): number {
  const risk = Math.abs(triggeredPrice - stop)
  if (risk === 0) return 0
  if (direction === 'BUY') return (exitPrice - triggeredPrice) / risk
  return (triggeredPrice - exitPrice) / risk
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const SUPABASE_URL              = process.env.SUPABASE_URL!
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const CANDLE_KEY                = process.env.FINNHUB_CANDLE_API_KEY!
  const QUOTE_KEY                 = process.env.FINNHUB_API_KEY!

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !CANDLE_KEY) {
    console.error('Missing required env vars')
    process.exit(1)
  }

  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const monitorRunId = randomUUID()
  const now          = new Date()
  const nowTs        = Math.floor(now.getTime() / 1000)

  console.log(`\n=== Shadow Trade Monitor ===`)
  console.log(`Run ID: ${monitorRunId}`)
  console.log(`Time:   ${now.toISOString()}`)

  // ── Load active shadow trades (NOT_TRIGGERED and TRIGGERED) ────────────────
  const { data: trades, error: tradesErr } = await db
    .from('shadow_trades')
    .select(`
      shadow_trade_id, opportunity_id, recommendation_version_id,
      direction, entry, stop, target, rr, session,
      entry_mode, generated_price, expires_at,
      price_provider, price_resolution, created_at, generated_at,
      opportunities!inner (
        market_id,
        markets!inner ( symbol, price_data_symbol, asset_class, price_data_provider )
      ),
      shadow_trade_outcomes (
        shadow_outcome_id, trade_outcome_status,
        triggered_price, triggered_at
      )
    `)
    .in('shadow_trade_outcomes.trade_outcome_status', ['NOT_TRIGGERED', 'TRIGGERED'])

  if (tradesErr) {
    console.error('Failed to load trades:', tradesErr.message)
    process.exit(1)
  }

  const activeTrades = (trades ?? []).filter(t => {
    const outcome = t.shadow_trade_outcomes?.[0]
    return outcome && ['NOT_TRIGGERED', 'TRIGGERED'].includes(outcome.trade_outcome_status)
  })

  console.log(`Active trades: ${activeTrades.length}`)

  const summary = { triggered: 0, closed: 0, expired: 0, ambiguous: 0, skipped: 0, errors: 0 }

  for (const trade of activeTrades) {
      const market   = (trade.opportunities as any)?.markets
    const outcome  = trade.shadow_trade_outcomes?.[0] as ShadowOutcome | undefined
    if (!market || !outcome) { summary.skipped++; continue }

    const symbol      = market.symbol as string
    const finnhubSym  = market.price_data_symbol as string
    const assetClass  = market.asset_class as string
    const isCrypto    = assetClass === 'CRYPTO'
    const expiresAt   = new Date(trade.expires_at)
    const status      = outcome.trade_outcome_status

    // Skip if already in terminal state (idempotency)
    const terminalStates = ['TARGET_HIT','STOP_HIT','AMBIGUOUS','EXPIRY','CANCELLED_BEFORE_TRIGGER','CANCELLED']
    if (terminalStates.includes(status)) { summary.skipped++; continue }

    try {
      // Fetch 5-min bars since trade was created (or since triggered_at for TRIGGERED)
      const fromTs = status === 'TRIGGERED' && outcome.triggered_at
        ? Math.floor(new Date(outcome.triggered_at).getTime() / 1000) - 300
        : Math.floor(new Date(trade.created_at).getTime() / 1000) - 300

      const bars = isCrypto
        ? await fetchCryptoBars(finnhubSym, fromTs, nowTs, CANDLE_KEY)
        : await fetch5MinBars(finnhubSym, fromTs, nowTs, CANDLE_KEY)

      // ── Handle NOT_TRIGGERED ──────────────────────────────────────────────
      if (status === 'NOT_TRIGGERED') {

        // Check expiry first
        if (now >= expiresAt) {
          await db.from('shadow_trade_outcomes').update({
            trade_outcome_status: 'EXPIRY',
            exit_reason: 'EXPIRED_NOT_TRIGGERED',
            closed_at: expiresAt.toISOString(),
            result_r: null,
            monitor_run_id: monitorRunId,
          }).eq('shadow_outcome_id', outcome.shadow_outcome_id)
          console.log(`  ${symbol}: EXPIRED (not triggered)`)
          summary.expired++
          continue
        }

        // ENTER_NOW — trigger immediately if not already done
        if (trade.entry_mode === 'ENTER_NOW') {
          const triggeredPrice = trade.generated_price ?? trade.entry
          await db.from('shadow_trade_outcomes').update({
            trade_outcome_status: 'TRIGGERED',
            triggered_at: trade.generated_at,
            triggered_price: triggeredPrice,
            trigger_source: 'ENTER_NOW_AT_GENERATION',
            monitor_run_id: monitorRunId,
          }).eq('shadow_outcome_id', outcome.shadow_outcome_id)
          console.log(`  ${symbol}: TRIGGERED (ENTER_NOW) @ ${triggeredPrice}`)
          summary.triggered++
          continue
        }

        // WAIT_FOR_PREFERRED_ZONE — scan bars for entry touch
        let triggered = false
        for (const bar of bars) {
          const barTime = new Date(bar.ts * 1000)
          if (barTime >= expiresAt) break

          const dir = trade.direction as 'BUY' | 'SELL'
          const entry = Number(trade.entry)

          let triggeredPrice: number | null = null
          let triggerSource: string | null = null

          if (dir === 'BUY') {
            if (bar.o < entry) {
              // Gap through entry
              triggeredPrice = bar.o
              triggerSource = 'GAP_FILL_BAR_OPEN'
            } else if (bar.l <= entry) {
              triggeredPrice = entry
              triggerSource = 'FIVE_MIN_BAR_TOUCH'
            }
          } else {
            if (bar.o > entry) {
              triggeredPrice = bar.o
              triggerSource = 'GAP_FILL_BAR_OPEN'
            } else if (bar.h >= entry) {
              triggeredPrice = entry
              triggerSource = 'FIVE_MIN_BAR_TOUCH'
            }
          }

          if (triggeredPrice !== null) {
            await db.from('shadow_trade_outcomes').update({
              trade_outcome_status: 'TRIGGERED',
              triggered_at: new Date(bar.ts * 1000).toISOString(),
              triggered_price: triggeredPrice,
              trigger_source: triggerSource,
              trigger_bar_timestamp: new Date(bar.ts * 1000).toISOString(),
              raw_price_evidence: { bar },
              monitor_run_id: monitorRunId,
            }).eq('shadow_outcome_id', outcome.shadow_outcome_id)
            console.log(`  ${symbol}: TRIGGERED (${triggerSource}) @ ${triggeredPrice}`)
            summary.triggered++
            triggered = true
            break
          }
        }
        if (!triggered) console.log(`  ${symbol}: monitoring (not triggered)`)
        continue
      }

      // ── Handle TRIGGERED ──────────────────────────────────────────────────
      if (status === 'TRIGGERED') {
        const dir            = trade.direction as 'BUY' | 'SELL'
        const stop           = Number(trade.stop)
        const target         = Number(trade.target)
        const triggeredPrice = Number(outcome.triggered_price)
        const triggeredAt    = new Date(outcome.triggered_at!)

        let closed = false

        for (const bar of bars) {
          const barTime = new Date(bar.ts * 1000)
          if (barTime <= triggeredAt) continue // skip bars before trigger

          // Check expiry
          if (barTime >= expiresAt) {
            // Use last bar close before expiry
            const barsBeforeExpiry = bars.filter(b => new Date(b.ts * 1000) < expiresAt)
            const lastBar = barsBeforeExpiry[barsBeforeExpiry.length - 1]
            const exitPrice = lastBar?.c ?? null

            if (exitPrice === null) {
              await db.from('shadow_trade_outcomes').update({
                trade_outcome_status: 'EXPIRY',
                closed_at: expiresAt.toISOString(),
                exit_reason: 'EXPIRY_PRICE_UNAVAILABLE',
                result_r: null,
                monitor_run_id: monitorRunId,
              }).eq('shadow_outcome_id', outcome.shadow_outcome_id)
              console.log(`  ${symbol}: EXPIRY (price unavailable)`)
            } else {
              const resultR = calcResultR(dir, triggeredPrice, exitPrice, stop)
              await db.from('shadow_trade_outcomes').update({
                trade_outcome_status: 'EXPIRY',
                closed_at: expiresAt.toISOString(),
                exit_price: exitPrice,
                exit_reason: 'EXPIRY_WITH_PRICE',
                exit_bar_timestamp: lastBar ? new Date(lastBar.ts * 1000).toISOString() : null,
                result_r: resultR,
                raw_price_evidence: { last_bar: lastBar },
                monitor_run_id: monitorRunId,
              }).eq('shadow_outcome_id', outcome.shadow_outcome_id)
              console.log(`  ${symbol}: EXPIRY @ ${exitPrice}, R=${resultR.toFixed(2)}`)
            }
            summary.expired++
            closed = true
            break
          }

          // Check ambiguous (stop AND target in same bar)
          const stopHit   = dir === 'BUY' ? bar.l <= stop   : bar.h >= stop
          const targetHit = dir === 'BUY' ? bar.h >= target : bar.l <= target

          if (stopHit && targetHit) {
            await db.from('shadow_trade_outcomes').update({
              trade_outcome_status: 'AMBIGUOUS',
              closed_at: new Date(bar.ts * 1000).toISOString(),
              exit_reason: 'AMBIGUOUS_SAME_BAR',
              exit_bar_timestamp: new Date(bar.ts * 1000).toISOString(),
              result_r: null,
              raw_price_evidence: { bar },
              monitor_run_id: monitorRunId,
            }).eq('shadow_outcome_id', outcome.shadow_outcome_id)
            console.log(`  ${symbol}: AMBIGUOUS (stop+target same bar)`)
            summary.ambiguous++
            closed = true
            break
          }

          // Target hit
          if (targetHit) {
            const resultR = calcResultR(dir, triggeredPrice, target, stop)
            await db.from('shadow_trade_outcomes').update({
              trade_outcome_status: 'TARGET_HIT',
              closed_at: new Date(bar.ts * 1000).toISOString(),
              exit_price: target,
              exit_reason: 'TARGET_CROSSED',
              exit_bar_timestamp: new Date(bar.ts * 1000).toISOString(),
              result_r: resultR,
              raw_price_evidence: { bar },
              monitor_run_id: monitorRunId,
            }).eq('shadow_outcome_id', outcome.shadow_outcome_id)
            console.log(`  ${symbol}: TARGET_HIT, R=${resultR.toFixed(2)}`)
            summary.closed++
            closed = true
            break
          }

          // Stop hit
          if (stopHit) {
            const resultR = calcResultR(dir, triggeredPrice, stop, stop)
            await db.from('shadow_trade_outcomes').update({
              trade_outcome_status: 'STOP_HIT',
              closed_at: new Date(bar.ts * 1000).toISOString(),
              exit_price: stop,
              exit_reason: 'STOP_CROSSED',
              exit_bar_timestamp: new Date(bar.ts * 1000).toISOString(),
              result_r: -1.0,
              raw_price_evidence: { bar },
              monitor_run_id: monitorRunId,
            }).eq('shadow_outcome_id', outcome.shadow_outcome_id)
            console.log(`  ${symbol}: STOP_HIT, R=-1.00`)
            summary.closed++
            closed = true
            break
          }
        }

        if (!closed) console.log(`  ${symbol}: TRIGGERED, monitoring P&L`)
      }

    } catch (err) {
      console.error(`  ${symbol}: error — ${(err as Error).message}`)
      summary.errors++
    }

    await new Promise(r => setTimeout(r, 200)) // rate limit
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Triggered:  ${summary.triggered}`)
  console.log(`Closed:     ${summary.closed}`)
  console.log(`Expired:    ${summary.expired}`)
  console.log(`Ambiguous:  ${summary.ambiguous}`)
  console.log(`Skipped:    ${summary.skipped}`)
  console.log(`Errors:     ${summary.errors}`)
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
