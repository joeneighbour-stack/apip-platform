import { Suspense } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AnalyticsPage } from '@/components/analytics/AnalyticsPage'

export default async function AnalystPerformancePage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/login')
  if (!user.analystId) redirect('/dashboard/analyst')

  const supabase = await createClient()

  // Only the caller's own analyst record is needed -- the analyst filter is locked and
  // hidden on this view, so there's no reason to hand the client the full roster.
  const { data: analystRow } = await supabase
    .from('analysts')
    .select('analyst_id, display_name, active')
    .eq('analyst_id', user.analystId)
    .single()

  const { data: markets } = await supabase
    .from('markets')
    .select('market_id, symbol, asset_class')
    .order('asset_class, symbol')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-semibold">My Performance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Institutional-style performance analysis of your own trading history
          </p>
        </div>
        <a href="/dashboard/analyst"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Workspace
        </a>
      </div>
      <Suspense>
        <AnalyticsPage
          analysts={analystRow ? [analystRow as any] : []}
          markets={(markets as any[]) ?? []}
          lockedAnalystId={user.analystId}
        />
      </Suspense>
    </div>
  )
}
