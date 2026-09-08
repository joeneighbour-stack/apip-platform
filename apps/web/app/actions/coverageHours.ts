'use server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { calcHours, getMonthRange } from '@/lib/hoursTracker'

export interface AnalystCoverageHours {
  analyst_id: string
  display_name: string
  markets: number
  hoursDisplay: string
}

export interface CoverageHoursResult {
  analystHours: AnalystCoverageHours[]
  totalMarkets: number
  totalHoursDisplay: string
}

export type CoverageHoursResponse =
  | { success: true; data: CoverageHoursResult }
  | { success: false; error: string }

// Shared by the admin centre's initial (server-rendered) month and its client-side
// month selector -- single source of truth for the query so the two can't drift.
export async function getCoverageHoursForMonth(year: number, month: number): Promise<CoverageHoursResponse> {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) {
    return { success: false, error: 'Insufficient permissions' }
  }

  const adminDb = createAdminClient()
  const { start, end } = getMonthRange(year, month)

  const { data: analysts, error: analystsError } = await adminDb
    .from('analysts')
    .select('analyst_id, display_name')
    .eq('active', true)
    .order('display_name')
  if (analystsError) return { success: false, error: analystsError.message }

  const { data: pubCounts, error: pubError } = await adminDb
    .from('analyst_publications')
    .select('analyst_id, publication_id')
    .eq('source_system', 'ACUITY_PERFORMANCE_API')
    .gte('published_at', start)
    .lte('published_at', end + 'T23:59:59Z')
  if (pubError) return { success: false, error: pubError.message }

  const countByAnalyst = new Map<string, number>()
  for (const p of pubCounts ?? []) {
    countByAnalyst.set(p.analyst_id, (countByAnalyst.get(p.analyst_id) ?? 0) + 1)
  }

  const analystHours: AnalystCoverageHours[] = (analysts ?? []).map(a => {
    const markets = countByAnalyst.get(a.analyst_id) ?? 0
    return {
      analyst_id: a.analyst_id,
      display_name: a.display_name,
      markets,
      hoursDisplay: calcHours(markets).display,
    }
  })

  const totalMarkets = analystHours.reduce((s, a) => s + a.markets, 0)
  const totalHoursDisplay = calcHours(totalMarkets).display

  return { success: true, data: { analystHours, totalMarkets, totalHoursDisplay } }
}
