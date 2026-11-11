// apps/web/app/api/prices/live/route.ts
// Returns current prices for a list of market symbols from Azure Table Storage
// 5-minute bars (latest close) -- the only price source. A market with no
// Azure data is left out of the response and logged as DEGRADED; no other
// source is ever used. Called by the useLivePrices hook.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { getLatestAzurePrice } from '@/lib/azurePrices'

export async function POST(req: NextRequest) {
  // Already implicitly gated by RLS (markets_select_all requires auth.uid() is
  // not null), but explicit for defense in depth and consistency with every
  // other data-serving route. Called before the try/catch below so an
  // unauthenticated redirect isn't swallowed by the generic catch-all.
  await getCurrentUser()

  try {
    const { symbols } = await req.json() as { symbols: string[] }
    if (!symbols?.length) return NextResponse.json({})

    // Fetch price_data_symbol for each requested market symbol
    const supabase = await createClient()
    const { data: markets } = await supabase
      .from('markets')
      .select('symbol, price_data_symbol')
      .in('symbol', symbols)

    if (!markets?.length) return NextResponse.json({})

    // Fetch prices in parallel
    const results = await Promise.all(
      markets.map(async (m) => {
        if (!m.price_data_symbol) return { symbol: m.symbol, price: null }
        const latest = await getLatestAzurePrice(m.price_data_symbol)
        if (latest.status === 'degraded') {
          console.error(`DEGRADED: ${m.symbol} (${m.price_data_symbol}) -- ${latest.reason}. Live price omitted; no other source used.`)
          return { symbol: m.symbol, price: null }
        }
        return { symbol: m.symbol, price: latest.price }
      })
    )

    const priceMap: Record<string, number> = {}
    for (const { symbol, price } of results) {
      if (price !== null) priceMap[symbol] = price
    }

    return NextResponse.json(priceMap)
  } catch (err: any) {
    console.error('Live prices error:', err.message)
    return NextResponse.json({})
  }
}
