// Gold Acuity Asset Investigation
// Investigates assetId=46 and searches for alternative Gold/XAU assets

const ACUITY_API_KEY   = process.env.ACUITY_API_KEY
const ACUITY_PRICE_URL = 'https://dashboard.acuitytrading.com/PriceApi/GetExtendedPriceSentimentData'

if (!ACUITY_API_KEY) { console.error('ACUITY_API_KEY not set'); process.exit(1) }

const endDate   = new Date().toISOString().slice(0,10)
const startDate = new Date(Date.now() - 180*24*60*60*1000).toISOString().slice(0,10)
const startDate7 = new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0,10)

// TradingView reference values
const TV_REF = { atr: 108.72, upper: 4126.19, lower: 3953.40 }
const TV_BOTTOM = TV_REF.upper - TV_REF.atr  // 4017.47
const TV_TOP    = TV_REF.lower + TV_REF.atr  // 4062.12

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

async function fetchAsset(assetId, days=180) {
  const start = new Date(Date.now() - days*24*60*60*1000).toISOString().slice(0,10)
  const body = new URLSearchParams({
    startDate: start, endDate,
    assetId: String(assetId), interval: '0'
  })
  const res = await fetch(`${ACUITY_PRICE_URL}?apikey=${ACUITY_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
  })
  if (!res.ok) return null
  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) return null
  return data
}

function buildSessions(data) {
  const rows = data
    .filter(d => d.p)
    .map(d => ({ dt: new Date(d.date), h: Number(d.p.h), l: Number(d.p.l), c: Number(d.p.c) }))
    .filter(r => !isNaN(r.h) && r.h > 0)
    .sort((a,b) => a.dt - b.dt)

  const sessionMap = new Map()
  for (const row of rows) {
    const shifted = new Date(row.dt.getTime() + 2*60*60*1000)
    const fxDate  = shifted.toISOString().slice(0,10)
    if (!sessionMap.has(fxDate)) {
      sessionMap.set(fxDate, { h: row.h, l: row.l, c: row.c, count: 1, firstDt: row.dt, lastDt: row.dt })
    } else {
      const s = sessionMap.get(fxDate)
      s.h = Math.max(s.h, row.h); s.l = Math.min(s.l, row.l)
      s.c = row.c; s.count++; s.lastDt = row.dt
    }
  }

  // Shift back 1 day
  return [...sessionMap.entries()]
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([date, v]) => {
      const d = new Date(date + 'T12:00:00Z')
      d.setDate(d.getDate() - 1)
      return { date: d.toISOString().slice(0,10), ...v }
    })
}

function computeZoneStats(sessions) {
  const complete = sessions.filter(s => s.count >= 20)
  if (complete.length < 21) return null

  const closes = complete.map(s => s.c)
  const trs = complete.map((s,i) => {
    if (i === 0) return s.h - s.l
    return Math.max(s.h - s.l, Math.abs(s.h - closes[i-1]), Math.abs(s.l - closes[i-1]))
  })
  const atrs = wilderRMA(trs, 20)

  // Today's session key
  const nowShifted = new Date(Date.now() + 2*60*60*1000)
  const shiftedBack = new Date(nowShifted)
  shiftedBack.setDate(shiftedBack.getDate() - 1)
  const todayKey = shiftedBack.toISOString().slice(0,10)

  // Previous completed session
  const prevEntries = complete.map((s,i) => ({s,i})).filter(({s}) => s.date < todayKey)
  if (prevEntries.length === 0) return null
  const { s: prev, i: prevI } = prevEntries[prevEntries.length - 1]
  const prevAtr = atrs[prevI]

  // Current developing session
  const curr = sessions.find(s => s.date === todayKey)

  return { prev, prevAtr, curr, complete: complete.length, todayKey }
}

function printBands(label, prev, prevAtr, curr, dp=2) {
  if (!prev || !prevAtr || !curr) return
  const bottom = Math.min(prev.c, curr.l)
  const top    = Math.max(prev.c, curr.h)
  const upper  = bottom + prevAtr
  const lower  = top    - prevAtr
  const bw     = upper - lower
  const step   = bw / 4

  console.log(`  ${label}:`)
  console.log(`    prevClose=${prev.c.toFixed(dp)}, ATR20=${prevAtr.toFixed(dp)}`)
  console.log(`    currH=${curr.h.toFixed(dp)}, currL=${curr.l.toFixed(dp)} [${curr.count} bars]`)
  console.log(`    bottom_anchor=${bottom.toFixed(dp)}, top_anchor=${top.toFixed(dp)}`)
  console.log(`    upper_band=${upper.toFixed(dp)}, lower_band=${lower.toFixed(dp)}`)
  console.log(`    ZONE1: ${lower.toFixed(dp)}–${(lower+step).toFixed(dp)}`)
  console.log(`    ZONE2: ${(lower+step).toFixed(dp)}–${(lower+2*step).toFixed(dp)}`)
  console.log(`    ZONE3: ${(lower+2*step).toFixed(dp)}–${(lower+3*step).toFixed(dp)}`)
  console.log(`    ZONE4: ${(lower+3*step).toFixed(dp)}–${upper.toFixed(dp)}`)
  console.log(`    vs TradingView: ATR diff ${((prevAtr-TV_REF.atr)/TV_REF.atr*100).toFixed(2)}%  upper diff ${(upper-TV_REF.upper).toFixed(2)}  lower diff ${(lower-TV_REF.lower).toFixed(2)}`)
}

// ── 1. Investigate assetId=46 ────────────────────────────────────────────
console.log('═'.repeat(70))
console.log('PART 1: assetId=46 Investigation')
console.log('═'.repeat(70))

const data46 = await fetchAsset(46, 180)
if (!data46) {
  console.log('ERROR: No data returned for assetId=46')
} else {
  const first = data46[0]
  const last  = data46[data46.length-1]
  const prices = data46.map(d => Number(d.p?.c)).filter(p => !isNaN(p) && p > 0)
  const minP = Math.min(...prices), maxP = Math.max(...prices)
  const latestP = prices[prices.length-1]

  // Check for metadata fields
  console.log(`\n1. Raw response field names: ${Object.keys(first).join(', ')}`)
  console.log(`   p fields: ${Object.keys(first.p || {}).join(', ')}`)
  console.log(`2. Asset name/symbol from response: ${first.name ?? first.symbol ?? first.assetName ?? first.ticker ?? 'NOT PRESENT IN RESPONSE'}`)
  console.log(`3. Record count: ${data46.length}`)
  console.log(`4. Date range: ${first.date} → ${last.date}`)
  console.log(`5. Latest close price: ${latestP.toFixed(2)}`)
  console.log(`6. Price range (180d): ${minP.toFixed(2)} – ${maxP.toFixed(2)}`)
  console.log(`7. Price level vs XAUUSD spot (~4050-4150 range today): ${latestP > 3000 && latestP < 6000 ? 'CONSISTENT' : 'INCONSISTENT'}`)

  // Check trading hours — what hours are populated?
  const hourCounts = new Map()
  for (const row of data46) {
    const h = new Date(row.date).getUTCHours()
    hourCounts.set(h, (hourCounts.get(h) || 0) + 1)
  }
  const hours = [...hourCounts.entries()].sort(([a],[b]) => a-b)
  const allHours = hours.map(([h,n]) => `${String(h).padStart(2,'0')}:00(${n})`).join(', ')
  console.log(`8. UTC hours with data: ${allHours}`)
  console.log(`   (XAUUSD trades ~22:00 Sun to 21:00 Fri UTC -- gaps expected at weekends)`)

  // Check gaps
  const sessions = buildSessions(data46)
  const allSess  = buildSessions(data46).length
  const complete = sessions.filter(s => s.count >= 20)
  const partial  = sessions.filter(s => s.count < 20)
  console.log(`\n9. Session analysis:`)
  console.log(`   Total sessions: ${allSess}`)
  console.log(`   Complete (≥20 bars): ${complete.length}`)
  console.log(`   Partial (<20 bars): ${partial.length}`)
  if (partial.length > 0) {
    console.log(`   Partial session bar counts: ${partial.slice(0,10).map(s => `${s.date}(${s.count})`).join(', ')}`)
  }

  // Check last 7 days hourly coverage
  const recent = data46.filter(d => d.date >= startDate7)
  console.log(`   Recent 7-day hourly rows: ${recent.length} (expected ~168 for 24/7, ~120 for Mon-Fri only)`)

  // Intraday range check vs TradingView implied anchors
  const stats = computeZoneStats(sessions)
  if (stats) {
    console.log(`\n10. Current session bands (assetId=46):`)
    printBands('assetId=46', stats.prev, stats.prevAtr, stats.curr, 2)
    console.log(`\n11. TradingView reference:`)
    console.log(`    ATR20=108.72, upper=4126.19, lower=3953.40`)
    console.log(`    implied today_low=4017.47, today_high=4062.12`)
    if (stats.curr) {
      console.log(`\n12. Session h/l comparison:`)
      console.log(`    assetId=46 curr high: ${stats.curr.h.toFixed(2)}  vs TV implied: 4062.12  diff: ${(stats.curr.h-4062.12).toFixed(2)}`)
      console.log(`    assetId=46 curr low:  ${stats.curr.l.toFixed(2)}  vs TV implied: 4017.47  diff: ${(stats.curr.l-4017.47).toFixed(2)}`)
      console.log(`    assetId=46 ATR20:     ${stats.prevAtr.toFixed(2)}   vs TV:         108.72   diff: ${(stats.prevAtr-108.72).toFixed(2)} (${((stats.prevAtr-108.72)/108.72*100).toFixed(2)}%)`)
    }
  }
}

// ── 2. Search for other Gold/XAU candidates ──────────────────────────────
console.log('\n' + '═'.repeat(70))
console.log('PART 2: Search for alternative Gold/XAU Acuity assets')
console.log('═'.repeat(70))

// Try a range of known Acuity asset IDs for metals/commodities
// From the ACUITY_ASSET_IDS in the coaching engine
const CANDIDATE_IDS = [
  { id: 46,     label: 'Gold (primary candidate)' },
  { id: 47,     label: 'Gold candidate 2' },
  { id: 113052, label: 'Bitcoin (reference check)' },
  { id: 44,     label: 'Silver candidate' },
  { id: 45,     label: 'Metal candidate' },
  { id: 48,     label: 'Brent (reference)' },
  { id: 49,     label: 'Metal/commodity candidate' },
  { id: 51,     label: 'Metal/commodity candidate' },
  { id: 52,     label: 'Metal/commodity candidate' },
  { id: 53,     label: 'Metal/commodity candidate' },
]

console.log('\nTesting candidate assetIds (7-day probe):')
for (const cand of CANDIDATE_IDS) {
  try {
    const d = await fetchAsset(cand.id, 7)
    if (!d || d.length === 0) {
      console.log(`  assetId=${cand.id} (${cand.label}): NO DATA`)
      continue
    }
    const prices = d.map(r => Number(r.p?.c)).filter(p => !isNaN(p) && p > 0)
    if (prices.length === 0) { console.log(`  assetId=${cand.id}: NO VALID PRICES`); continue }
    const latest = prices[prices.length-1]
    const first  = d[0]
    const fields = Object.keys(first).join(',')
    // Gold spot price should be 3800-4500 range currently
    const goldLike = latest > 3500 && latest < 5000
    console.log(`  assetId=${cand.id} (${cand.label}): latest=${latest.toFixed(2)}, rows=${d.length}${goldLike ? ' ← GOLD CANDIDATE' : ''}`)
  } catch(e) {
    console.log(`  assetId=${cand.id}: error ${e.message}`)
  }
  await new Promise(r => setTimeout(r, 300))
}

console.log('\n' + '═'.repeat(70))
console.log('Investigation complete. Manual TradingView comparison required for ATR source decision.')
