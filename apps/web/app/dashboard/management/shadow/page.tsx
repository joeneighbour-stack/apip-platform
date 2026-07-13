import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ShadowMonitoringPanel } from '@/components/management/ShadowMonitoringPanel'

export default async function ShadowMonitoringPage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const supabase = await createClient()
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Shadow outcomes -- all resolved outcomes for like-for-like comparison
  const { data: shadowOutcomes } = await supabase
    .from('shadow_trade_outcomes')
    .select(`
      shadow_outcome_id,
      trade_outcome_status,
      result_r,
      outcome_timestamp,
      shadow_trade:shadow_trade_id (
        shadow_trade_id,
        entry, stop, target, rr,
        direction, session,
        template_source,
        generated_at,
        opportunity:opportunity_id (
          date,
          market:market_id ( symbol, asset_class, display_precision, market_id )
        )
      )
    `)
    .order('shadow_outcome_id', { ascending: false })

  // Actual trades for like-for-like -- last 90 days
  const { data: actualTrades } = await supabase
    .from('actual_trades')
    .select(`
      trade_id, direction, result_r, triggered, published_at,
      market:market_id ( symbol, asset_class, market_id )
    `)
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .gte('published_at', ninetyDaysAgo)
    .order('published_at', { ascending: false })

  // Sort shadow by date desc
  const sorted = (shadowOutcomes ?? []).sort((a, b) => {
    const dateA = (a.shadow_trade as any)?.opportunity?.date ?? ''
    const dateB = (b.shadow_trade as any)?.opportunity?.date ?? ''
    return dateB.localeCompare(dateA)
  })

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Shadow Monitoring</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hidden benchmark performance — restricted to management only
          </p>
        </div>
        <a href="/dashboard/management"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back to Management
        </a>
      </div>
      <ShadowMonitoringPanel
        shadowOutcomes={sorted}
        actualTrades={actualTrades ?? []}
      />
    </div>
  )
}
