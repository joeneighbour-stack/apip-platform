import { createClient } from '@/lib/supabase/server'
import { getAnalystProfileData } from '@/lib/analystProfile'
import { NextResponse } from 'next/server'

interface RouteParams {
  params: Promise<{ analystId: string }>
}

// Backs the inline "Profile" panel on the management workspace (WorkloadPanel.tsx) --
// lazy-fetched client-side on first expand, so the KPI-only slice of
// getAnalystProfileData() (same data AnalystProfileContent's kpi-only mode renders) needs
// a JSON endpoint rather than a server component render.
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
  const data = await getAnalystProfileData(analystId, 'kpi-only')
  if (!data.analyst) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ kpis: data.kpis, kpiTrend: data.kpiTrend })
}
