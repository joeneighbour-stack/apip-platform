// Test Finnhub 5-minute OHLC availability and reconstruct APIP sessions
// Step A: confirm data path
// Steps B-E: reconstruct sessions, ATR20, today's bands, compare to TradingView

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY
if (!FINNHUB_API_KEY) { console.error('FINNHUB_API_KEY not set'); process.exit(1) }

const MARKETS = [
  { symbol: 'Gold',   finnhub: 'OANDA:XAU_USD', dp: 2 },
  { symbol: 'GBPUSD', finnhub: 'OANDA:GBP_USD', dp: 5 },
  { symbol: 'EURUSD', finnhub: 'OANDA:EUR_USD', dp: 5 },
  { symbol: 'USDJPY', finnhub: 'OANDA:USD_JPY', dp: 3 },
]

// TradingView reference
const TV = {
  'Gold':   { atr: 108.72, upper: 4126.19, lower: 3953.40 },
  'GBPUSD': { atr: 0.00774, upper: 1.3458,  lower: 1.3343  },
  'EURUSD': { atr: 0.00597, upper: 1.1470,  lower: 1.1384  },
  'USDJPY': { atr: 0.751,   upper: 162.71,  lower: 161.67  },
}

function wilderRMA(values, period) {
  const result = new Array(values.length).fill(NaN)
  const start = values.findIndex(v => !isNaN(v))
  if (start < 0 || start + period - 1 >= values.length) return result
  result[start + period - 1] = values.slice(start, start + period).reduce((a,b)=>a+b,0) / period
  for (let i = start + period; i < values.length; i++) {
    result[i] = (result[i-1] * 19 + values[i]) / 20
  }
  return result
}

async function fetch5min(finnhubSymbol, fromTs, toTs) {
  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=5&from=${fromTs}&to=${toTs}&token=${FINNHUB_API_KEY}`
  const res = await fetch(url)
  const body = await res.json()
  return { status: res.status, body }
}

const now    = Math.floor(Date.now() / 1000)
const ago7d  = now - 7  * 86400
const ago180d = now - 180 * 86400

console.log('STEP A — Confirm Finnhub 5-minute OHLC availability')
console.log('='.repeat(70))

for (const mkt of MARKETS) {
  // Test with a small window (last 2 days) first
  const testFrom = now - 2 * 86400
  const { status, body } = await fetch5min(mkt.finnhub, testFrom, now)
  const ok = status === 200 && body.s === 'ok' && Array.isArray(body.t) && body.t.length > 0
  console.log(`${mkt.symbol} (${mkt.finnhub}): HTTP ${status}, status=${body.s ?? 'n/a'}, bars=${body.t?.length ?? 0} ${ok ? '✓ AVAILABLE' : '✗ NOT AVAILABLE'}`)
  if (!ok && body.error) console.log(`  Error: ${body.error}`)
  await new Promise(r => setTimeout(r, 500))
}

console.log('\nSTEP B–E — Reconstruct APIP sessions and compute bands')
console.log('='.repeat(70))

for (const mkt of MARKETS) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${mkt.symbol}`)
  console.log('─'.repeat(60))

  // Fetch 180 days of 5-minute bars
  const { status, body } = await fetch5min(mkt.finnhub, ago180d, now)
  if (status !== 200 || body.s !== 'ok' || !body.t?.length) {
    console.log(`  ERROR: ${status} ${body.s ?? ''} ${body.error ?? ''}`)
    continue
  }

  const bars = body.t.map((t, i) => ({
    ts: t,
    o: body.o[i], h: body.h[i], l: body.l[i], c: body.c[i]
  })).filter(b => b.h > 0).sort((a,b) => a.ts - b.ts)

  console.log(`  Raw 5-min bars: ${bars.length}`)
  console.log(`  Earliest: ${new Date(bars[0].ts*1000).toISOString()}`)
  console.log(`  Latest:   ${new Date(bars[bars.length-1].ts*1000).toISOString()}`)

  // STEP B: Aggregate into APIP 22:00 UTC sessions
  // apip_date = date(timestamp_utc + 2h)
  const sessionMap = new Map()
  for (const bar of bars) {
    const shifted = new Date((bar.ts + 2*3600) * 1000)
    const apipDate = shifted.toISOString().slice(0,10)
    if (!sessionMap.has(apipDate)) {
      sessionMap.set(apipDate, { o: bar.o, h: bar.h, l: bar.l, c: bar.c, count: 1, firstTs: bar.ts, lastTs: bar.ts })
    } else {
      const s = sessionMap.get(apipDate)
      s.h = Math.max(s.h, bar.h)
      s.l = Math.min(s.l, bar.l)
      s.c = bar.c
      s.count++
      s.lastTs = bar.ts
    }
  }

  // Shift back 1 day: apip_date represents the session that OPENED on that date at 22:00 UTC
  // (the +2h shift means 2026-07-15 shifted date = session opened 2026-07-14 22:00 UTC)
  const allSessions = [...sessionMap.entries()]
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([apipDate, v]) => {
      const d = new Date(apipDate + 'T12:00:00Z')
      d.setDate(d.getDate() - 1)
      return { date: d.toISOString().slice(0,10), ...v }
    })

  // Minimum bars for a "complete" session — 5-min bars in 24h = 288, in 22h = 264
  // Use ≥240 (20h worth) to be consistent but flexible
  const MIN_BARS = 240
  const complete = allSessions.filter(s => s.count >= MIN_BARS)
  const partial  = allSessions.filter(s => s.count < MIN_BARS)

  console.log(`  Total APIP sessions: ${allSessions.length}`)
  console.log(`  Complete (≥${MIN_BARS} bars): ${complete.length}`)
  console.log(`  Partial (<${MIN_BARS} bars): ${partial.length}`)

  // STEP C: Compute ATR20 Wilder RMA on complete sessions
  const closes = complete.map(s => s.c)
  const trs = complete.map((s, i) => {
    if (i === 0) return s.h - s.l
    const pc = closes[i-1]
    return Math.max(s.h - s.l, Math.abs(s.h - pc), Math.abs(s.l - pc))
  })
  const atrs = wilderRMA(trs, 20)

  // Today's session
  const todayDate = new Date()
  // Current APIP session date = date of session that opened most recently at 22:00 UTC
  // If current UTC time < 22:00, today's APIP session opened yesterday
  const nowUtcH = new Date().getUTCHours()
  const sessionOpenDate = new Date()
  if (nowUtcH < 22) sessionOpenDate.setDate(sessionOpenDate.getDate() - 1)
  const todayKey = sessionOpenDate.toISOString().slice(0,10)

  // Previous completed session
  const prevEntries = complete.map((s,i) => ({s,i})).filter(({s}) => s.date < todayKey)
  if (prevEntries.length < 20) { console.log('  Insufficient history for ATR'); continue }
  const { s: prev, i: prevI } = prevEntries[prevEntries.length - 1]
  const prevAtr = atrs[prevI]

  // STEP D: Today's developing session h/l from 5-min bars
  const curr = allSessions.find(s => s.date === todayKey)

  const dp = mkt.dp
  console.log(`\n  STEP C — Previous completed session:`)
  console.log(`    Date:  ${prev.date}`)
  console.log(`    Close: ${prev.c.toFixed(dp)}`)
  console.log(`    ATR20: ${prevAtr?.toFixed(dp) ?? 'n/a'} (Wilder RMA, complete sessions only)`)
  console.log(`    Bars:  ${prev.count}`)

  if (curr) {
    console.log(`\n  STEP D — Today's APIP session (${todayKey}):`)
    console.log(`    Bars so far: ${curr.count}`)
    console.log(`    High so far: ${curr.h.toFixed(dp)}`)
    console.log(`    Low so far:  ${curr.l.toFixed(dp)}`)
    console.log(`    Current:     ${curr.c.toFixed(dp)}`)
  } else {
    console.log(`  No bars yet for today's session (${todayKey})`)
  }

  if (prevAtr && curr) {
    // STEP E: Pine-style bands
    const bottom = Math.min(prev.c, curr.l)
    const top    = Math.max(prev.c, curr.h)
    const upper  = bottom + prevAtr
    const lower  = top    - prevAtr
    const bw     = upper - lower
    const step   = bw / 4

    const tv = TV[mkt.symbol]
    const tvBottom = tv.upper - tv.atr
    const tvTop    = tv.lower + tv.atr

    console.log(`\n  STEP E — Pine-style bands:`)
    console.log(`    bottom_anchor = min(${prev.c.toFixed(dp)}, ${curr.l.toFixed(dp)}) = ${bottom.toFixed(dp)}`)
    console.log(`    top_anchor    = max(${prev.c.toFixed(dp)}, ${curr.h.toFixed(dp)}) = ${top.toFixed(dp)}`)
    console.log(`    upper_band    = ${bottom.toFixed(dp)} + ${prevAtr.toFixed(dp)} = ${upper.toFixed(dp)}`)
    console.log(`    lower_band    = ${top.toFixed(dp)} - ${prevAtr.toFixed(dp)} = ${lower.toFixed(dp)}`)
    console.log(`    ZONE_1: ${lower.toFixed(dp)} – ${(lower+step).toFixed(dp)}`)
    console.log(`    ZONE_2: ${(lower+step).toFixed(dp)} – ${(lower+2*step).toFixed(dp)}`)
    console.log(`    ZONE_3: ${(lower+2*step).toFixed(dp)} – ${(lower+3*step).toFixed(dp)}`)
    console.log(`    ZONE_4: ${(lower+3*step).toFixed(dp)} – ${upper.toFixed(dp)}`)

    console.log(`\n  Comparison vs TradingView/OANDA:`)
    console.log(`    ATR:   5min=${prevAtr.toFixed(dp)}  TV=${tv.atr.toFixed(dp)}  diff=${(prevAtr-tv.atr).toFixed(dp)} (${((prevAtr-tv.atr)/tv.atr*100).toFixed(2)}%)`)
    console.log(`    upper: 5min=${upper.toFixed(dp)}  TV=${tv.upper.toFixed(dp)}  diff=${(upper-tv.upper).toFixed(dp)}`)
    console.log(`    lower: 5min=${lower.toFixed(dp)}  TV=${tv.lower.toFixed(dp)}  diff=${(lower-tv.lower).toFixed(dp)}`)
    console.log(`    todayH: 5min=${curr.h.toFixed(dp)}  TV=${tvTop.toFixed(dp)}  diff=${(curr.h-tvTop).toFixed(dp)}`)
    console.log(`    todayL: 5min=${curr.l.toFixed(dp)}  TV=${tvBottom.toFixed(dp)}  diff=${(curr.l-tvBottom).toFixed(dp)}`)

    const atrPct = Math.abs(prevAtr-tv.atr)/tv.atr*100
    const upperDiff = Math.abs(upper-tv.upper)
    const lowerDiff = Math.abs(lower-tv.lower)
    const verdict = atrPct < 1 && upperDiff < tv.atr * 0.02 && lowerDiff < tv.atr * 0.02
      ? '✓ PASS' : '✗ INVESTIGATE'
    console.log(`    VERDICT: ${verdict}`)
  }

  await new Promise(r => setTimeout(r, 1000))
}

console.log('\n' + '='.repeat(70))
