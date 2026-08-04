import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getCachedDefaultAnalyticsView, CACHE_TAG } from '@/lib/analyticsCache'

// Hit on a schedule by .github/workflows/analytics-cache-warm.yml (06:00 UTC weekdays,
// after the morning import), so the first manager to open the Analytics page each day
// gets a warm cache instead of paying for the 30,000+ trade computation themselves.
// No user session exists when GitHub Actions calls this -- authenticated by a shared
// secret header instead of the normal role check every other analytics route uses.
// Invalidates the tag first so this always does a real recompute and repopulates the
// SAME cache entry /api/analytics/summary reads (unstable_cache's store is keyed to the
// wrapped function, not reachable by calling the raw compute function directly) -- the
// point of this endpoint is "make sure a fresh computation is sitting in the cache,"
// not "read whatever's there right now."
export async function GET(req: Request) {
  const secret = req.headers.get('x-warm-cache-secret')
  const expected = process.env.ANALYTICS_WARM_CACHE_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  revalidateTag(CACHE_TAG)
  const data = await getCachedDefaultAnalyticsView()
  return NextResponse.json({ ok: true, computedAt: data.computedAt, tradeCount: data.tradeCount })
}
