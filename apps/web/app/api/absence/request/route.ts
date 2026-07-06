import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { analystId, dates, session } = await req.json()
  if (!analystId || !dates?.length) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  if (analystId !== user.analystId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supabase = await createClient()

  const rows = dates.map((date: string) => ({
    analyst_id: analystId,
    date,
    session: session ?? null,
    available: false,
    status: 'PENDING',
    requested_by: user.userId,
  }))

  const { data, error } = await supabase
    .from('analyst_availability')
    .insert(rows)
    .select('availability_id, date, session, status')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ created: data })
}
