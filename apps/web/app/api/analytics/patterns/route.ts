import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { computePatternSummary, type PatternTradeRow } from '@/lib/patternAnalytics'

// Same reasoning as /api/analytics/publications: pattern_trades RLS grants
// ADMIN/MANAGER/RESEARCH only (migrations/065_pattern_trades.sql) -- no ANALYST
// tier exists for this data at all, so this route checks the role explicitly
// and uses the service-role client rather than relying on RLS to scope a caller
// who shouldn't see this data in the first place.
const ALLOWED_ROLES = ['MANAGER', 'ADMIN', 'EXECUTIVE']

// Safety valve only, matching /api/analytics/trades's own MAX_ROWS -- the real
// bound is the `from`/`to` filters. pattern_trades spans 2020-09-30 to today
// (backfillPatternTrades.ts), the largest single-table history in this app.
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
  const granularity = url.searchParams.get('granularity') // '1h' | '4h' | '1d' | null (ALL)
  const direction = url.searchParams.get('direction')     // 'BUY' | 'SELL' | null (ALL)
  const assetClass = url.searchParams.get('assetClass')   // 'FX' | 'Equity' | ... | null (ALL)

  const adminDb = createAdminClient()
  const FIELDS = 'family, granularity, asset_class, direction, status, triggered, rr'

  const allRows: PatternTradeRow[] = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    let query = adminDb.from('pattern_trades').select(FIELDS)
    if (from) query = query.gte('published_at', from + 'T00:00:00Z')
    if (to) query = query.lte('published_at', to + 'T23:59:59Z')
    if (granularity) query = query.eq('granularity', granularity)
    if (direction) query = query.eq('direction', direction)
    if (assetClass) query = query.eq('asset_class', assetClass)

    const { data, error } = await query
      .order('published_at', { ascending: false })
      .order('report_id', { ascending: false })
      .range(page * 1000, page * 1000 + 999)

    if (error) {
      console.error('[api/analytics/patterns] Failed to fetch pattern_trades:', error.message)
      hasMore = false
    } else if (!data?.length) {
      hasMore = false
    } else {
      allRows.push(...(data as unknown as PatternTradeRow[]))
      hasMore = data.length === 1000
      page++
    }

    if (allRows.length >= MAX_ROWS) break
  }

  return NextResponse.json(computePatternSummary(allRows))
}
