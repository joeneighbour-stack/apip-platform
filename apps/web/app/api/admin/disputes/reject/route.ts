import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!['ADMIN', 'MANAGER'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { disputeId, admin_note } = await req.json()
  const supabase = await createClient()

  const { error } = await supabase
    .from('trade_disputes')
    .update({
      status: 'REJECTED',
      admin_note: admin_note ?? null,
      resolved_by_id: user.appUserId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('dispute_id', disputeId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
