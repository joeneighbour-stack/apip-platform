import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { computeAiSignalSummary, type AiTradePoint } from '@/lib/aiSignalAnalytics'

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
  const FIELDS = 'confidence, asset_class, direction, status, triggered, rr, published_at, symbol, asset_name'

  const allRows: AiTradePoint[] = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    let query = adminDb.from('ai_trades').select(FIELDS)
    if (from) query = query.gte('published_at', from + 'T00:00:00Z')
    if (to) query = query.lte('published_at', to + 'T23:59:59Z')
    if (direction) query = query.eq('direction', direction)
    if (assetClass) query = query.eq('asset_class', assetClass)

    const { data, error } = await query
      .order('published_at', { ascending: false })
      .order('report_id', { ascending: false })
      .range(page * 1000, page * 1000 + 999)

    if (error) {
      console.error('[api/analytics/ai-signals] Failed to fetch ai_trades:', error.message)
      hasMore = false
    } else if (!data?.length) {
      hasMore = false
    } else {
      allRows.push(...(data as unknown as AiTradePoint[]))
      hasMore = data.length === 1000
      page++
    }

    if (allRows.length >= MAX_ROWS) break
  }

  return NextResponse.json({ ...computeAiSignalSummary(allRows), trades: allRows })
}
