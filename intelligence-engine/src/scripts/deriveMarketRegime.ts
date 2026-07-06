// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Market Regime Derivation Script
// ============================================================================
// Computes daily regime state for each active market from market_state_daily
// bars. Writes one row per market per day to market_regime_state.
//
// Indicators computed:
//   EMA20, EMA50, EMA200  -- exponential moving averages of close
//   ADX14                 -- Average Directional Index (trend strength)
//   Directional persistence -- % of last 20 bars with close > prev close
//   ATR percentile        -- ATR14 as % of 60-bar percentile (volatility)
//
// Regime derivation:
//   TRENDING_UP:   EMA20 > EMA50 > EMA200 AND ADX14 >= 25
//   TRENDING_DOWN: EMA20 < EMA50 < EMA200 AND ADX14 >= 25
//   RANGE:         ADX14 < 20
//   MIXED:         everything else
//
// Volatility:
//   ATR14/close percentile vs last 60 bars
//   <25th → LOW_VOL, 25-75th → NORMAL_VOL, 75-90th → HIGH_VOL, >90th → EXTREME_VOL
//
// Run:
//   npx tsx src/scripts/deriveMarketRegime.ts --dry-run
//   npx tsx src/scripts/deriveMarketRegime.ts
//   npx tsx src/scripts/deriveMarketRegime.ts --backfill  (process all historical dates)
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// ── Indicator calculations ────────────────────────────────────────────────────

function calcEma(closes: number[], period: number): number[] {
  if (closes.length < period) return []
  const k = 2 / (period + 1)
  const result: number[] = []
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period
  result.push(ema)
  for (let i = period; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k)
    result.push(ema)
  }
  return result
}

function calcAdx(
  highs: number[], lows: number[], closes: number[], period: number
): number[] {
  if (closes.length < period + 1) return []

  const trArr: number[] = []
  const plusDmArr: number[] = []
  const minusDmArr: number[] = []

  for (let i = 1; i < closes.length; i++) {
    const high = highs[i]!, prevHigh = highs[i - 1]!
    const low = lows[i]!, prevLow = lows[i - 1]!
    const prevClose = closes[i - 1]!

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    const plusDm = high - prevHigh > prevLow - low ? Math.max(high - prevHigh, 0) : 0
    const minusDm = prevLow - low > high - prevHigh ? Math.max(prevLow - low, 0) : 0

    trArr.push(tr)
    plusDmArr.push(plusDm)
    minusDmArr.push(minusDm)
  }

  // Wilder smoothing
  function wilderSmooth(arr: number[], p: number): number[] {
    const result: number[] = []
    let sum = arr.slice(0, p).reduce((a, b) => a + b, 0)
    result.push(sum)
    for (let i = p; i < arr.length; i++) {
      sum = sum - sum / p + arr[i]!
      result.push(sum)
    }
    return result
  }

  const smoothTr = wilderSmooth(trArr, period)
  const smoothPlus = wilderSmooth(plusDmArr, period)
  const smoothMinus = wilderSmooth(minusDmArr, period)

  const adxArr: number[] = []
  const dxHistory: number[] = []

  for (let i = 0; i < smoothTr.length; i++) {
    const tr = smoothTr[i]!
    if (tr === 0) { dxHistory.push(0); continue }
    const plusDi = (smoothPlus[i]! / tr) * 100
    const minusDi = (smoothMinus[i]! / tr) * 100
    const diSum = plusDi + minusDi
    const dx = diSum === 0 ? 0 : (Math.abs(plusDi - minusDi) / diSum) * 100
    dxHistory.push(dx)

    if (dxHistory.length >= period) {
      if (adxArr.length === 0) {
        adxArr.push(dxHistory.slice(-period).reduce((a, b) => a + b, 0) / period)
      } else {
        adxArr.push((adxArr[adxArr.length - 1]! * (period - 1) + dx) / period)
      }
    }
  }

  return adxArr
}

function calcDirectionalPersistence(closes: number[], lookback: number): number {
  if (closes.length < lookback + 1) return 0.5
  const recent = closes.slice(-lookback - 1)
  let bullish = 0
  for (let i = 1; i < recent.length; i++) {
    if (recent[i]! > recent[i - 1]!) bullish++
  }
  return bullish / lookback
}

function calcAtrPercentile(atrs: number[], closes: number[], lookback: number): number {
  if (atrs.length < lookback) return 50
  const recent = atrs.slice(-lookback)
  const recentCloses = closes.slice(-lookback)
  const ratios = recent.map((a, i) => a / recentCloses[i]!)
  const current = ratios[ratios.length - 1]!
  const sorted = [...ratios].sort((a, b) => a - b)
  const rank = sorted.filter(r => r <= current).length
  return (rank / lookback) * 100
}

// ── Regime derivation ─────────────────────────────────────────────────────────

type TrendState = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGE' | 'MIXED'
type VolatilityState = 'LOW_VOL' | 'NORMAL_VOL' | 'HIGH_VOL' | 'EXTREME_VOL'
type RegimeConfidence = 'LOW' | 'MEDIUM' | 'HIGH'

interface RegimeResult {
  trend_state: TrendState
  volatility_state: VolatilityState
  regime_confidence: RegimeConfidence
  regime_tags: string[]
  derived_from: object
}

function deriveRegime(
  ema20: number, ema50: number, ema200: number,
  adx14: number, dirPersistence: number, atrPct: number
): RegimeResult {
  // Trend state
  let trend_state: TrendState
  const emaStackUp = ema20 > ema50 && ema50 > ema200
  const emaStackDown = ema20 < ema50 && ema50 < ema200
  const trending = adx14 >= 25

  if (emaStackUp && trending) trend_state = 'TRENDING_UP'
  else if (emaStackDown && trending) trend_state = 'TRENDING_DOWN'
  else if (adx14 < 20) trend_state = 'RANGE'
  else trend_state = 'MIXED'

  // Volatility state
  let volatility_state: VolatilityState
  if (atrPct < 25) volatility_state = 'LOW_VOL'
  else if (atrPct < 75) volatility_state = 'NORMAL_VOL'
  else if (atrPct < 90) volatility_state = 'HIGH_VOL'
  else volatility_state = 'EXTREME_VOL'

  // Confidence: how many signals agree
  const signals: boolean[] = [
    emaStackUp || emaStackDown,     // EMA stack is clean (not mixed)
    adx14 > 20,                      // ADX is decisive
    dirPersistence > 0.65 || dirPersistence < 0.35, // clear directional bias
  ]
  const agreeing = signals.filter(Boolean).length
  const regime_confidence: RegimeConfidence =
    agreeing === 3 ? 'HIGH' : agreeing === 2 ? 'MEDIUM' : 'LOW'

  // Tags
  const regime_tags: string[] = [trend_state, volatility_state]
  if (dirPersistence > 0.65) regime_tags.push('BULLISH_PERSISTENCE')
  if (dirPersistence < 0.35) regime_tags.push('BEARISH_PERSISTENCE')
  if (adx14 > 40) regime_tags.push('STRONG_TREND')

  const derived_from = {
    ema20: Math.round(ema20 * 100000) / 100000,
    ema50: Math.round(ema50 * 100000) / 100000,
    ema200: Math.round(ema200 * 100000) / 100000,
    adx14: Math.round(adx14 * 100) / 100,
    directional_persistence: Math.round(dirPersistence * 1000) / 1000,
    atr_percentile: Math.round(atrPct * 10) / 10,
  }

  return { trend_state, volatility_state, regime_confidence, regime_tags, derived_from }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const isDryRun = process.argv.includes('--dry-run')
  const isBackfill = process.argv.includes('--backfill')

  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}${isBackfill ? ' + BACKFILL' : ''}`)
  console.log('Deriving market regime states...\n')

  const generatedAt = new Date().toISOString()

  // Load active markets
  const { data: markets } = await db
    .from('markets')
    .select('market_id, symbol')
    .eq('active', true)
    .not('price_data_symbol', 'is', null)

  if (!markets?.length) { console.error('No markets found'); process.exit(1) }

  // Load all bars -- need at least 200 for EMA200
  const MIN_BARS = 210 // 200 + buffer
  const LOOKBACK_DAYS = isBackfill ? 1000 : 60 // full history or recent
  const windowStart = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10)

  // For EMA200 we always need at least 200 bars regardless of window
  // Load enough bars per market using pagination
  const allBars: any[] = []
  let page = 0, hasMore = true
  process.stdout.write('Loading bars')
  while (hasMore) {
    const { data } = await db.from('market_state_daily')
      .select('market_id, date, high, low, close, atr14')
      .gte('date', isBackfill ? '2015-01-01' : windowStart)
      .order('date', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (!data?.length) { hasMore = false } else {
      allBars.push(...data)
      hasMore = data.length === 1000
      page++
      process.stdout.write('.')
    }
  }
  console.log(`\nLoaded ${allBars.length} bars (${page} pages)`)

  // Group bars by market_id
  const barsByMarket = new Map<string, any[]>()
  for (const bar of allBars) {
    if (!barsByMarket.has(bar.market_id)) barsByMarket.set(bar.market_id, [])
    barsByMarket.get(bar.market_id)!.push(bar)
  }

  const regimeRows: any[] = []
  let processed = 0, skipped = 0

  for (const market of markets) {
    const bars = barsByMarket.get(market.market_id) ?? []
    if (bars.length < MIN_BARS) {
      skipped++
      continue
    }

    const closes = bars.map(b => Number(b.close))
    const highs = bars.map(b => Number(b.high))
    const lows = bars.map(b => Number(b.low))
    const atrs = bars.map(b => Number(b.atr14))
    const dates = bars.map(b => b.date)

    // Compute indicators for full series
    const ema20Series = calcEma(closes, 20)
    const ema50Series = calcEma(closes, 50)
    const ema200Series = calcEma(closes, 200)
    const adxSeries = calcAdx(highs, lows, closes, 14)

    // The EMA series are offset -- align by index
    // ema200Series[0] corresponds to closes[199]
    // adxSeries starts after period*2 roughly
    // We process from the last N dates (or all for backfill)

    const processFromIndex = isBackfill ? 200 : Math.max(200, bars.length - 60)

    for (let i = processFromIndex; i < bars.length; i++) {
      // Offset indices for each series
      const ema20Idx = i - 20 // ema20Series[0] = closes[19]
      const ema50Idx = i - 50
      const ema200Idx = i - 200
      // ADX: ema starts at trArr index period-1, and trArr is closes-1 long
      // approx: adxSeries[j] ≈ bars[j + period*2 + period]
      const adxOffset = 14 * 2 + 14
      const adxIdx = i - adxOffset

      if (ema20Idx < 0 || ema50Idx < 0 || ema200Idx < 0 || adxIdx < 0) continue
      if (ema20Idx >= ema20Series.length || ema50Idx >= ema50Series.length) continue
      if (ema200Idx >= ema200Series.length || adxIdx >= adxSeries.length) continue

      const ema20 = ema20Series[ema20Idx]!
      const ema50 = ema50Series[ema50Idx]!
      const ema200 = ema200Series[ema200Idx]!
      const adx14 = adxSeries[adxIdx]!

      const dirPersistence = calcDirectionalPersistence(closes.slice(0, i + 1), 20)
      const atrPct = calcAtrPercentile(atrs.slice(0, i + 1), closes.slice(0, i + 1), 60)

      const regime = deriveRegime(ema20, ema50, ema200, adx14, dirPersistence, atrPct)

      regimeRows.push({
        market_id: market.market_id,
        captured_at: dates[i] + 'T22:00:00Z', // end of CFD session
        session: null, // daily regime, not session-specific
        trend_state: regime.trend_state,
        volatility_state: regime.volatility_state,
        regime_confidence: regime.regime_confidence,
        regime_tags: regime.regime_tags,
        derived_from: regime.derived_from,
      })
    }

    processed++
    if (processed % 10 === 0) process.stdout.write(`\r  Processing markets: ${processed}/${markets.length}`)
  }

  console.log(`\n\nMarkets processed: ${processed}, skipped (insufficient bars): ${skipped}`)
  console.log(`Regime rows to write: ${regimeRows.length}`)

  // Sample output
  const sample = regimeRows.slice(-5)
  for (const r of sample) {
    const mkt = markets.find(m => m.market_id === r.market_id)
    console.log(`  ${mkt?.symbol} ${r.captured_at.slice(0, 10)}: ${r.trend_state} / ${r.volatility_state} (${r.regime_confidence}) ADX=${(r.derived_from as any).adx14}`)
  }

  if (isDryRun) {
    console.log('\nDRY RUN -- nothing written.')
    return
  }

  // Deduplicate by market_id + captured_at (keep last occurrence)
  const seen = new Map<string, any>()
  for (const row of regimeRows) {
    const key = `${row.market_id}::${row.captured_at}`
    seen.set(key, row)
  }
  const dedupedRows = Array.from(seen.values())
  console.log(`Regime rows after dedup: ${dedupedRows.length} (removed ${regimeRows.length - dedupedRows.length} duplicates)`)

  // Delete existing and re-insert (avoids upsert conflict on duplicate dates)
  if (!isDryRun) {
    console.log('\nClearing existing regime rows...')
    await db.from('market_regime_state').delete().not('market_regime_state_id', 'is', null)
  }

  console.log(isDryRun ? '\nDRY RUN -- nothing written.' : '\nWriting regime rows...')
  if (isDryRun) return

  const BATCH = 500
  let inserted = 0
  for (let i = 0; i < dedupedRows.length; i += BATCH) {
    const batch = dedupedRows.slice(i, i + BATCH)
    const { error } = await db.from('market_regime_state').insert(batch)
    if (error) { console.error(`Insert error: ${error.message}`); process.exit(1) }
    inserted += batch.length
    process.stdout.write(`\rInserted ${inserted}/${dedupedRows.length}`)
  }

  console.log(`\n\nDone. ${inserted} regime rows written.`)
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
