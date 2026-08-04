import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// analyst_publications RLS denies EXECUTIVE entirely and scopes MANAGER to only the
// analysts they manage (migrations/018_publication_rls.sql) -- the Analytics page's
// trigger-rate calculation needs the full, unscoped set regardless of role, so this
// route uses the service-role client. Unlike the sibling /trades and /kpis routes
// (which still have RLS as a fallback even without an explicit check here), bypassing
// RLS means this route MUST check the caller's role itself.
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()

  const role = (appUser as any)?.role
  if (!role || !['MANAGER', 'ADMIN', 'EXECUTIVE'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const to = url.searchParams.get('to')

  const adminDb = createAdminClient()
  const FIELDS = 'analyst_id, market_id, published_at, reconciliation_status'

  const allPubs: any[] = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    let query = adminDb
      .from('analyst_publications')
      .select(FIELDS)
      .eq('source_system', 'ACUITY_PERFORMANCE_API')
      .gte('published_at', from + 'T00:00:00Z')
    if (to) query = query.lte('published_at', to + 'T23:59:59Z')

    const { data, error } = await query
      .order('published_at', { ascending: false })
      .order('publication_id', { ascending: false })
      .range(page * 1000, page * 1000 + 999)

    if (error || !data?.length) {
      hasMore = false
    } else {
      allPubs.push(...data)
      hasMore = data.length === 1000
      page++
    }

    if (allPubs.length >= 150_000) break
  }

  return NextResponse.json(allPubs)
}
