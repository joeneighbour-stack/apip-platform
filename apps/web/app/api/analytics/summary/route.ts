import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getCachedDefaultAnalyticsView, CACHE_TAG } from '@/lib/analyticsCache'

// Pre-computed "Since Inception / All Analysts / All Markets" bundle -- see
// lib/analyticsCache.ts for what's actually cached and why. ?force=true is the manual
// "Refresh" button's path: invalidates the tag so the next read recomputes fresh instead
// of waiting out the 15-minute TTL, rather than doing a private one-off computation that
// wouldn't benefit the next visitor.
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase.from('app_users').select('role').eq('auth_user_id', user.id).single()
  const role = (appUser as any)?.role
  if (!role || !['MANAGER', 'ADMIN', 'EXECUTIVE'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  if (url.searchParams.get('force') === 'true') {
    revalidateTag(CACHE_TAG)
  }

  const data = await getCachedDefaultAnalyticsView()
  return NextResponse.json(data)
}
