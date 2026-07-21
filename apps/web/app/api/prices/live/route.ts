// apps/web/app/api/prices/live/route.ts
// Returns current prices for a list of symbols using Finnhub quote API.
// Keeps API key server-side. Called by useLivePrices hook every 30 seconds.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const FINNHUB_KEY = process.env.FINNHUB_CANDLE_API_KEY

async function getQuote(symbol: string, isCrypto: boolean): Promise<number | null> {
  try {
    const endpoint = isCrypto
      ? `https://finnhub.io/api/v1/crypto/candle?symbol=${encodeURIComponent(symbol)}&resolution=1&from=${Math.floor(Date.now()/1000)-120}&to=${Math.floor(Date.now()/1000)}&token=${FINNHUB_KEY}`
      : `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(symbol)}&resolution=1&from=${Math.floor(Date.now()/1000)-120}&to=${Math.floor(Date.now()/1000)}&token=${FINNHUB_KEY}`

    const res = await fetch(endpoint, { next: { revalidate: 0 } })
    if (!res.ok) return null
    const data = await res.json()
    // Return latest close price
    if (data.s === 'ok' && data.c?.length > 0) {
      return data.c[data.c.length - 1]
    }
    return null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  if (!FINNHUB_KEY) return NextResponse.json({})

  try {
    const { symbols } = await req.json() as { symbols: string[] }
    if (!symbols?.length) return NextResponse.json({})

    // Fetch price_data_symbol for each requested market symbol
    const supabase = await createClient()
    const { data: markets } = await supabase
      .from('markets')
      .select('symbol, asset_class, price_data_symbol')
      .in('symbol', symbols)

    if (!markets?.length) return NextResponse.json({})

    // Fetch prices in parallel
    const results = await Promise.all(
      markets.map(async (m) => {
        if (!m.price_data_symbol) return { symbol: m.symbol, price: null }
        const isCrypto = m.asset_class === 'CRYPTO'
        const price = await getQuote(m.price_data_symbol, isCrypto)
        return { symbol: m.symbol, price }
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
