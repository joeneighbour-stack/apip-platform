import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const FIELDS = `trade_id, analyst_id, direction, result_r,
    triggered, published_at, historical_backfill,
    market:market_id ( market_id, symbol, asset_class )`

  const allTrades: any[] = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('actual_trades')
      .select(FIELDS)
      .gte('published_at', '2017-01-01T00:00:00Z')
      .order('published_at', { ascending: false })
      .range(page * 1000, page * 1000 + 999)

    if (error || !data?.length) {
      hasMore = false
    } else {
      allTrades.push(...data)
      hasMore = data.length === 1000
      page++
    }

    if (allTrades.length >= 35000) break
  }

  return NextResponse.json(allTrades)
}
