import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { availabilityId, action } = await req.json()
  if (!availabilityId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('analyst_availability')
    .update({
      status: action === 'approve' ? 'APPROVED' : 'REJECTED',
      approved_by: user.userId,
      approved_at: new Date().toISOString(),
    })
    .eq('availability_id', availabilityId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
