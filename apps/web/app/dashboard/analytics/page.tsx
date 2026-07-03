import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PerformanceAnalytics } from '@/components/analytics/PerformanceAnalytics'

export default async function PerformanceAnalyticsPage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN', 'EXECUTIVE'].includes(user.role)) redirect('/dashboard')

  const supabase = await createClient()

  const { data: analysts } = await supabase
    .from('analysts')
    .select('analyst_id, display_name')
    .eq('active', true)
    .order('display_name')

  const { data: markets } = await supabase
    .from('markets')
    .select('market_id, symbol, asset_class')
    .order('asset_class, symbol')

  const fiveYearsAgo = new Date()
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)

  const { data: trades } = await supabase
    .from('actual_trades')
    .select(`
      trade_id, analyst_id, direction, result_r,
      triggered, published_at, historical_backfill,
      market:market_id ( market_id, symbol, asset_class )
    `)
    .gte('published_at', fiveYearsAgo.toISOString())
    .order('published_at', { ascending: false })
    .limit(50000)

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
        trades={(trades ?? []) as any}
      />
    </div>
  )
}
