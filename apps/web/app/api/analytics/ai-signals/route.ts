import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { computeAiSignalSummary, type AiTradePoint } from '@/lib/aiSignalAnalytics'
import { fetchAllPages, PaginationError } from '@/lib/paginatedFetch'

// Same reasoning as /api/analytics/patterns: ai_trades RLS grants ADMIN/MANAGER/
// RESEARCH only (migrations/066_ai_trades.sql) -- no ANALYST tier exists for this data
// at all, so this route checks the role explicitly and uses the service-role client
// rather than relying on RLS to scope a caller who shouldn't see this data in the
// first place.
const ALLOWED_ROLES = ['MANAGER', 'ADMIN', 'EXECUTIVE']

// Safety valve only, matching /api/analytics/patterns's own MAX_ROWS -- the real
// bound is the `from`/`to` filters.
const MAX_ROWS = 200_000

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
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const direction = url.searchParams.get('direction')     // 'BUY' | 'SELL' | null (ALL)
  const assetClass = url.searchParams.get('assetClass')   // 'FX' | 'Equity' | ... | null (ALL)

  const adminDb = createAdminClient()

  // ai_trades_with_reiteration() (migrations/068_ai_trades_reiteration.sql) computes
  // is_reiteration via a window function over the FULL, unfiltered table -- PostgREST's
  // plain .select() builder can't express that, hence .rpc() here instead of
  // .from('ai_trades').select(...). from/to/direction/assetClass are applied as normal
  // filters on the function's OUTPUT (same as any other PostgREST resource), which is
  // deliberate: filtering before the window was computed would misclassify
  // reiterations at the filter boundary -- see the function's own comment.
  function baseQuery() {
    let query = adminDb.rpc('ai_trades_with_reiteration')
    if (from) query = query.gte('published_at', from + 'T00:00:00Z')
    if (to) query = query.lte('published_at', to + 'T23:59:59Z')
    if (direction) query = query.eq('direction', direction)
    if (assetClass) query = query.eq('asset_class', assetClass)
    return query
  }

  try {
    const allRows = await fetchAllPages<AiTradePoint>(
      page => baseQuery()
        .order('published_at', { ascending: false })
        .order('report_id', { ascending: false })
        .range(page * 1000, page * 1000 + 999) as unknown as PromiseLike<{ data: AiTradePoint[] | null; error: { message: string } | null }>,
      { label: 'ai_trades_with_reiteration', maxRows: MAX_ROWS },
    )

    // computeAiSignalSummary() filters to is_reiteration = false internally for every
    // stat (win rate/avg R/total R/drawdown/breakdowns) -- totalSignals below is
    // deliberately overridden AFTER that spread to mean the raw, all-signals count (the
    // task's own field contract), with the dedup/excluded counts broken out explicitly
    // alongside it so neither meaning is lost.
    const uniqueSignals = allRows.filter(r => !r.is_reiteration).length
    const reiterations = allRows.length - uniqueSignals

    return NextResponse.json({
      ...computeAiSignalSummary(allRows),
      totalSignals: allRows.length,
      uniqueSignals,
      reiterations,
      trades: allRows,
    })
  } catch (err) {
    if (err instanceof PaginationError) {
      console.error('[api/analytics/ai-signals]', err.message)
      return NextResponse.json({ error: `Failed to load AI signal trades: ${err.message}` }, { status: 502 })
    }
    throw err
  }
}
