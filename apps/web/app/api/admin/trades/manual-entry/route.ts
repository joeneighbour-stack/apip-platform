import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

const IMPORT_BATCH_ID = 'eaa5252a-946f-4404-b0ee-965192dde6ac' // existing MANUAL_BACKFILL batch, target_table=actual_trades

// Mirrors the formula given for the admin form exactly -- R = realised move / planned risk.
// Duplicated (not imported from lib/metrics.ts) because it operates on a hypothetical
// entry/stop/exit the user is still typing, not a MetricsTrade row.
function calcResultR(direction: 'BUY' | 'SELL', entry: number, stop: number, exit: number): number {
  const r = direction === 'BUY' ? (exit - entry) / (entry - stop) : (entry - exit) / (stop - entry)
  return Math.round(r * 1000) / 1000
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

// Never trust the client's live-calculated fields -- re-validate and re-derive result_r
// server-side from the raw inputs before this ever touches the database.
function validate(body: any): { error: string } | { ok: true; resultR: number } {
  const { analystId, marketId, direction, date, entry, stop, target, exit } = body
  if (!analystId || !marketId || !direction || !date || entry == null || stop == null || target == null || exit == null) {
    return { error: 'All fields are required.' }
  }
  if (direction !== 'BUY' && direction !== 'SELL') return { error: 'Direction must be BUY or SELL.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Invalid date.' }
  for (const [label, v] of [['Entry', entry], ['Stop', stop], ['Target', target], ['Exit', exit]] as const) {
    if (!isPositiveNumber(Number(v))) return { error: `${label} must be a positive number.` }
  }
  const e = Number(entry), s = Number(stop), t = Number(target), x = Number(exit)
  if (direction === 'BUY' && !(s < e && e < t)) return { error: 'For BUY, stop must be below entry and entry below target.' }
  if (direction === 'SELL' && !(t < e && e < s)) return { error: 'For SELL, target must be below entry and entry below stop.' }
  const resultR = calcResultR(direction, e, s, x)
  if (resultR < -1 || resultR > 15) return { error: `Result R (${resultR}) is outside the plausible range (-1 to +15) -- check the entered prices.` }
  return { ok: true, resultR }
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!['ADMIN', 'MANAGER'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const result = validate(body)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  const { resultR } = result

  const { analystId, marketId, direction, date, entry, stop, target, exit, confirmDuplicate } = body
  const adminDb = createAdminClient()

  // Duplicate check: same analyst/market/direction, same calendar day. Not a hard block --
  // the client shows this back to the admin and can resubmit with confirmDuplicate=true.
  if (!confirmDuplicate) {
    const { data: existing } = await adminDb
      .from('actual_trades')
      .select('trade_id, published_at, result_r, triggered, source_system')
      .eq('analyst_id', analystId)
      .eq('market_id', marketId)
      .eq('direction', direction)
      .gte('published_at', `${date}T00:00:00Z`)
      .lt('published_at', `${date}T23:59:59.999Z`)

    if (existing && existing.length > 0) {
      return NextResponse.json({ duplicate: true, existing }, { status: 409 })
    }
  }

  const analystIdShort = String(analystId).slice(0, 8)
  const { data: market } = await adminDb.from('markets').select('symbol').eq('market_id', marketId).single()
  const symbol = (market as any)?.symbol ?? 'UNKNOWN'
  const sourceRecordId = `ADMIN-${analystIdShort}-${symbol}-${direction}-${date}-${Date.now()}`

  const { data: inserted, error: insertError } = await adminDb
    .from('actual_trades')
    .insert({
      source_system: 'MANUAL_BACKFILL',
      source_record_id: sourceRecordId,
      historical_backfill: false,
      import_batch_id: IMPORT_BATCH_ID,
      published_at: `${date}T08:00:00Z`,
      analyst_id: analystId,
      market_id: marketId,
      direction,
      entry: Number(entry),
      stop: Number(stop),
      target: Number(target),
      triggered: true,
      result_r: resultR,
      is_overridden: true,
      raw_payload: {
        source: 'ADMIN_MANUAL_ENTRY',
        entry: Number(entry), stop: Number(stop), target: Number(target), exit: Number(exit),
        direction, date,
        entered_by: user.email,
        entered_at: new Date().toISOString(),
      },
    })
    .select('trade_id')
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // KPI recalculation -- the subprocess-based trigger (spawn with shell: true) failed on
  // Railway because /bin/sh isn't at the expected path there. KPIs are weekly figures, so
  // rather than fixing the subprocess, recalculation is simply left to the existing Monday
  // scheduled job. kpiRecalc.message is kept in the response (rather than dropping the
  // field) since ManualTradeEntryPanel.tsx already reads it for its success banner.
  console.log('KPI recalculation will run on next scheduled Monday job')
  const kpiRecalc = { status: 'skipped' as const, message: 'KPI recalculation will run on next scheduled Monday job' }

  return NextResponse.json({
    ok: true,
    tradeId: (inserted as any)?.trade_id,
    resultR,
    kpiRecalc,
  })
}
