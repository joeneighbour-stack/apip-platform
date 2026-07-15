const ACUITY_API_KEY   = process.env.ACUITY_API_KEY
const SUPABASE_URL     = process.env.SUPABASE_URL
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY
const ACUITY_PRICE_URL = 'https://dashboard.acuitytrading.com/PriceApi/GetExtendedPriceSentimentData'

import { createClient } from '@supabase/supabase-js'
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

// Fetch Acuity sessions for GBPUSD
const endDate   = new Date().toISOString().slice(0,10)
const startDate = new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10)
const body = new URLSearchParams({ startDate, endDate, assetId: '102738', interval: '0' })
const res = await fetch(`${ACUITY_PRICE_URL}?apikey=${ACUITY_API_KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
})
const data = await res.json()

// Show raw timestamps
console.log('Raw Acuity timestamps (first 5):')
data.slice(0,5).forEach(d => console.log(' ', d.date))
console.log('Raw Acuity timestamps (last 5):')
data.slice(-5).forEach(d => console.log(' ', d.date))

// Aggregate sessions
const sessionMap = new Map()
for (const row of data) {
  const dt = new Date(row.date)
  const shifted = new Date(dt.getTime() + 2*60*60*1000)
  const fxDate = shifted.toISOString().slice(0,10)
  if (!sessionMap.has(fxDate)) sessionMap.set(fxDate, { count: 1 })
  else sessionMap.get(fxDate).count++
}
const sessions = [...sessionMap.entries()].sort(([a],[b]) => a.localeCompare(b))
console.log('\nAcuity raw fxDates (last 5):')
sessions.slice(-5).forEach(([d,v]) => console.log(` ${d}: ${v.count} bars`))

// Shifted back 1 day
console.log('\nAcuity shifted-back dates (last 5):')
sessions.slice(-5).forEach(([d,v]) => {
  const shifted = new Date(d + 'T12:00:00Z')
  shifted.setDate(shifted.getDate() - 1)
  console.log(` ${shifted.toISOString().slice(0,10)}: ${v.count} bars`)
})

// Fetch market_state_daily dates
const { data: msd } = await db
  .from('market_state_daily')
  .select('date')
  .eq('market_id', (await db.from('markets').select('market_id').eq('symbol','GBPUSD').single()).data.market_id)
  .order('date', { ascending: false })
  .limit(10)

console.log('\nmarket_state_daily dates (last 5):')
msd.slice(0,5).forEach(r => console.log(' ', r.date))
