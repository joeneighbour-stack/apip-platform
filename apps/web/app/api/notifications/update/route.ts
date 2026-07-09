import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

const ACTION_STATUS: Record<string, string> = {
  acknowledge: 'ACKNOWLEDGED',
  resolve:     'RESOLVED',
  dismiss:     'DISMISSED',
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!['ADMIN', 'MANAGER'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { notificationId, action } = await req.json()
  const newStatus = ACTION_STATUS[action]
  if (!newStatus) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const supabase = await createClient()
  const { error } = await supabase
    .from('notifications')
    .update({
      notification_status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('notification_id', notificationId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
