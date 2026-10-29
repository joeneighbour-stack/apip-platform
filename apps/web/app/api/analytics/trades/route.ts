import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { fetchAllPages, verifyExpectedCount, PaginationError } from '@/lib/paginatedFetch'

// Safety valve only -- the actual bound on result size is the `from` date filter, not
// this cap. Raised from the previous 35,000 so "Since Inception" queries have headroom
// to grow with the business rather than silently truncating.
const MAX_ROWS = 150_000

export async function GET(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const to = url.searchParams.get('to')
  const requestedAnalystId = url.searchParams.get('analystId')
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, analyst_id')
    .eq('auth_user_id', user.id)
    .single()

  const role = (appUser as any)?.role
  // actual_trades RLS already confines an ANALYST session to their own rows
  // (migrations/002_rls.sql, actual_trades_select_own), but we scope explicitly here too
  // so an analyst can never pull another analyst's data by passing a different
  // ?analystId= on this route -- the param is ignored in favour of the session's own id,
  // not merely checked against it.
  const scopedAnalystId = role === 'ANALYST' ? (appUser as any)?.analyst_id ?? null : requestedAnalystId

  const FIELDS = `trade_id, analyst_id, direction, result_r,
    triggered, published_at, closed_at, expiry, historical_backfill, source_system, session,
    market:market_id ( market_id, symbol, asset_class )`

  // Applies the shared filters without calling .select() -- callers chain their own
  // .select() first, since Supabase's count-query overload (`{count:'exact',head:true}`)
  // is only available directly off .select(), not after chaining further filters onto an
  // already-selected builder.
  function withFilters<Q extends { gte: any; lte: any; eq: any }>(query: Q): Q {
    let q: any = query.gte('published_at', from + 'T00:00:00Z')
    if (to) q = q.lte('published_at', to + 'T23:59:59Z')
    if (scopedAnalystId) q = q.eq('analyst_id', scopedAnalystId)
    return q
  }

  try {
    const allTrades = await fetchAllPages<any>(
      page => withFilters(supabase.from('actual_trades').select(FIELDS))
        .order('published_at', { ascending: false })
        .order('trade_id', { ascending: false })
        .range(page * 1000, page * 1000 + 999),
      { label: 'actual_trades', maxRows: MAX_ROWS },
    )

    // Skipped once the deliberate MAX_ROWS safety valve kicks in -- that's an
    // intentional truncation, not the bug this check is for, and would always
    // "mismatch" against the full unbounded count.
    if (allTrades.length < MAX_ROWS) {
      await verifyExpectedCount(
        allTrades.length,
        async () => {
          const { count, error } = await withFilters(supabase.from('actual_trades').select('trade_id', { count: 'exact', head: true }))
          return { count, error }
        },
        'actual_trades',
      )
    }

    return NextResponse.json(allTrades)
  } catch (err) {
    if (err instanceof PaginationError) {
      console.error('[api/analytics/trades]', err.message)
      return NextResponse.json({ error: `Failed to load trades: ${err.message}` }, { status: 502 })
    }
    throw err
  }
}


