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

  const FIELDS = `trade_id, analyst_id, direction, result_r,
    triggered, published_at, historical_backfill,
    market:market_id ( market_id, symbol, asset_class )`

  // Fetch all pages concurrently -- we know there are ~20k trades across ~20 pages
  const pages = await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      supabase
        .from('actual_trades')
        .select(FIELDS)
        .gte('published_at', '2017-01-01T00:00:00Z')
        .order('published_at', { ascending: false })
        .range(i * 1000, i * 1000 + 999)
        .then(r => r.data ?? [])
    )
  )

  const allTrades = pages.flat()

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
