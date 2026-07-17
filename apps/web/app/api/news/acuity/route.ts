// apps/web/app/api/news/acuity/route.ts
// Fetches latest market headlines from Acuity MarketInsights API.
// Keeps credentials server-side. Caches bearer token for 12 hours.

import { NextRequest, NextResponse } from 'next/server'

// Symbol → Acuity asset ID mapping for all APIP markets
const SYMBOL_TO_ACUITY_ID: Record<string, number> = {
  // European session — FX
  EURUSD:        50,
  GBPUSD:        102738,
  USDJPY:        28,
  USDCAD:        102740,
  USDCHF:        102739,
  AUDUSD:        101828,
  AUDJPY:        102759,
  AUDCAD:        102758,
  EURGBP:        101831,
  EURJPY:        101826,
  EURCHF:        101827,
  EURSEK:        102763,
  EURNZD:        112976,
  GBPJPY:        102765,
  GBPCHF:        102764,
  USDMXN:        102771,
  USDTRY:        102773,
  // European session — Commodities
  Gold:          46,
  Silver:        22,
  Copper:        112973,
  Palladium:     112980,
  Platinum:      112981,
  Oil:           113189,
  Brent:         48,
  'NaturalGas':  112979,
  // European session — Indices
  FTSE:          56,
  DAX:           19,
  CAC:           102795,
  // US session — Indices
  DOW:           58,
  NASDAQ:        18,
  SP500:         102737,
  US2000:        115425,
  // US session — Crypto
  Bitcoin:       113052,
  Ethereum:      113061,
  Litecoin:      113062,
  Ripple:        113063,
  Solana:        115401,
  // APAC session — FX
  EURAUD:        102761,
  GBPAUD:        101834,
  GBPNZD:        114467,
  NZDJPY:        112974,
  NZDUSD:        102766,
  // APAC session — Indices
  NIKKEI:        6,
  ASX200:        112982,
  'CHINA A50':   113179,
}

// Simple in-memory token cache
let cachedToken: string | null = null
let tokenExpiry: number = 0

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  const username = process.env.ACUITY_USERNAME
  const password = process.env.ACUITY_PASSWORD
  if (!username || !password) throw new Error('Acuity credentials not configured')

  const res = await fetch('https://api.acuitytrading.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
  })

  if (!res.ok) throw new Error(`Acuity auth failed: ${res.status}`)
  const data = await res.json()
  cachedToken = data.access_token
  tokenExpiry = Date.now() + 12 * 60 * 60 * 1000 // 12 hours
  return cachedToken!
}

export async function POST(req: NextRequest) {
  try {
    const { symbols } = await req.json() as { symbols: string[] }
    if (!symbols?.length) return NextResponse.json({})

    const assetIds = [...new Set(
      symbols.map(s => SYMBOL_TO_ACUITY_ID[s]).filter(Boolean)
    )]

    if (!assetIds.length) return NextResponse.json({})

    const token = await getToken()
    const today = new Date().toISOString().slice(0, 10)
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)

    const res = await fetch('https://api.acuitytrading.com/api/marketinsights', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        StartDate: threeDaysAgo,
        EndDate: today,
        LanguageCode: 'en-gb',
        AssetIds: assetIds,
        Count: 200,
      }),
    })

    if (!res.ok) throw new Error(`Acuity API error: ${res.status}`)
    const articles = await res.json() as any[]

    // Reverse lookup: acuity_id → our symbol
    const idToSymbol = new Map(
      Object.entries(SYMBOL_TO_ACUITY_ID).map(([sym, id]) => [id, sym])
    )

    // Sort newest first, take latest headline per symbol
    const sorted = [...articles].sort((a, b) =>
      new Date(b.time_utc_publication).getTime() - new Date(a.time_utc_publication).getTime()
    )

    const headlineBySymbol: Record<string, string> = {}
    for (const article of sorted) {
      if (!article.acuity_id || !article.headline) continue
      const sym = idToSymbol.get(article.acuity_id)
      if (sym && !headlineBySymbol[sym]) {
        headlineBySymbol[sym] = article.headline
      }
    }

    return NextResponse.json(headlineBySymbol)
  } catch (err: any) {
    console.error('Acuity news error:', err.message)
    return NextResponse.json({}, { status: 500 })
  }
}
