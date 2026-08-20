import { Suspense } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AnalyticsPage } from '@/components/analytics/AnalyticsPage'

export default async function PerformanceAnalyticsPage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN', 'EXECUTIVE'].includes(user.role)) redirect('/login')

  const supabase = await createClient()

  const { data: analysts, error: analystsError } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active')
    .order('display_name')
  if (analystsError) console.error('[PerformanceAnalyticsPage] Failed to fetch analysts:', analystsError.message)

  const { data: markets, error: marketsError } = await supabase
    .from('markets')
    .select('market_id, symbol, asset_class')
    .order('asset_class, symbol')
  if (marketsError) console.error('[PerformanceAnalyticsPage] Failed to fetch markets:', marketsError.message)

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-xl font-semibold">Performance Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Institutional-style performance analysis across analysts, markets, and time periods
        </p>
      </div>
      <Suspense>
        <AnalyticsPage
          analysts={(analysts as any[]) ?? []}
          markets={(markets as any[]) ?? []}
        />
      </Suspense>
    </div>
  )
}
