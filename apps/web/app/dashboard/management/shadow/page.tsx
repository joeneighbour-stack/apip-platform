import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ShadowMonitoringPanel } from '@/components/management/ShadowMonitoringPanel'

export default async function ShadowMonitoringPage() {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/dashboard')

  const supabase = await createClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Shadow trades with full detail -- direction/session from shadow_trades directly
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
          market:market_id ( symbol, asset_class, display_precision )
        )
      )
    `)
    .order('shadow_outcome_id', { ascending: false })

  // Actual trades for comparison
  const { data: actualTrades } = await supabase
    .from('actual_trades')
    .select(`
      trade_id, direction, result_r, triggered, published_at,
      analyst:analyst_id ( display_name ),
      market:market_id ( symbol, asset_class )
    `)
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .gte('published_at', thirtyDaysAgo)
    .order('published_at', { ascending: false })

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
        shadowOutcomes={shadowOutcomes ?? []}
        actualTrades={actualTrades ?? []}
      />
    </div>
  )
}
