// ATR Source Reconciliation Script
// Compares ATR20 from:
//   A) Acuity hourly data aggregated to 22:00 UTC APIP sessions
//   B) market_state_daily (Finnhub OANDA daily candles) -- proxy for TradingView
// Reports behavioural impact on zone classification

import { createClient } from '@supabase/supabase-js'

const ACUITY_API_KEY   = process.env.ACUITY_API_KEY
const SUPABASE_URL     = process.env.SUPABASE_URL
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY
const ACUITY_PRICE_URL = 'https://dashboard.acuitytrading.com/PriceApi/GetExtendedPriceSentimentData'

if (!ACUITY_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars: ACUITY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

const MARKETS = [
  { symbol: 'Gold',   assetId: 46,     dp: 2 },
  { symbol: 'GBPUSD', assetId: 102738, dp: 5 },
  { symbol: 'EURUSD', assetId: 50,     dp: 5 },
  { symbol: 'USDJPY', assetId: 28,     dp: 3 },
]

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

function computeAtr(sessions, period=20) {
  const closes = sessions.map(s => s.c)
  const highs  = sessions.map(s => s.h)
  const lows   = sessions.map(s => s.l)
  const trs = sessions.map((s, i) => {
    if (i === 0) return s.h - s.l
    const pc = closes[i-1]
    return Math.max(s.h - s.l, Math.abs(s.h - pc), Math.abs(s.l - pc))
  })
  return wilderRMA(trs, period)
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

// Fetch Acuity hourly data and aggregate to 22:00 UTC sessions
async function fetchAcuitySessions(assetId) {
  const endDate   = new Date().toISOString().slice(0,10)
  const startDate = new Date(Date.now() - 90*24*60*60*1000).toISOString().slice(0,10)
  const body = new URLSearchParams({
    startDate, endDate, assetId: String(assetId), interval: '0'
  })
  const res = await fetch(`${ACUITY_PRICE_URL}?apikey=${ACUITY_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!res.ok) throw new Error(`Acuity HTTP ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('Unexpected response shape')

  const rows = data.map(d => ({
    datetime: new Date(d.date),
    h: Number(d.p.h), l: Number(d.p.l), c: Number(d.p.c),
  })).filter(r => !isNaN(r.h)).sort((a,b) => a.datetime - b.datetime)

  // Aggregate to 22:00 UTC sessions
  const sessionMap = new Map()
  for (const row of rows) {
    const shifted = new Date(row.datetime.getTime() + 2*60*60*1000)
    const fxDate  = shifted.toISOString().slice(0,10)
    if (!sessionMap.has(fxDate)) {
      sessionMap.set(fxDate, { h: row.h, l: row.l, c: row.c, count: 1 })
    } else {
      const s = sessionMap.get(fxDate)
      s.h = Math.max(s.h, row.h); s.l = Math.min(s.l, row.l)
      s.c = row.c; s.count++
    }
  }

  return [...sessionMap.entries()]
  // Shift date back 1 day: Acuity fxDate is next calendar day after 22:00 UTC session open
  // market_state_daily uses the session open date (e.g. Jul 14 for the 22:00 Jul 14 session)
    .sort(([a],[b]) => a.localeCompare(b))
    .filter(([,v]) => v.count >= 20)
    .map(([date, v]) => {
      const d = new Date(date + 'T12:00:00Z')
      d.setDate(d.getDate() - 1)
      return { date: d.toISOString().slice(0,10), ...v }
    })
}

// Fetch market_state_daily data (Finnhub OANDA -- proxy for TradingView)
async function fetchDailySessions(symbol) {
  const { data, error } = await db
    .from('market_state_daily')
    .select('date, high, low, close')
    .eq('market_id', await getMarketId(symbol))
    .order('date', { ascending: true })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => ({
    date: r.date,
    h: Number(r.high), l: Number(r.low), c: Number(r.close)
  }))
}

const marketIdCache = {}
async function getMarketId(symbol) {
  if (marketIdCache[symbol]) return marketIdCache[symbol]
  const { data } = await db.from('markets').select('market_id').eq('symbol', symbol).single()
  marketIdCache[symbol] = data.market_id
  return data.market_id
}

console.log('ATR Source Reconciliation — Acuity Sessions vs Finnhub Daily (TradingView proxy)\n')
console.log('='.repeat(80))

for (const mkt of MARKETS) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${mkt.symbol}`)
  console.log('─'.repeat(60))

  try {
    const [acuitySessions, dailySessions] = await Promise.all([
      fetchAcuitySessions(mkt.assetId),
      fetchDailySessions(mkt.symbol),
    ])

    console.log(`Acuity complete sessions: ${acuitySessions.length}`)
    console.log(`Finnhub daily rows:       ${dailySessions.length}`)

    // Compute ATR20 for both
    const acuityAtrs = computeAtr(acuitySessions, 20)
    const dailyAtrs  = computeAtr(dailySessions, 20)

    // Build lookup maps by date
    const acuityByDate = new Map(acuitySessions.map((s,i) => [s.date, { ...s, atr: acuityAtrs[i] }]))
    const dailyByDate  = new Map(dailySessions.map((s,i)  => [s.date, { ...s, atr: dailyAtrs[i]  }]))

    // Find common dates with valid ATR from both sources (last 20)
    const commonDates = [...acuityByDate.keys()]
      .filter(d => dailyByDate.has(d))
      .filter(d => {
        const a = acuityByDate.get(d); const b = dailyByDate.get(d)
        return !isNaN(a.atr) && !isNaN(b.atr)
      })
      .slice(-25) // last 25 common dates

    if (commonDates.length < 10) {
      console.log(`Insufficient common dates: ${commonDates.length}`)
      continue
    }

    console.log(`\nCommon dates with valid ATR20: ${commonDates.length}`)
    console.log(`\nDate       | Acuity ATR20 | Daily ATR20  | Abs Diff  | % Diff | Zone Change`)
    console.log('─'.repeat(80))

    const results = []
    for (const date of commonDates) {
      const a = acuityByDate.get(date)
      const d = dailyByDate.get(date)

      // Get next session's data to compute bands
      const nextDateIdx = commonDates.indexOf(date) + 1
      if (nextDateIdx >= commonDates.length) continue
      const nextDate = commonDates[nextDateIdx]
      const nextAcuity = acuityByDate.get(nextDate)
      const nextDaily  = dailyByDate.get(nextDate)
      if (!nextAcuity || !nextDaily) continue

      // Pine-style bands using each ATR source
      // prev = current row, curr = next session high/low
      const prevCloseAcuity = a.c
      const prevCloseDaily  = d.c
      const currH = nextAcuity.h  // use Acuity session h/l for both (same h/l, only ATR differs)
      const currL = nextAcuity.l

      // Acuity ATR bands
      const bottomA = Math.min(prevCloseAcuity, currL)
      const topA    = Math.max(prevCloseAcuity, currH)
      const upperA  = bottomA + a.atr
      const lowerA  = topA    - a.atr

      // Daily ATR bands (using daily close as prev_close)
      const bottomD = Math.min(prevCloseDaily, currL)
      const topD    = Math.max(prevCloseDaily, currH)
      const upperD  = bottomD + d.atr
      const lowerD  = topD    - d.atr

      // Use next session's close as the "current price" for zone classification
      const price = nextAcuity.c

      const zoneA = classifyZone(price, lowerA, upperA)
      const zoneD = classifyZone(price, lowerD, upperD)
      const zoneChanged = zoneA !== zoneD

      const absDiff = Math.abs(a.atr - d.atr)
      const pctDiff = (absDiff / d.atr) * 100

      results.push({
        date, atrAcuity: a.atr, atrDaily: d.atr,
        absDiff, pctDiff,
        upperDiff: Math.abs(upperA - upperD),
        lowerDiff: Math.abs(lowerA - lowerD),
        zoneA, zoneD, zoneChanged
      })

      const dp = mkt.dp
      const zoneFlag = zoneChanged ? `${zoneA} vs ${zoneD} ← CHANGED` : zoneA
      console.log(
        `${nextDate} | ${a.atr.toFixed(dp).padStart(12)} | ${d.atr.toFixed(dp).padStart(12)} | ` +
        `${absDiff.toFixed(dp).padStart(9)} | ${pctDiff.toFixed(1).padStart(5)}% | ${zoneFlag}`
      )
    }

    if (results.length === 0) { console.log('No results'); continue }

    const pcts = results.map(r => r.pctDiff).sort((a,b) => a-b)
    const median = pcts[Math.floor(pcts.length/2)]
    const p90    = pcts[Math.floor(pcts.length * 0.9)]
    const max    = pcts[pcts.length-1]
    const zoneChanges = results.filter(r => r.zoneChanged).length

    console.log(`\nSUMMARY for ${mkt.symbol}:`)
    console.log(`  Dates compared:              ${results.length}`)
    console.log(`  Median ATR % error:          ${median.toFixed(2)}%`)
    console.log(`  90th percentile ATR % error: ${p90.toFixed(2)}%`)
    console.log(`  Maximum ATR % error:         ${max.toFixed(2)}%`)
    console.log(`  Zone classification changes: ${zoneChanges}/${results.length} (${(zoneChanges/results.length*100).toFixed(1)}%)`)
    console.log(`  Median upper_band diff:      ${results.map(r=>r.upperDiff).sort((a,b)=>a-b)[Math.floor(results.length/2)].toFixed(mkt.dp)}`)
    console.log(`  Median lower_band diff:      ${results.map(r=>r.lowerDiff).sort((a,b)=>a-b)[Math.floor(results.length/2)].toFixed(mkt.dp)}`)

    const verdict = max < 3 && zoneChanges / results.length < 0.1
      ? 'PASS — Acuity ATR20 behaviourally equivalent to Finnhub/TradingView'
      : 'REVIEW — differences exceed acceptable threshold'
    console.log(`  VERDICT: ${verdict}`)

  } catch(e) {
    console.error(`  Error: ${e.message}`)
  }
}

console.log('\n' + '='.repeat(80))
console.log('Reconciliation complete.')
