import { NextResponse } from 'next/server'
import { invalidateAnalyticsCache, getCachedDefaultAnalyticsView } from '@/lib/analyticsCache'

// Hit every 2 hours during market hours (05:00-19:00 UTC weekdays) by
// .github/workflows/analytics-cache-warm.yml, so the first manager to open
// the Analytics page each cycle gets a warm cache instead of paying for the
// 30,000+ trade computation themselves. No user session exists when GitHub
// Actions calls this -- authenticated by a shared secret header instead of
// the normal role check every other analytics route uses.
// Deletes the analytics_cache row first so getCachedDefaultAnalyticsView()
// always does a real recompute rather than returning whatever's already
// there.
export async function GET(req: Request) {
  const secret = req.headers.get('x-warm-cache-secret')
  const expected = process.env.ANALYTICS_WARM_CACHE_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await invalidateAnalyticsCache()
  const data = await getCachedDefaultAnalyticsView()
  return NextResponse.json({ ok: true, computedAt: data.computedAt, tradeCount: data.tradeCount })
}
