import { createAdminClient } from '@/lib/supabase/server'
import { getShadowBreakdownData } from '@/lib/shadowBreakdown'
import { NextResponse } from 'next/server'

// Same shape and trust boundary as /api/analytics/warm-cache: no user session exists when
// this is called on a schedule, authenticated by a shared secret header instead. Reuses that
// same secret (ANALYTICS_WARM_CACHE_SECRET) rather than minting a shadow-specific one -- both
// endpoints exist purely to let a scheduled caller pay for an expensive recompute ahead of
// the first manager to load the page, the same internal trust boundary either way.
//
// Unlike that sibling route, this doesn't invalidate the cache row first: getShadowBreakdownData()
// has its own 10-minute TTL check (shadowBreakdown.ts), so as long as this is called on a
// schedule at least that frequent, every call already finds the previous row stale and
// recomputes -- no separate delete-then-recompute step needed. Not yet wired to a schedule
// (no shadow-cache-warm.yml workflow exists) -- this only helps once something calls it
// periodically, same as /api/analytics/warm-cache needed analytics-cache-warm.yml.
export async function GET(req: Request) {
  const secret = req.headers.get('x-warm-cache-secret')
  const expected = process.env.ANALYTICS_WARM_CACHE_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminDb = createAdminClient()
  await getShadowBreakdownData(adminDb)
  return NextResponse.json({ ok: true, warmed: new Date().toISOString() })
}
