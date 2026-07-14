import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PerformanceAnalytics } from '@/components/analytics/PerformanceAnalytics'

export default async function PerformanceAnalyticsPage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN', 'EXECUTIVE'].includes(user.role)) redirect('/login')

  const supabase = await createClient()

  const { data: analysts } = await supabase
    .from('analysts')
    .select('analyst_id, display_name')
    .order('display_name')

  const { data: markets } = await supabase
    .from('markets')
    .select('market_id, symbol, asset_class')
    .order('asset_class, symbol')

  const fiveYearsAgo = new Date()
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)

  const FIELDS = `trade_id, analyst_id, direction, result_r,
    triggered, published_at, historical_backfill,
    market:market_id ( market_id, symbol, asset_class )`
  const BASE = fiveYearsAgo.toISOString()
  const PAGE = 1000
  const TOTAL = 20000

  // First page to get initial data and check if more pages needed
  const { data: firstPage } = await supabase
    .from('actual_trades')
    .select(FIELDS)
    .gte('published_at', BASE)
    .order('published_at', { ascending: false })
    .range(0, PAGE - 1)

  let allTrades = firstPage ?? []

  if (allTrades.length === PAGE) {
    // Fetch remaining pages concurrently
    const totalPages = Math.ceil(TOTAL / PAGE)
    const remaining = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        supabase
          .from('actual_trades')
          .select(FIELDS)
          .gte('published_at', BASE)
          .order('published_at', { ascending: false })
          .range((i + 1) * PAGE, (i + 2) * PAGE - 1)
          .then(r => r.data ?? [])
      )
    )
    for (const page of remaining) {
      allTrades = [...allTrades, ...page]
      if (page.length < PAGE) break // last page
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Performance Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Deep dive into performance drivers across analysts, markets, and time periods
        </p>
      </div>
      <PerformanceAnalytics
        analysts={analysts ?? []}
        markets={markets ?? []}
        trades={allTrades as any}
      />
    </div>
  )
}
