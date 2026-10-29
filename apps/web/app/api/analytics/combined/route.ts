import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import {
  buildSignalTypeData, mergeCumulativeSeries, normaliseToIndex,
  buildAssetClassBreakdown, buildDayOfWeekBreakdown, buildMonthBreakdown, buildYearGrid, buildTopMarkets,
  type EnrichedSignal, type SignalTypeData,
} from '@/lib/combinedSignalAnalytics'
import { fetchAllPages, PaginationError } from '@/lib/paginatedFetch'

const ALLOWED_ROLES = ['MANAGER', 'ADMIN', 'EXECUTIVE']
const MAX_ROWS = 200_000

const PATTERN_OUTCOME_STATUSES = new Set(['Closed - Profit', 'Closed - Loss'])
const AI_OUTCOME_STATUSES = new Set(['Closed - Profit', 'Closed - Loss', 'Closed - Flat', 'Expired'])

function fetchAll<T>(
  query: (page: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  return fetchAllPages<T>(query, { label: `api/analytics/combined:${label}`, maxRows: MAX_ROWS })
}

type CumulativeRPoint = { date: string; cumulativeR: number }

function toIndexedCumulative(points: CumulativeRPoint[]): CumulativeRPoint[] {
  return normaliseToIndex(points.map(p => ({ date: p.date, value: p.cumulativeR })))
    .map(p => ({ date: p.date, cumulativeR: p.value }))
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

  try {
  const [analystRows, marketsResult, patternRows, aiRows] = await Promise.all([
    fetchAll<{
      triggered: boolean | null; result_r: number | null; published_at: string | null; market_id: string | null
    }>(
      page => adminDb.from('actual_trades')
        .select('triggered, result_r, published_at, market_id')
        .order('published_at', { ascending: false })
        .order('trade_id', { ascending: false })
        .range(page * 1000, page * 1000 + 999),
      'actual_trades',
    ),
    adminDb.from('markets').select('market_id, symbol, asset_class'),
    fetchAll<{
      status: string | null; rr: number | null; published_at: string | null; triggered: boolean | null
      asset_class: string | null; symbol: string | null
    }>(
      page => adminDb.from('pattern_trades')
        .select('status, rr, published_at, triggered, asset_class, symbol')
        .order('published_at', { ascending: false })
        .order('report_id', { ascending: false })
        .range(page * 1000, page * 1000 + 999),
      'pattern_trades',
    ),
    fetchAll<{
      status: string | null; rr: number | null; published_at: string | null; is_reiteration: boolean; triggered: boolean | null
      asset_class: string | null; symbol: string | null
    }>(
      page => adminDb.rpc('ai_trades_with_reiteration')
        .order('published_at', { ascending: false })
        .order('report_id', { ascending: false })
        .range(page * 1000, page * 1000 + 999),
      'ai_trades_with_reiteration',
    ),
  ])

  type MarketRow = { market_id: string; symbol: string; asset_class: string }
  const marketMap = new Map<string, MarketRow>(
    ((marketsResult.data ?? []) as MarketRow[]).map(m => [m.market_id, m])
  )

  const analystSignals: EnrichedSignal[] = analystRows
    .filter(t => t.published_at)
    .map(t => {
      const m = t.market_id ? marketMap.get(t.market_id) : null
      return {
        date: t.published_at!.slice(0, 10),
        rr: t.result_r ?? null,
        assetClass: m?.asset_class ?? null,
        symbol: m?.symbol ?? null,
      }
    })

  const patternSignals: EnrichedSignal[] = patternRows
    .filter(t => t.published_at)
    .map(t => ({
      date: t.published_at!.slice(0, 10),
      rr: t.status !== null && PATTERN_OUTCOME_STATUSES.has(t.status) && t.rr !== null ? t.rr : null,
      assetClass: t.asset_class ?? null,
      symbol: t.symbol ?? null,
    }))

  const aiDeduped = aiRows.filter(t => !t.is_reiteration)
  const aiReiterations = aiRows.length - aiDeduped.length
  const aiSignals: EnrichedSignal[] = aiDeduped
    .filter(t => t.published_at)
    .map(t => ({
      date: t.published_at!.slice(0, 10),
      rr: t.status !== null && AI_OUTCOME_STATUSES.has(t.status) && t.rr !== null ? t.rr : null,
      assetClass: t.asset_class ?? null,
      symbol: t.symbol ?? null,
    }))

  console.log('[combined] analyst signals sample:', analystSignals.slice(0, 3).map(s => ({ rr: s.rr })), 'withRR:', analystSignals.filter(s => s.rr !== null).length, 'of', analystSignals.length)
  const analyst: SignalTypeData = buildSignalTypeData(analystSignals, analystRows.length)
  const patterns: SignalTypeData = buildSignalTypeData(patternSignals, patternRows.length)
  const ai: SignalTypeData = buildSignalTypeData(aiSignals, aiRows.length)

  const byAssetClass = buildAssetClassBreakdown(analystSignals, patternSignals, aiSignals)
  const byDayOfWeek = buildDayOfWeekBreakdown(analystSignals, patternSignals, aiSignals)
  const byMonth = buildMonthBreakdown(analystSignals, patternSignals, aiSignals)
  const byYear = buildYearGrid(analystSignals, patternSignals, aiSignals)
  const topMarkets = buildTopMarkets(analystSignals, patternSignals, aiSignals, 20)

  return NextResponse.json({
    analyst,
    patterns,
    ai,
    aiReiterations,
    byAssetClass,
    byDayOfWeek,
    byMonth,
    byYear,
    topMarkets,
    combined: {
      summary: buildSignalTypeData(
        [...analystSignals, ...patternSignals, ...aiSignals],
        analystRows.length + patternRows.length + aiRows.length,
      ).summary,
      cumulativeR: mergeCumulativeSeries(analyst.cumulativeR, patterns.cumulativeR, ai.cumulativeR),
      normalisedCumulative: mergeCumulativeSeries(
        toIndexedCumulative(analyst.cumulativeR),
        toIndexedCumulative(patterns.cumulativeR),
        toIndexedCumulative(ai.cumulativeR),
      ),
    },
  })
  } catch (err) {
    if (err instanceof PaginationError) {
      console.error('[api/analytics/combined]', err.message)
      return NextResponse.json({ error: `Failed to load signal data: ${err.message}` }, { status: 502 })
    }
    throw err
  }
}