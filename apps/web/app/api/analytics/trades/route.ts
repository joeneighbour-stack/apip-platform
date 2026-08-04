import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Safety valve only -- the actual bound on result size is the `from` date filter, not
// this cap. Raised from the previous 35,000 so "Since Inception" queries have headroom
// to grow with the business rather than silently truncating.
const MAX_ROWS = 150_000

export async function GET(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const to = url.searchParams.get('to')
  const supabase = await createClient()

  const FIELDS = `trade_id, analyst_id, direction, result_r,
    triggered, published_at, closed_at, expiry, historical_backfill, source_system, session,
    market:market_id ( market_id, symbol, asset_class )`

  const allTrades: any[] = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    let query = supabase
      .from('actual_trades')
      .select(FIELDS)
      .gte('published_at', from + 'T00:00:00Z')
    if (to) query = query.lte('published_at', to + 'T23:59:59Z')

    const { data, error } = await query
      .order('published_at', { ascending: false })
      .order('trade_id', { ascending: false })
      .range(page * 1000, page * 1000 + 999)

    if (error || !data?.length) {
      hasMore = false
    } else {
      allTrades.push(...data)
      hasMore = data.length === 1000
      page++
    }

    if (allTrades.length >= MAX_ROWS) break
  }

  return NextResponse.json(allTrades)
}


