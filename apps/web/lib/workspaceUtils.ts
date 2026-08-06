// Pure helpers for the analyst "My Workspace" coverage strip + detail card.
// No I/O -- everything here takes already-fetched, already-computed values.

export type AtrZone = 'TOO_DEEP' | 'ZONE_1' | 'ZONE_2' | 'ZONE_3' | 'ZONE_4' | 'TOO_HIGH'

// Ladder order matches the visual spec: highest price on the left.
export const ZONE_LADDER_ORDER: AtrZone[] = ['TOO_HIGH', 'ZONE_4', 'ZONE_3', 'ZONE_2', 'ZONE_1', 'TOO_DEEP']

// Ascending price order -- used for proximity distance, not display order.
const ZONE_PRICE_ORDER: AtrZone[] = ['TOO_DEEP', 'ZONE_1', 'ZONE_2', 'ZONE_3', 'ZONE_4', 'TOO_HIGH']

export function zoneLabel(zone: string | null): string {
  switch (zone) {
    case 'TOO_DEEP': return 'Too Deep'
    case 'ZONE_1': return 'Zone 1'
    case 'ZONE_2': return 'Zone 2'
    case 'ZONE_3': return 'Zone 3'
    case 'ZONE_4': return 'Zone 4'
    case 'TOO_HIGH': return 'Too High'
    default: return '—'
  }
}

export function zoneShortLabel(zone: string | null): string {
  switch (zone) {
    case 'TOO_DEEP': return 'TD'
    case 'ZONE_1': return 'Z1'
    case 'ZONE_2': return 'Z2'
    case 'ZONE_3': return 'Z3'
    case 'ZONE_4': return 'Z4'
    case 'TOO_HIGH': return 'TH'
    default: return '—'
  }
}

/**
 * Proximity class between current and preferred zone. Extreme current zones
 * (TOO_HIGH/TOO_DEEP) are always "far" regardless of the preferred zone --
 * price has moved outside the tradeable band, not just off the preferred one.
 */
export function zoneProximityClass(current: string | null, preferred: string | null): 'green' | 'amber' | 'red' | 'neutral' {
  if (!current || !preferred) return 'neutral'
  if (current === 'TOO_HIGH' || current === 'TOO_DEEP') return 'red'
  const curIdx = ZONE_PRICE_ORDER.indexOf(current as AtrZone)
  const prefIdx = ZONE_PRICE_ORDER.indexOf(preferred as AtrZone)
  if (curIdx < 0 || prefIdx < 0) return 'neutral'
  const distance = Math.abs(curIdx - prefIdx)
  if (distance === 0) return 'green'
  if (distance === 1) return 'amber'
  return 'red'
}

export const ZONE_PROXIMITY_TEXT_CLASS: Record<ReturnType<typeof zoneProximityClass>, string> = {
  green: 'text-green-700',
  amber: 'text-amber-600',
  red: 'text-red-600',
  neutral: 'text-muted-foreground',
}

export const ZONE_PROXIMITY_BADGE_CLASS: Record<ReturnType<typeof zoneProximityClass>, string> = {
  green: 'bg-green-50 border-green-200 text-green-800',
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
  red: 'bg-red-50 border-red-200 text-red-800',
  neutral: 'bg-muted border-border text-muted-foreground',
}

export function trendArrow(state: string | null): string {
  switch (state) {
    case 'TRENDING_UP': return '↑'
    case 'TRENDING_DOWN': return '↓'
    default: return '→'
  }
}

export function trendLabelFull(state: string | null): string {
  switch (state) {
    case 'TRENDING_UP': return 'Trending Up'
    case 'TRENDING_DOWN': return 'Trending Down'
    case 'RANGE': return 'Range'
    case 'MIXED': return 'Mixed'
    default: return '—'
  }
}

/**
 * Plain-English trend description derived from trend_state + ADX14, per spec:
 * ADX < 15 is always "Ranging" regardless of direction; TRENDING_UP/DOWN with
 * ADX >= 25 is "Strong", 15-25 is "Weak". RANGE/MIXED states with ADX >= 15
 * have no reliable directional bias, so they also read as "Ranging".
 */
export function regimeTrendLabel(trendState: string | null, adx14: number | null, short = false): string {
  if (adx14 == null || trendState == null) return '—'
  if (adx14 < 15) return 'Ranging'
  const strength = adx14 >= 25 ? 'Strong' : 'Weak'
  if (trendState === 'TRENDING_UP') return short ? `${strength} Up` : `${strength} Uptrend`
  if (trendState === 'TRENDING_DOWN') return short ? `${strength} Down` : `${strength} Downtrend`
  return 'Ranging'
}

export function regimeTrendLabelWithAdx(trendState: string | null, adx14: number | null): string {
  const label = regimeTrendLabel(trendState, adx14)
  if (label === '—' || adx14 == null) return label
  return `${label} (ADX ${adx14.toFixed(0)})`
}

/** Volatility description derived from ATR percentile, per spec:
 *  >70th = Expanding, 30-70th = Normal, <30th = Contracting. */
export function regimeVolatilityLabel(atrPercentile: number | null): string {
  if (atrPercentile == null) return '—'
  const state = atrPercentile > 70 ? 'Expanding' : atrPercentile < 30 ? 'Contracting' : 'Normal'
  return `${state} (${atrPercentileLabel(atrPercentile)})`
}

export function confidenceBadgeLabel(confidence: string | null): string {
  switch (confidence) {
    case 'HIGH': return 'HIGH'
    case 'MEDIUM': return 'MED'
    case 'LOW': return 'LOW'
    default: return '—'
  }
}

/**
 * Plain-English zone label -- direction-independent. A SELL analyst entering
 * at Zone 4 sees the same word ("Stretched") a BUY analyst would see for the
 * same zone; direction only changes which zone happens to be preferred/starred,
 * not the vocabulary used to describe each zone.
 */
export function zonePlainLabel(zone: string | null): string {
  switch (zone) {
    case 'TOO_DEEP': return 'Extreme Low'
    case 'ZONE_1': return 'Deep Value'
    case 'ZONE_2': return 'Value'
    case 'ZONE_3': return 'Fair Value'
    case 'ZONE_4': return 'Stretched'
    case 'TOO_HIGH': return 'Extreme High'
    default: return '—'
  }
}

export type ZoneSemanticColour = 'green' | 'amber' | 'red' | 'neutral' | 'muted'

/**
 * Direction-aware "is this zone a good or bad place to enter" classification,
 * from the redesign spec's explicit per-zone table. For BUY, buying cheap
 * (Zone 1/2) is the opportunity and buying stretched (Zone 4) is the danger;
 * for SELL it's the mirror image. TOO_HIGH/TOO_DEEP are always 'muted'
 * regardless of direction -- they sit outside the normal ATR band structure
 * entirely (entryOptimizerService.zoneBounds() clamps them to Zone 1/4's own
 * bounds rather than giving them a real band of their own), so they read as
 * an extreme/degenerate state rather than a colour-coded opportunity even on
 * the direction where the spec's per-zone table would otherwise call them
 * green (SELL + TOO_HIGH) -- the later "Too High/Too Deep = bg-muted/30" rule
 * is treated as the override for those two zones specifically.
 */
const ZONE_COLOUR_BY_DIRECTION: Record<'BUY' | 'SELL', Record<AtrZone, ZoneSemanticColour>> = {
  BUY: {
    TOO_HIGH: 'muted',
    ZONE_4: 'amber',
    ZONE_3: 'neutral',
    ZONE_2: 'green',
    ZONE_1: 'green',
    TOO_DEEP: 'muted',
  },
  SELL: {
    TOO_HIGH: 'muted',
    ZONE_4: 'green',
    ZONE_3: 'neutral',
    ZONE_2: 'amber',
    ZONE_1: 'red',
    TOO_DEEP: 'muted',
  },
}

export function zoneSemanticColour(zone: string | null, direction: 'BUY' | 'SELL' | null): ZoneSemanticColour {
  if (!zone || !direction) return 'neutral'
  return ZONE_COLOUR_BY_DIRECTION[direction][zone as AtrZone] ?? 'neutral'
}

export const ZONE_BAND_BG_CLASS: Record<ZoneSemanticColour, string> = {
  green: 'bg-green-100',
  amber: 'bg-amber-50',
  red: 'bg-red-50',
  neutral: 'bg-card',
  muted: 'bg-muted/30',
}

export interface ZoneBoundaries {
  rangeHigh: number
  rangeLow: number
  bandWidth: number
  tooHigh: { min: number; max: number }
  zone4: { min: number; max: number }
  zone3: { min: number; max: number }
  zone2: { min: number; max: number }
  zone1: { min: number; max: number }
  tooDeep: { min: number; max: number }
}

/**
 * Approximate price boundaries for the six zones, derived purely from recent
 * price action (last 20 bars of the 30-day history already fetched) -- this
 * is a display-only approximation for the ladder/chart alignment, NOT a
 * replacement for the engine's actual ATR-band zone calculation. Which zone
 * is "current"/"preferred" still comes from opportunities.current_zone /
 * preferred_entry_zone; this only says where each zone visually sits on the
 * chart's price axis.
 */
export function computeZoneBoundaries(priceHistory: { high: number; low: number }[]): ZoneBoundaries | null {
  const last20 = priceHistory.slice(-20)
  if (last20.length === 0) return null
  const rangeHigh = Math.max(...last20.map(d => d.high))
  const rangeLow = Math.min(...last20.map(d => d.low))
  if (!(rangeHigh > rangeLow)) return null
  const bandWidth = (rangeHigh - rangeLow) / 4
  return {
    rangeHigh, rangeLow, bandWidth,
    tooHigh: { min: rangeHigh, max: Infinity },
    zone4: { min: rangeLow + bandWidth * 3, max: rangeHigh },
    zone3: { min: rangeLow + bandWidth * 2, max: rangeLow + bandWidth * 3 },
    zone2: { min: rangeLow + bandWidth * 1, max: rangeLow + bandWidth * 2 },
    zone1: { min: rangeLow, max: rangeLow + bandWidth },
    tooDeep: { min: -Infinity, max: rangeLow },
  }
}

/** Currency codes implied by a 6-letter FX symbol (e.g. "EURUSD" -> ["EUR","USD"]).
 *  Returns [] for non-FX symbols/asset classes, where currency-based event
 *  filtering doesn't apply and callers should fall back to impact-only filtering. */
export function marketCurrencies(symbol: string, assetClass: string | null): string[] {
  if (assetClass !== 'FX') return []
  const clean = symbol.replace(/[^A-Za-z]/g, '')
  if (clean.length !== 6) return []
  return [clean.slice(0, 3).toUpperCase(), clean.slice(3, 6).toUpperCase()]
}

/** "05 Aug" -- compact chart axis label, no year/weekday. */
export function chartDateLabel(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

/** "20 > 50 > 200" / "20 < 50 < 200" / mixed comparisons, from raw EMA values. */
export function emaStackString(ema20: number | null, ema50: number | null, ema200: number | null): string {
  if (ema20 == null || ema50 == null || ema200 == null) return '—'
  const cmp = (a: number, b: number) => (a > b ? '>' : a < b ? '<' : '=')
  return `20 ${cmp(ema20, ema50)} 50 ${cmp(ema50, ema200)} 200`
}

/** Directional persistence is stored as a 0-1 fraction over a fixed 20-bar lookback
 *  (deriveMarketRegime.ts always calls calcDirectionalPersistence(closes, 20)). */
export function directionalPersistenceLabel(persistence: number | null): string {
  if (persistence == null) return '—'
  const lookback = 20
  const upDays = Math.round(persistence * lookback)
  return `${upDays}/${lookback} up days`
}

function ordinal(n: number): string {
  const rounded = Math.round(n)
  const mod100 = rounded % 100
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`
  switch (rounded % 10) {
    case 1: return `${rounded}st`
    case 2: return `${rounded}nd`
    case 3: return `${rounded}rd`
    default: return `${rounded}th`
  }
}

export function atrPercentileLabel(pct: number | null): string {
  if (pct == null) return '—'
  return `${ordinal(pct)} percentile`
}

/** Compares two consecutive market_regime_state.derived_from.atr_percentile
 *  readings (most recent first) to describe volatility expansion/contraction. */
export function volatilityTrend(latestPct: number | null, priorPct: number | null): 'expanding' | 'contracting' | 'flat' | null {
  if (latestPct == null || priorPct == null) return null
  const delta = latestPct - priorPct
  if (Math.abs(delta) < 3) return 'flat'
  return delta > 0 ? 'expanding' : 'contracting'
}

/** Parses a formatGuidanceRange() output ("1.2290–1.2310") into [low, high] numbers. */
export function parseGuidanceRange(range: string | null | undefined): [number, number] | null {
  if (!range) return null
  const parts = range.split('–')
  if (parts.length !== 2) return null
  const low = Number(parts[0])
  const high = Number(parts[1])
  if (Number.isNaN(low) || Number.isNaN(high)) return null
  return [low, high]
}

/** Distance from entryMid to the near edge of a guidance range, in ATR units.
 *  Matches entryOptimizerService's use of atr14 (not atr20) for stop/target construction. */
export function atrDistanceFromEntry(entryMid: number | null, range: [number, number] | null, atr14: number | null): number | null {
  if (entryMid == null || !range || !atr14 || atr14 <= 0) return null
  const [low, high] = range
  const nearEdge = Math.abs(low - entryMid) < Math.abs(high - entryMid) ? low : high
  return Math.abs(nearEdge - entryMid) / atr14
}

/** Plain-language distance from current price to the entry range, in ATR units.
 *  Matches runEngineSession.ts's ENTRY_ALREADY_PASSED check, which uses atr20. */
export function entryDistanceLanguage(
  currentPrice: number | null, entryLow: number | null, entryHigh: number | null, atr20: number | null,
): string | null {
  if (currentPrice == null || entryLow == null || entryHigh == null || !atr20 || atr20 <= 0) return null
  if (currentPrice >= entryLow && currentPrice <= entryHigh) return 'Price is inside the preferred entry zone'
  const entryMid = (entryLow + entryHigh) / 2
  const distanceAtr = Math.abs(currentPrice - entryMid) / atr20
  const direction = currentPrice > entryMid ? 'above' : 'below'
  return `Price is ${distanceAtr.toFixed(1)} ATRs ${direction} the preferred entry zone`
}

/**
 * Session-end estimate, mirroring computeExpiresAt() in
 * intelligence-engine/src/scripts/runEngineSession.ts (no expires_at is
 * persisted on recommendation_versions/coaching_recommendations, only on the
 * internal shadow_trades table, so this is recomputed rather than read).
 */
export function estimateSessionEnd(session: string | null, assetClass: string | null, referenceIso: string): Date {
  const isCrypto = assetClass === 'CRYPTO'
  const isApac = session === 'APAC'
  const base = new Date(referenceIso)
  if (isApac || isCrypto) base.setUTCDate(base.getUTCDate() + 1)
  const targetHour = isCrypto ? 12 : isApac ? 16 : 21
  const dateStr = base.toISOString().slice(0, 10)
  for (let utcH = 0; utcH < 24; utcH++) {
    const candidate = new Date(`${dateStr}T${String(utcH).padStart(2, '0')}:00:00Z`)
    const londonHour = parseInt(candidate.toLocaleString('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', hour12: false,
    }), 10)
    if (londonHour === targetHour) return candidate
  }
  return new Date(`${dateStr}T${String(targetHour).padStart(2, '0')}:00:00Z`)
}

export function countdownLabel(target: Date, now: Date = new Date()): string {
  const ms = target.getTime() - now.getTime()
  if (ms <= 0) return 'Expired'
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

export function weekdayDateLabel(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

/** Rough pip count for FX pairs only -- other asset classes just show the raw range. */
export function fxPipCount(range: number, displayPrecision: number | null): number | null {
  if (displayPrecision == null) return null
  const pipDecimalPlaces = Math.max(displayPrecision - 1, 0)
  return Math.round(range / Math.pow(10, -pipDecimalPlaces))
}
