// APIP ATR Zone Validation Worksheet
// Outputs canonical Acuity-derived band values for manual TradingView/OANDA comparison
// Run: node validation-worksheet.mjs

const ACUITY_API_KEY   = process.env.ACUITY_API_KEY
const ACUITY_PRICE_URL = 'https://dashboard.acuitytrading.com/PriceApi/GetExtendedPriceSentimentData'

if (!ACUITY_API_KEY) { console.error('ACUITY_API_KEY not set'); process.exit(1) }

const MARKETS = [
  { symbol: 'Gold',   assetId: 46,     dp: 2 },
  { symbol: 'GBPUSD', assetId: 102738, dp: 5 },
  { symbol: 'EURUSD', assetId: 50,     dp: 5 },
  { symbol: 'USDJPY', assetId: 28,     dp: 3 },
]

// Finnhub ATR20 from market_state_daily (NON-CANONICAL -- different session boundary)
// Pre-populated from Supabase query run today
const FINNHUB_ATR = {
  'Gold':   { atr20: 108.72, close: 4053.05 },  // approx from TradingView reference
  'GBPUSD': { atr20: 0.00774, close: 1.33827 },
  'EURUSD': { atr20: 0.00596, close: 1.13801 },
  'USDJPY': { atr20: 0.70975, close: 162.422 },
}

function wilderRMA(values, period) {
  const result = new Array(values.length).fill(NaN)
  const start = values.findIndex(v => !isNaN(v))
  if (start < 0 || start + period - 1 >= values.length) return result
  result[start + period - 1] = values.slice(start, start + period).reduce((a,b) => a+b, 0) / period
  for (let i = start + period; i < values.length; i++) {
    result[i] = (result[i-1] * (period-1) + values[i]) / period
  }
  return result
}

function classifyZone(price, lowerBand, upperBand) {
  if (isNaN(lowerBand) || isNaN(upperBand) || upperBand <= lowerBand) return 'INVALID'
  const bw = upperBand - lowerBand
  const step = bw / 4
  if (price < lowerBand)              return 'TOO_DEEP'
  if (price <= lowerBand + step)      return 'ZONE_1'
  if (price <= lowerBand + 2*step)    return 'ZONE_2'
  if (price <= lowerBand + 3*step)    return 'ZONE_3'
  if (price <= upperBand)             return 'ZONE_4'
  return 'TOO_HIGH'
}

const endDate   = new Date().toISOString().slice(0,10)
const startDate = new Date(Date.now() - 180*24*60*60*1000).toISOString().slice(0,10)

for (const mkt of MARKETS) {
  const body = new URLSearchParams({
    startDate, endDate, assetId: String(mkt.assetId), interval: '0'
  })
  const res = await fetch(`${ACUITY_PRICE_URL}?apikey=${ACUITY_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
  })
  const data = await res.json()

  // Parse and aggregate to 22:00 UTC sessions
  const rows = data
    .filter(d => d.p)
    .map(d => ({ dt: new Date(d.date), h: Number(d.p.h), l: Number(d.p.l), c: Number(d.p.c) }))
    .filter(r => !isNaN(r.h))
    .sort((a,b) => a.dt - b.dt)

  const sessionMap = new Map()
  for (const row of rows) {
    const shifted = new Date(row.dt.getTime() + 2*60*60*1000)
    const fxDate  = shifted.toISOString().slice(0,10)
    if (!sessionMap.has(fxDate)) {
      sessionMap.set(fxDate, { h: row.h, l: row.l, c: row.c, count: 1, firstDt: row.dt })
    } else {
      const s = sessionMap.get(fxDate)
      s.h = Math.max(s.h, row.h); s.l = Math.min(s.l, row.l)
      s.c = row.c; s.count++
    }
  }

  // Shift fxDate back 1 day to align with APIP session open date convention
  const allSessions = [...sessionMap.entries()]
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([date, v]) => {
      const d = new Date(date + 'T12:00:00Z')
      d.setDate(d.getDate() - 1)
      return { date: d.toISOString().slice(0,10), ...v }
    })

  const completeSessions = allSessions.filter(s => s.count >= 20)

  // Compute ATR20 Wilder RMA on complete sessions
  const closes = completeSessions.map(s => s.c)
  const trs = completeSessions.map((s, i) => {
    if (i === 0) return s.h - s.l
    return Math.max(s.h - s.l, Math.abs(s.h - closes[i-1]), Math.abs(s.l - closes[i-1]))
  })
  const atrs = wilderRMA(trs, 20)

  // Today's session key
  const nowShifted = new Date(Date.now() + 2*60*60*1000)
  const shiftedBack = new Date(nowShifted)
  shiftedBack.setDate(shiftedBack.getDate() - 1)
  const todayKey = shiftedBack.toISOString().slice(0,10)

  // Previous completed session (last complete session before today)
  const prevIdx = completeSessions.map((s,i) => ({s,i}))
    .filter(({s}) => s.date < todayKey)
    .slice(-1)[0]

  if (!prevIdx) { console.log(`${mkt.symbol}: No previous session found`); continue }
  const { s: prevSession, i: prevI } = prevIdx
  const prevAtr = atrs[prevI]

  // Current developing session (today, any bar count)
  const currSession = allSessions.find(s => s.date === todayKey)

  const dp = mkt.dp

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`MARKET: ${mkt.symbol}`)
  console.log(`Engine date: ${todayKey}`)
  console.log(`${'═'.repeat(70)}`)
  console.log(``)
  console.log(`ACUITY 22:00 UTC SESSION DATA (CANONICAL)`)
  console.log(`─────────────────────────────────────────`)
  console.log(`Reference session date:      ${prevSession.date}`)
  console.log(`Previous session close:      ${prevSession.c.toFixed(dp)}`)
  console.log(`Previous ATR20 (Wilder RMA): ${prevAtr?.toFixed(dp) ?? 'n/a'}`)
  console.log(``)

  if (currSession) {
    console.log(`Current session date:        ${todayKey} [${currSession.count} bars so far]`)
    console.log(`Current session high:        ${currSession.h.toFixed(dp)}`)
    console.log(`Current session low:         ${currSession.l.toFixed(dp)}`)
    console.log(`Current price (latest):      ${currSession.c.toFixed(dp)}`)
  } else {
    console.log(`Current session:             No data yet`)
  }

  if (prevAtr && currSession) {
    const prevClose   = prevSession.c
    const todayHigh   = currSession.h
    const todayLow    = currSession.l
    const currentPrice = currSession.c

    const bottomAnchor = Math.min(prevClose, todayLow)
    const topAnchor    = Math.max(prevClose, todayHigh)
    const upperBand    = bottomAnchor + prevAtr
    const lowerBand    = topAnchor    - prevAtr
    const bw           = upperBand - lowerBand
    const step         = bw / 4
    const z1top = lowerBand + step
    const z2top = lowerBand + 2*step
    const z3top = lowerBand + 3*step
    const zone = classifyZone(currentPrice, lowerBand, upperBand)

    console.log(``)
    console.log(`PINE-STYLE BAND CALCULATION`)
    console.log(`─────────────────────────────────────────`)
    console.log(`bottom_anchor = min(${prevClose.toFixed(dp)}, ${todayLow.toFixed(dp)}) = ${bottomAnchor.toFixed(dp)}`)
    console.log(`top_anchor    = max(${prevClose.toFixed(dp)}, ${todayHigh.toFixed(dp)}) = ${topAnchor.toFixed(dp)}`)
    console.log(``)
    console.log(`upper_band = ${bottomAnchor.toFixed(dp)} + ${prevAtr.toFixed(dp)} = ${upperBand.toFixed(dp)}`)
    console.log(`lower_band = ${topAnchor.toFixed(dp)} - ${prevAtr.toFixed(dp)} = ${lowerBand.toFixed(dp)}`)
    console.log(`band_width = ${bw.toFixed(dp)}`)
    console.log(``)
    console.log(`ZONE 1: ${lowerBand.toFixed(dp)} – ${z1top.toFixed(dp)}`)
    console.log(`ZONE 2: ${z1top.toFixed(dp)} – ${z2top.toFixed(dp)}`)
    console.log(`ZONE 3: ${z2top.toFixed(dp)} – ${z3top.toFixed(dp)}`)
    console.log(`ZONE 4: ${z3top.toFixed(dp)} – ${upperBand.toFixed(dp)}`)
    console.log(``)
    console.log(`Current price: ${currentPrice.toFixed(dp)}  →  ${zone}`)

    const finn = FINNHUB_ATR[mkt.symbol]
    if (finn) {
      console.log(``)
      console.log(`NON-CANONICAL COMPARISON — Finnhub daily (different session boundary)`)
      console.log(`─────────────────────────────────────────`)
      console.log(`Finnhub prev close:   ${finn.close.toFixed(dp)}   (midnight UTC boundary)`)
      console.log(`Finnhub ATR20:        ${finn.atr20.toFixed(dp)}   (computed from midnight-UTC candles)`)
      const fBottomAnchor = Math.min(finn.close, todayLow)
      const fTopAnchor    = Math.max(finn.close, todayHigh)
      const fUpper = fBottomAnchor + finn.atr20
      const fLower = fTopAnchor    - finn.atr20
      const fbw = fUpper - fLower
      const fstep = fbw / 4
      console.log(`Finnhub upper_band:   ${fUpper.toFixed(dp)}`)
      console.log(`Finnhub lower_band:   ${fLower.toFixed(dp)}`)
      console.log(`Finnhub ZONE 1:       ${fLower.toFixed(dp)} – ${(fLower+fstep).toFixed(dp)}`)
      console.log(`Finnhub ZONE 2:       ${(fLower+fstep).toFixed(dp)} – ${(fLower+2*fstep).toFixed(dp)}`)
      console.log(`Finnhub ZONE 3:       ${(fLower+2*fstep).toFixed(dp)} – ${(fLower+3*fstep).toFixed(dp)}`)
      console.log(`Finnhub ZONE 4:       ${(fLower+3*fstep).toFixed(dp)} – ${fUpper.toFixed(dp)}`)
      console.log(`Finnhub zone:         ${classifyZone(currentPrice, fLower, fUpper)}`)
    }
  }

  await new Promise(r => setTimeout(r, 500))
}

console.log(`\n${'═'.repeat(70)}`)
console.log(`Please verify Acuity values against TradingView/OANDA manually.`)
console.log(`Check: previous close, ATR20, today high/low, upper/lower band, zones.`)
