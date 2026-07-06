import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { availabilityId } = await req.json()
  const supabase = await createClient()

  // Only allow cancelling own pending requests
  const { data: existing } = await supabase
    .from('analyst_availability')
    .select('analyst_id, status')
    .eq('availability_id', availabilityId)
    .single()

  if (!existing || existing.analyst_id !== user.analystId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (existing.status !== 'PENDING') {
    return NextResponse.json({ error: 'Can only cancel pending requests' }, { status: 400 })
  }

  const { error } = await supabase
    .from('analyst_availability')
    .delete()
    .eq('availability_id', availabilityId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
