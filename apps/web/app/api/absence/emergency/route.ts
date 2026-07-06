import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { analystId, session } = await req.json()
  if (!analystId || !session) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const supabase = await createClient()
  const today = new Date().toISOString().slice(0, 10)

  const { error } = await supabase
    .from('analyst_availability')
    .upsert({
      analyst_id: analystId,
      date: today,
      session,
      available: false,
      status: 'APPROVED',
      approved_by: user.userId,
      approved_at: new Date().toISOString(),
    }, { onConflict: 'analyst_id,date,session' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
