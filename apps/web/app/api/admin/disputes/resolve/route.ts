import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!['ADMIN', 'MANAGER'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { disputeId, tradeId, triggered, result_r, exit_price, admin_note } = await req.json()
  const supabase = await createClient()

  // Apply override to actual_trades
  const { error: tradeError } = await supabase
    .from('actual_trades')
    .update({
      triggered,
      result_r: result_r != null ? Number(result_r) : null,
    })
    .eq('trade_id', tradeId)

  if (tradeError) return NextResponse.json({ error: tradeError.message }, { status: 500 })

  // Build override values for audit record
  const overrideValues: Record<string, any> = { triggered }
  if (result_r != null) overrideValues.result_r = Number(result_r)
  if (exit_price != null) overrideValues.exit_price = Number(exit_price)
  overrideValues.overridden_by = user.email
  overrideValues.overridden_at = new Date().toISOString()

  // Resolve the dispute
  const { error: disputeError } = await supabase
    .from('trade_disputes')
    .update({
      status: 'RESOLVED',
      admin_note: admin_note ?? null,
      override_values: overrideValues,
      resolved_by_id: user.appUserId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('dispute_id', disputeId)

  if (disputeError) return NextResponse.json({ error: disputeError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
