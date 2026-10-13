import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import {
  buildSignalTypeData, computeTotalSignalsPerDay, mergeCumulativeSeries,
  type NormalisedSignal, type SignalTypeData,
} from '@/lib/combinedSignalAnalytics'

// Same reasoning as /api/analytics/patterns and /api/analytics/ai-signals: pattern_trades/
// ai_trades RLS grants ADMIN/MANAGER/RESEARCH only (no ANALYST tier exists for that data
// at all), so this route checks the role explicitly and uses the service-role client for
// those two tables. actual_trades does have an ANALYST RLS policy, but this route is only
// ever called from the management-only "All Signals" tab (same gate as Patterns/AI
// Signals -- !lockedAnalystId in AnalyticsPage.tsx), so the same management-role gate is
// applied uniformly across all three tables rather than special-casing actual_trades.
const ALLOWED_ROLES = ['MANAGER', 'ADMIN', 'EXECUTIVE']

// Safety valve only, matching the other analytics routes' own MAX_ROWS -- this route has
// no from/to filter (the tab covers full history across all three types by design), so
// these are simply generous enough to cover each table's full size today.
const MAX_ROWS = 200_000

// Patterns' current (intentionally unchanged -- see lib/patternAnalytics.ts, which this
// duplicates) "with outcome" statuses: Closed-Profit/Loss only. Do NOT add 'Expired' here
// without first re-confirming the win-rate methodology question raised for Patterns in a
// prior task -- patterns were deliberately left alone pending that follow-up decision.
const PATTERN_OUTCOME_STATUSES = new Set(['Closed - Profit', 'Closed - Loss'])

// AI's current "with outcome" statuses (lib/aiSignalAnalytics.ts) -- includes Expired
// signals that closed with a recorded rr, per that file's own fix.
const AI_OUTCOME_STATUSES = new Set(['Closed - Profit', 'Closed - Loss', 'Closed - Flat', 'Expired'])

async function fetchAll<T>(
  query: (page: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const all: T[] = []
  let page = 0
  let hasMore = true
  while (hasMore) {
    const { data, error } = await query(page)
    if (error) {
      console.error(`[api/analytics/combined] Failed to fetch ${label}:`, error.message)
      hasMore = false
    } else if (!data?.length) {
      hasMore = false
    } else {
      all.push(...data)
      hasMore = data.length === 1000
      page++
    }
    if (all.length >= MAX_ROWS) break
  }
  return all
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()

  const role = (appUser as any)?.role
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminDb = createAdminClient()

  const [analystRows, patternRows, aiRows] = await Promise.all([
    fetchAll<{ triggered: boolean | null; result_r: number | null; published_at: string | null }>(
      page => adminDb.from('actual_trades')
        .select('triggered, result_r, published_at')
        .order('published_at', { ascending: false })
        .order('trade_id', { ascending: false })
        .range(page * 1000, page * 1000 + 999),
      'actual_trades',
    ),
    fetchAll<{ status: string | null; rr: number | null; published_at: string | null; triggered: boolean | null }>(
      page => adminDb.from('pattern_trades')
        .select('status, rr, published_at, triggered')
        .order('published_at', { ascending: false })
        .order('report_id', { ascending: false })
        .range(page * 1000, page * 1000 + 999),
      'pattern_trades',
    ),
    // Same window-function RPC as /api/analytics/ai-signals (migrations/
    // 068_ai_trades_reiteration.sql) -- is_reiteration is filtered out below before
    // building aiSignals, so the AI row's performance figures (totalSignals/winRate/
    // avgR/totalR) use the same deduplicated population as the AI Signals tab itself.
    // totalPublished/totalTriggered below deliberately use the FULL aiRows (reiterations
    // included) instead -- see buildSignalTypeData's own comment.
    fetchAll<{ status: string | null; rr: number | null; published_at: string | null; is_reiteration: boolean; triggered: boolean | null }>(
      page => adminDb.rpc('ai_trades_with_reiteration')
        .order('published_at', { ascending: false })
        .order('report_id', { ascending: false })
        .range(page * 1000, page * 1000 + 999),
      'ai_trades_with_reiteration',
    ),
  ])

  // Analyst "with outcome" matches lib/metrics.ts's own triggeredTrades(): triggered AND
  // a recorded result_r. Pattern/AI use their own status whitelists (see constants above).
  const analystSignals: NormalisedSignal[] = analystRows
    .filter(t => t.published_at)
    .map(t => ({
      date: t.published_at!.slice(0, 10),
      rr: t.triggered === true && t.result_r !== null ? t.result_r : null,
    }))

  const patternSignals: NormalisedSignal[] = patternRows
    .filter(t => t.published_at)
    .map(t => ({
      date: t.published_at!.slice(0, 10),
      rr: t.status !== null && PATTERN_OUTCOME_STATUSES.has(t.status) && t.rr !== null ? t.rr : null,
    }))

  // Reiterations are excluded entirely here (not just from the rr/outcome calculation,
  // the way Pattern/Analyst rows are) -- a reiteration is a stacked, non-independent
  // signal on a symbol, so it shouldn't count toward totalSignals/firstSignalDate/
  // lastSignalDate either, unlike a genuine signal that simply never closed with a
  // recorded result.
  const aiDeduped = aiRows.filter(t => !t.is_reiteration)
  const aiReiterations = aiRows.length - aiDeduped.length
  const aiSignals: NormalisedSignal[] = aiDeduped
    .filter(t => t.published_at)
    .map(t => ({
      date: t.published_at!.slice(0, 10),
      rr: t.status !== null && AI_OUTCOME_STATUSES.has(t.status) && t.rr !== null ? t.rr : null,
    }))

  // totalPublished/totalTriggered are passed in from the FULL raw row count for each
  // table (aiRows, not aiDeduped) -- "every row published" and "how many of them
  // triggered an entry" are both questions about everything that actually got published,
  // including AI reiterations, independent of which rows count toward performance stats.
  const analyst: SignalTypeData = buildSignalTypeData(
    analystSignals, analystRows.length, analystRows.filter(t => t.triggered === true).length
  )
  const patterns: SignalTypeData = buildSignalTypeData(
    patternSignals, patternRows.length, patternRows.filter(t => t.triggered === true).length
  )
  const ai: SignalTypeData = buildSignalTypeData(
    aiSignals, aiRows.length, aiRows.filter(t => t.triggered === true).length
  )

  // Signal OUTPUT (how many signals, how often) is measured over every published row,
  // including AI reiterations -- same reasoning as totalPublished above, and distinct
  // from the deduplicated population cumulativeR/performance stats use. "Trading days"
  // means distinct calendar days with at least one signal of any type, not the raw
  // calendar span -- see computeTotalSignalsPerDay's own comment.
  const allPublishedDates = [
    ...analystRows.map(t => t.published_at).filter((d): d is string => Boolean(d)).map(d => d.slice(0, 10)),
    ...patternRows.map(t => t.published_at).filter((d): d is string => Boolean(d)).map(d => d.slice(0, 10)),
    ...aiRows.map(t => t.published_at).filter((d): d is string => Boolean(d)).map(d => d.slice(0, 10)),
  ]

  return NextResponse.json({
    analyst,
    patterns,
    ai,
    // Not part of SignalTypeSummary (analyst/patterns have no reiteration concept) --
    // a sibling field so the combined tab can note it on the AI row if desired, same
    // "pass through, don't silently fold into the headline count" treatment as the AI
    // Signals tab's own reiterations tile.
    aiReiterations,
    combined: {
      totalSignalsPerDay: computeTotalSignalsPerDay(allPublishedDates),
      cumulativeR: mergeCumulativeSeries(analyst.cumulativeR, patterns.cumulativeR, ai.cumulativeR),
    },
  })
}
