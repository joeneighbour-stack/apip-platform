import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!['ADMIN', 'MANAGER'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { engineRunId } = await req.json()
  const supabase = await createClient()

  // Reset failed run to QUEUED (the enum's own initial state, per
  // engine_run_status in migrations/001_schema.sql) so the engine can retry --
  // 'PENDING' is not a valid engine_run_status value.
  const { error } = await supabase
    .from('engine_runs')
    .update({ status: 'QUEUED', error_summary: null })
    .eq('engine_run_id', engineRunId)
    .eq('status', 'FAILED')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, message: 'Run reset to QUEUED. Trigger engine manually to retry.' })
}
