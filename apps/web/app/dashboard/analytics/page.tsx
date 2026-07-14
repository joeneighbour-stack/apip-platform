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

  // Single RPC call returns all trades -- avoids pagination timeout issues
  const { data: rawTrades } = await supabase
    .rpc('get_all_trades_for_analytics')

  // Reshape to match component's expected Trade shape
  const allTrades = (rawTrades ?? []).map((t: any) => ({
    trade_id: t.trade_id,
    analyst_id: t.analyst_id,
    direction: t.direction,
    result_r: t.result_r,
    triggered: t.triggered,
    published_at: t.published_at,
    historical_backfill: t.historical_backfill,
    market: {
      market_id: t.market_id,
      symbol: t.symbol,
      asset_class: t.asset_class,
    },
  }))

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
