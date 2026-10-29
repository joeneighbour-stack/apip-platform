import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { fetchAllPages, verifyExpectedCount, PaginationError } from '@/lib/paginatedFetch'

const MAX_ROWS = 150_000

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
    .select('role, analyst_id')
    .eq('auth_user_id', user.id)
    .single()

  const role = (appUser as any)?.role
  if (!role || !['MANAGER', 'ADMIN', 'EXECUTIVE', 'ANALYST'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const to = url.searchParams.get('to')
  const requestedAnalystId = url.searchParams.get('analystId')

  // This route bypasses RLS via the service-role client (see comment above), so unlike
  // /trades, an ANALYST caller gets no free row-level scoping -- their own analyst_id
  // is enforced here instead, ignoring any ?analystId= they pass (not just checking it).
  const scopedAnalystId = role === 'ANALYST' ? (appUser as any)?.analyst_id ?? null : requestedAnalystId
  if (role === 'ANALYST' && !scopedAnalystId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminDb = createAdminClient()
  const FIELDS = 'analyst_id, market_id, published_at, reconciliation_status'

  // See the identical helper's comment in app/api/analytics/trades/route.ts -- filters
  // applied without .select() so callers can chain either the data select or the
  // count-query select fresh off .from(), since Supabase's count overload only exists
  // directly on .select() itself.
  function withFilters<Q extends { eq: any; gte: any; lte: any }>(query: Q): Q {
    let q: any = query
      .eq('source_system', 'ACUITY_PERFORMANCE_API')
      .gte('published_at', from + 'T00:00:00Z')
    if (to) q = q.lte('published_at', to + 'T23:59:59Z')
    if (scopedAnalystId) q = q.eq('analyst_id', scopedAnalystId)
    return q
  }

  try {
    const allPubs = await fetchAllPages<any>(
      page => withFilters(adminDb.from('analyst_publications').select(FIELDS))
        .order('published_at', { ascending: false })
        .order('publication_id', { ascending: false })
        .range(page * 1000, page * 1000 + 999),
      { label: 'analyst_publications', maxRows: MAX_ROWS },
    )

    if (allPubs.length < MAX_ROWS) {
      await verifyExpectedCount(
        allPubs.length,
        async () => {
          const { count, error } = await withFilters(adminDb.from('analyst_publications').select('analyst_id', { count: 'exact', head: true }))
          return { count, error }
        },
        'analyst_publications',
      )
    }

    return NextResponse.json(allPubs)
  } catch (err) {
    if (err instanceof PaginationError) {
      console.error('[api/analytics/publications]', err.message)
      return NextResponse.json({ error: `Failed to load publications: ${err.message}` }, { status: 502 })
    }
    throw err
  }
}
