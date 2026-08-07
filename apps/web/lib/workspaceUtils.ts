// Pure helpers for the analyst "My Workspace" coverage strip + detail card.
// No I/O -- everything here takes already-fetched, already-computed values.

export type AtrZone = 'TOO_DEEP' | 'ZONE_1' | 'ZONE_2' | 'ZONE_3' | 'ZONE_4' | 'TOO_HIGH'

// Ladder order matches the visual spec: highest price on the left.
export const ZONE_LADDER_ORDER: AtrZone[] = ['TOO_HIGH', 'ZONE_4', 'ZONE_3', 'ZONE_2', 'ZONE_1', 'TOO_DEEP']

// Ascending price order -- used for proximity distance, not display order.
const ZONE_PRICE_ORDER: AtrZone[] = ['TOO_DEEP', 'ZONE_1', 'ZONE_2', 'ZONE_3', 'ZONE_4', 'TOO_HIGH']

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
 * Engine-accurate zone boundaries -- exact replica of calculateAtrZones() in
 * intelligence-engine/src/services/marketStateService.ts, Pine-style band
 * construction (locked formula):
 *   bottomAnchor = min(previousClose, sessionLow)
 *   topAnchor    = max(previousClose, sessionHigh)
 *   lowerBand    = topAnchor - atr20
 *   upperBand    = bottomAnchor + atr20
 *   step         = (upperBand - lowerBand) / 4
 * Replaces the old last-20-day-quartering approximation entirely -- that
 * approximation could disagree with the engine's real zones badly enough
 * (verified live against Gold) that a recommendation's actual entry range
 * would land in what the approximation called "Too High" while the engine's
 * own preferred_entry_zone said "Zone 1". This is the same anchor/ATR math
 * the engine used to produce that entry range in the first place, so they
 * can no longer disagree.
 *
 * currentPrice is only used for the band-collapse guard (see below); the
 * classification of which zone is "current"/"preferred" still comes from
 * opportunities.current_zone/preferred_entry_zone, not from this function.
 */
export function computeZoneBoundaries(
  atr20: number | null,
  previousClose: number | null,
  sessionHigh: number | null,
  sessionLow: number | null,
  currentPrice: number | null,
): ZoneBoundaries | null {
  if (!atr20 || atr20 <= 0 || previousClose == null || sessionHigh == null || sessionLow == null) return null

  const bottomAnchor = Math.min(previousClose, sessionLow)
  const topAnchor = Math.max(previousClose, sessionHigh)

  let lowerBand = topAnchor - atr20
  let upperBand = bottomAnchor + atr20

  // Band-collapse guard, matching marketStateService.ts's calculateAtrZones()
  // exactly: when ATR is large enough relative to the anchor spread that the
  // bands invert, re-centre on the current price (not the anchor midpoint --
  // centring on price is what the engine actually does).
  if (upperBand <= lowerBand) {
    if (currentPrice == null) return null
    const halfAtr = atr20 / 2
    lowerBand = currentPrice - halfAtr
    upperBand = currentPrice + halfAtr
  }

  const step = (upperBand - lowerBand) / 4
  return {
    rangeHigh: upperBand, rangeLow: lowerBand, bandWidth: step,
    tooHigh: { min: upperBand, max: Infinity },
    zone4: { min: lowerBand + step * 3, max: upperBand },
    zone3: { min: lowerBand + step * 2, max: lowerBand + step * 3 },
    zone2: { min: lowerBand + step * 1, max: lowerBand + step * 2 },
    zone1: { min: lowerBand, max: lowerBand + step },
    tooDeep: { min: -Infinity, max: lowerBand },
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

/**
 * Plain-English volatility level from ATR percentile -- shown to the analyst
 * on its own, no percentile number attached (that goes in the tooltip via
 * volatilityTooltip() instead, for anyone who wants the detail).
 */
export function volatilityLabel(atrPercentile: number | null): string {
  if (atrPercentile == null) return '—'
  if (atrPercentile <= 20) return 'Very Low'
  if (atrPercentile <= 40) return 'Low'
  if (atrPercentile <= 60) return 'Normal'
  if (atrPercentile <= 80) return 'Elevated'
  return 'Very High'
}

export function volatilityTooltip(atrPercentile: number | null): string | undefined {
  if (atrPercentile == null) return undefined
  return `ATR at ${ordinal(atrPercentile)} percentile of recent history`
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

/** Quantitative distance from current price to the entry range, in ATR units --
 *  e.g. "0.3 ATR above entry", not a vague "near"/"far" read. Matches
 *  runEngineSession.ts's ENTRY_ALREADY_PASSED check, which uses atr20. */
export function entryDistanceLanguage(
  currentPrice: number | null, entryLow: number | null, entryHigh: number | null, atr20: number | null,
): string | null {
  if (currentPrice == null || entryLow == null || entryHigh == null || !atr20 || atr20 <= 0) return null
  if (currentPrice >= entryLow && currentPrice <= entryHigh) return 'At preferred entry zone'
  const entryMid = (entryLow + entryHigh) / 2
  const distanceAtr = Math.abs(currentPrice - entryMid) / atr20
  const direction = currentPrice > entryMid ? 'above' : 'below'
  return `${distanceAtr.toFixed(1)} ATR ${direction} entry`
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

/** True when the sample behind a historical edge is too thin to trust at face value --
 *  LOW profile_quality, or (when quality wasn't computed at all, e.g. the zone/market_only
 *  tiers) fewer than 20 trades, matching MEDIUM_CONFIDENCE_MIN_TRADES elsewhere. */
export function isLowSampleEdge(quality: string | null, trades: number): boolean {
  return quality === 'LOW' || (quality == null && trades < 20)
}

function isTrendingRegime(trendState: string | null, adx14: number | null): boolean {
  return adx14 != null && adx14 >= 25 && (trendState === 'TRENDING_UP' || trendState === 'TRENDING_DOWN')
}

function isRegimeAligned(direction: 'BUY' | 'SELL' | null, trendState: string | null): boolean {
  return (trendState === 'TRENDING_UP' && direction === 'BUY') || (trendState === 'TRENDING_DOWN' && direction === 'SELL')
}

/** "comparable conditions" / "zone-matched conditions" / "all conditions" -- names the
 *  historical-edge tier consistently across the Historical Profile pillar and Supporting
 *  Evidence's historical breakdown. */
export function historicalEdgeConditionsLabel(tier: string): string {
  switch (tier) {
    case 'zone': return 'zone-matched conditions'
    case 'regime_direction': return 'comparable conditions'
    default: return 'all conditions'
  }
}

interface GroupableEvent {
  eventName: string
  impact: string
  eventTimeUk: string
  riskScore: number | null
  analystWarning: string | null
  forecast: string | null
  previous: string | null
  actual: string | null
}

export interface EventGroup<T extends GroupableEvent = GroupableEvent> {
  eventTimeUk: string
  maxImpact: string
  items: T[]
}

/** Groups same-market events by exact timestamp (e.g. a data release bundle
 *  publishing several indicators at once), for Section 9's grouped calendar
 *  and Section 2's major-event-warning summary line. No collective release
 *  name exists in economic_calendar_events (only per-indicator event_name),
 *  so groups are identified by time, not a fabricated umbrella title. */
export function groupEventsByTime<T extends GroupableEvent>(items: T[]): EventGroup<T>[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    if (!map.has(item.eventTimeUk)) map.set(item.eventTimeUk, [])
    map.get(item.eventTimeUk)!.push(item)
  }
  const groups: EventGroup<T>[] = [...map.entries()].map(([eventTimeUk, group]) => ({
    eventTimeUk,
    maxImpact: group.some(e => e.impact === 'HIGH') ? 'HIGH' : group.some(e => e.impact === 'MEDIUM') ? 'MEDIUM' : 'LOW',
    items: group,
  }))
  groups.sort((a, b) => a.eventTimeUk.localeCompare(b.eventTimeUk))
  return groups
}

export function impactBadge(impact: string): string {
  switch (impact) {
    case 'HIGH': return '⚠⚠ HIGH'
    case 'MEDIUM': return '⚠ MEDIUM'
    default: return 'LOW'
  }
}

// ============================================================================
// Recommendation-brief redesign -- primary recommendation taxonomy, two
// evidence-pillar ratings, and a natural-language synthesis. All derived from
// data/thresholds that already exist elsewhere in this file (isLowSampleEdge,
// isTrendingRegime, isRegimeAligned, zoneProximityClass) -- no new arbitrary
// cutoffs invented for the UI.
// ============================================================================

/** "EURNZD" -> "EUR/NZD". FX-only (same 6-letter detection as marketCurrencies());
 *  every other asset class is returned unchanged. Presentational only -- the
 *  underlying symbol/market_id are never touched. */
export function formatSymbolForDisplay(symbol: string, assetClass: string | null): string {
  if (assetClass !== 'FX') return symbol
  const clean = symbol.replace(/[^A-Za-z]/g, '')
  if (clean.length !== 6) return symbol
  return `${clean.slice(0, 3).toUpperCase()}/${clean.slice(3, 6).toUpperCase()}`
}

/**
 * BUY DIPS / SELL RALLIES -- not a new probabilistic classification, a direct
 * restatement of the engine's existing zone-entry invariant: BUY setups are only
 * ever constrained to low zones (Zone 1/2/Too Deep) and SELL setups to high zones
 * (Zone 3/4/Too High), per templateService.ts's BUY_ZONES/SELL_ZONES constraint
 * (V1.3 amendment) and clampToValidZone()'s output clamp. Every BUY recommendation
 * this system can currently produce IS a dip-buy and every SELL IS a rally-sell,
 * by construction -- there is no code path today that would ever produce a
 * breakout-style setup, so BUY BREAKOUT/SELL BREAKDOWN are deliberately not
 * offered here (would be unreachable, not "eventually possible").
 */
export function recommendationTypeLabel(direction: 'BUY' | 'SELL' | null): string | null {
  if (direction === 'BUY') return 'BUY DIPS'
  if (direction === 'SELL') return 'SELL RALLIES'
  return null
}

export type HistoricalProfileRating = 'STRONG FIT' | 'POSITIVE FIT' | 'NEUTRAL' | 'LIMITED EVIDENCE' | 'WEAK FIT'

export const HISTORICAL_RATING_CLASS: Record<HistoricalProfileRating, string> = {
  'STRONG FIT': 'text-green-700',
  'POSITIVE FIT': 'text-green-700',
  NEUTRAL: 'text-muted-foreground',
  'LIMITED EVIDENCE': 'text-amber-600',
  'WEAK FIT': 'text-red-600',
}

/**
 * YOUR HISTORICAL PROFILE rating. Reuses exactly the same thresholds
 * historicalFitEvidence()/isLowSampleEdge() already use elsewhere on this card
 * (avgR>0.10 & winRate>0.50 for the top tier, avgR>0 & winRate>0.45 for the next,
 * LOW profile_quality or <20 trades for thin samples) -- no new cutoffs. A
 * positive avgR on a thin sample maps to LIMITED EVIDENCE outright, never to
 * STRONG/POSITIVE FIT, per the redesign's explicit "don't overstate a small
 * sample" rule. Returns null when there's no historical data at all (trades=0);
 * caller shows a "no history yet" line instead of a rating badge.
 */
export function historicalProfileRating(
  avgR: number | null, winRate: number | null, quality: string | null, trades: number,
): HistoricalProfileRating | null {
  if (avgR == null || trades === 0) return null
  if (avgR <= 0) return 'WEAK FIT'
  if (isLowSampleEdge(quality, trades)) return 'LIMITED EVIDENCE'
  if (avgR > 0.10 && winRate != null && winRate > 0.50) return 'STRONG FIT'
  if (avgR > 0 && winRate != null && winRate > 0.45) return 'POSITIVE FIT'
  return 'NEUTRAL'
}

export type TodaysConditionsRating = 'SUPPORTIVE' | 'MIXED' | 'NEUTRAL' | 'UNSUPPORTIVE'

export const CONDITIONS_RATING_CLASS: Record<TodaysConditionsRating, string> = {
  SUPPORTIVE: 'text-green-700',
  MIXED: 'text-amber-600',
  NEUTRAL: 'text-muted-foreground',
  UNSUPPORTIVE: 'text-red-600',
}

/**
 * TODAY'S CONDITIONS rating. Combines the two objective signals this card
 * already computes elsewhere -- regime fit (isTrendingRegime/isRegimeAligned,
 * the same pair regimeFitRating() uses) and price location (zoneProximityClass,
 * the same function priceLocationRating() uses) -- into one read. Counter-trend
 * is always UNSUPPORTIVE (the strongest single negative signal); trend-aligned
 * + at-zone, or ranging + at-zone (the existing mean-reversion rule from
 * marketConditionsInterpretation), is SUPPORTIVE; trend-aligned but price not
 * yet at the preferred zone is MIXED (one signal good, one not there yet);
 * everything else is NEUTRAL. No thresholds here are new. Returns null when
 * there's no regime data at all.
 */
export function todaysConditionsRating(
  direction: 'BUY' | 'SELL' | null, currentZone: string | null, preferredZone: string | null,
  trendState: string | null, adx14: number | null,
): TodaysConditionsRating | null {
  if (trendState == null || adx14 == null) return null
  const trending = isTrendingRegime(trendState, adx14)
  const aligned = trending && isRegimeAligned(direction, trendState)
  const proximity = zoneProximityClass(currentZone, preferredZone)
  const atZone = proximity === 'green'

  if (trending && !aligned) return 'UNSUPPORTIVE'
  if (aligned && atZone) return 'SUPPORTIVE'
  if (!trending && atZone) return 'SUPPORTIVE'
  if (aligned && !atZone) return 'MIXED'
  if (proximity === 'red') return 'UNSUPPORTIVE'
  return 'NEUTRAL'
}

type Polarity = 'positive' | 'neutral' | 'negative'

function historicalPolarity(r: HistoricalProfileRating | null): Polarity {
  if (r === 'STRONG FIT' || r === 'POSITIVE FIT') return 'positive'
  if (r === 'WEAK FIT') return 'negative'
  return 'neutral' // NEUTRAL, LIMITED EVIDENCE, or no data
}

function conditionsPolarity(r: TodaysConditionsRating | null): Polarity {
  if (r === 'SUPPORTIVE') return 'positive'
  if (r === 'UNSUPPORTIVE') return 'negative'
  return 'neutral' // MIXED, NEUTRAL, or no data
}

function historicalClauseText(rating: HistoricalProfileRating | null, symbolDisplay: string, dirWord: string): string {
  switch (rating) {
    case 'STRONG FIT':
    case 'POSITIVE FIT':
      return `your previous ${symbolDisplay} ${dirWord} ideas have produced positive expectancy`
    case 'NEUTRAL':
      return `your historical record in ${symbolDisplay} ${dirWord} ideas is roughly break-even`
    case 'LIMITED EVIDENCE':
      return `the historical sample for this market is limited`
    case 'WEAK FIT':
      return `your previous ${symbolDisplay} ${dirWord} ideas have not been profitable`
    default:
      return `there is no trade history yet for ${symbolDisplay} ${dirWord} ideas`
  }
}

function conditionsClauseText(rating: TodaysConditionsRating | null, trendState: string | null, adx14: number | null): string {
  const isRanging = trendState === 'RANGE' || (adx14 != null && adx14 < 15)
  switch (rating) {
    case 'SUPPORTIVE':
      return isRanging
        ? `today's market is ranging, favouring a mean-reversion entry at this level`
        : `today's market remains in a ${regimeTrendLabel(trendState, adx14).toLowerCase()}`
    case 'MIXED':
      return `today's market conditions provide only partial support`
    case 'UNSUPPORTIVE':
      return `today's conditions work against the directional bias`
    default:
      return `today's market conditions are broadly neutral`
  }
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/**
 * "WHY THIS IS BEING RECOMMENDED" -- one to two sentences synthesising the two
 * evidence pillars. Never manufactures a positive read: if either pillar is
 * negative or the two disagree, the sentence says so explicitly rather than
 * defaulting to an upbeat tone. Built entirely from the two ratings above (which
 * are themselves built from existing thresholds) plus the plain-English trend
 * label already used elsewhere on this card -- no new data.
 */
export function recommendationSynthesis(
  symbolDisplay: string, direction: 'BUY' | 'SELL' | null,
  historicalRating: HistoricalProfileRating | null, conditionsRating: TodaysConditionsRating | null,
  trendState: string | null, adx14: number | null,
): string {
  const dirWord = direction ?? ''
  const hPol = historicalPolarity(historicalRating)
  const cPol = conditionsPolarity(conditionsRating)
  const hClause = historicalClauseText(historicalRating, symbolDisplay, dirWord)
  const cClause = conditionsClauseText(conditionsRating, trendState, adx14)

  if (hPol === 'positive' && cPol === 'positive') {
    const strength = historicalRating === 'STRONG FIT' ? 'strong' : 'positive'
    return `This setup combines a ${strength} historical fit with supportive current conditions. ${capitalize(hClause)}, while ${cClause}.`
  }
  if (hPol === 'positive' && cPol === 'negative') {
    return `${capitalize(hClause)}, but ${cClause} today — treat with caution.`
  }
  if (cPol === 'positive' && hPol === 'negative') {
    return `${capitalize(cClause)}, but ${hClause} — treat with caution.`
  }
  if (hPol === 'positive') {
    return `${capitalize(hClause)}, although ${cClause}.`
  }
  if (cPol === 'positive') {
    return `${capitalize(cClause)}, although ${hClause}.`
  }
  if (hPol === 'negative' || cPol === 'negative') {
    return `Neither your historical record nor today's conditions strongly support this setup: ${hClause}, and ${cClause}. Review carefully before proceeding.`
  }
  return `The evidence for this setup is mixed: ${hClause}, and ${cClause}.`
}
