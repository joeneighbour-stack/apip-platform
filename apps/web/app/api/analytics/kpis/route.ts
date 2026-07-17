// app/api/analytics/kpis/route.ts
// Returns executive_kpis for all analysts, used as primary data source for analytics page.
// Fast — pre-calculated weekly, no heavy trade aggregation needed.

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const supabase = await createClient()
  const url = new URL(req.url)
  const from = url.searchParams.get('from') ?? '2017-01-01'

  const allKpis: any[] = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('executive_kpis')
      .select('analyst_id, kpi_name, kpi_value, period_start')
      .eq('kpi_visibility', 'ANALYST_OWN')
      .not('analyst_id', 'is', null)
      .gte('period_start', from)
      .order('period_start', { ascending: true })
      .range(page * 1000, page * 1000 + 999)

    if (error || !data?.length) { hasMore = false }
    else {
      allKpis.push(...data)
      hasMore = data.length === 1000
      page++
    }
  }

  return NextResponse.json(allKpis)
}

