import { createClient } from '@/lib/supabase/server'
import { getWorkspaceData } from '@/lib/workspaceData'
import { NextResponse } from 'next/server'

interface RouteParams {
  params: Promise<{ analystId: string }>
}

// Backs the inline "View" panel on the management workspace (WorkloadPanel.tsx) -- lazy
// fetched client-side on first expand, wrapping the same getWorkspaceData() the analyst's
// own /dashboard/analyst page and the full read-only /workspace page already use.
export async function GET(_req: Request, { params }: RouteParams) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()

  const role = (appUser as any)?.role
  if (!role || !['MANAGER', 'ADMIN'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { analystId } = await params
  const data = await getWorkspaceData(analystId)
  return NextResponse.json(data)
}
