// Pure helpers for the analyst "My Workspace" coverage strip + detail card.
// No I/O -- everything here takes already-fetched, already-computed values.

import { formatR, formatPercent } from './format'

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

/**
 * Actionable price-location label for the coverage strip's Zone column,
 * replacing the raw "Fair Value -> Stretched" zone-jargon pairing with what
 * it means for whether to act now. Distance is measured on ZONE_LADDER_ORDER's
 * ascending-price ordering (not display order) between currentZone and
 * preferredZone; direction determines which side of "needs to move" applies.
 */
export function coverageZoneLabel(
  currentZone: string | null, preferredZone: string | null, direction: string | null,
): { label: string; className: string } {
  if (!currentZone || !preferredZone) return { label: '—', className: 'text-muted-foreground' }

  if (currentZone === preferredZone) return { label: 'At entry', className: 'text-green-600 font-medium' }

  const currentIdx = ZONE_PRICE_ORDER.indexOf(currentZone as AtrZone)
  const preferredIdx = ZONE_PRICE_ORDER.indexOf(preferredZone as AtrZone)
  if (currentIdx < 0 || preferredIdx < 0) return { label: '—', className: 'text-muted-foreground' }
  const distance = Math.abs(currentIdx - preferredIdx)

  if (direction === 'BUY') {
    // Preferred entry is the lower zone -- price needs to fall to reach it.
    if (currentIdx > preferredIdx) {
      if (distance === 1) return { label: 'Near entry', className: 'text-amber-600' }
      if (distance === 2) return { label: 'Pullback needed', className: 'text-muted-foreground' }
      return { label: 'Extended above', className: 'text-muted-foreground' }
    }
    return { label: 'Below entry', className: 'text-muted-foreground' }
  }

  if (direction === 'SELL') {
    // Preferred entry is the higher zone -- price needs to rise to reach it.
    if (currentIdx < preferredIdx) {
      if (distance === 1) return { label: 'Near entry', className: 'text-amber-600' }
      if (distance === 2) return { label: 'Rally needed', className: 'text-muted-foreground' }
      return { label: 'Extended below', className: 'text-muted-foreground' }
    }
    return { label: 'Above entry', className: 'text-muted-foreground' }
  }

  return { label: '—', className: 'text-muted-foreground' }
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
// Recommendation-brief redesign -- primary recommendation taxonomy and a
// natural-language synthesis. The historical pillar's rating is now the
// tiered EvidenceTier system above; this section covers the conditions
// pillar (isTrendingRegime, isRegimeAligned, zoneProximityClass) and the
// combined synthesis sentence.
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

// ============================================================================
// Tiered evidence -- MARKET / REGIME / DIRECTION / NONE. Mirrors
// intelligence-engine/src/services/analystScoringService.ts's tier system
// exactly (same names, same MARKET/REGIME/DIRECTION minimum-trade thresholds,
// same asset-class-scoped regime rollup for the REGIME tier) so the direction
// the engine picked and the evidence shown for it come from the same logic,
// not two independently-tuned readings of the same data.
// ============================================================================

export type EvidenceTierName = 'MARKET' | 'REGIME' | 'DIRECTION' | 'NONE'

export interface EvidenceTier {
  tier: EvidenceTierName
  avgR: number
  winRate: number
  tradeCount: number
  marketCount?: number // set only for REGIME -- how many markets were rolled up
  profileQuality: 'HIGH' | 'MEDIUM' | 'LOW'
  label: string // e.g. "EURUSD SELL" / "SELL in ranging low-vol FX markets"
}

interface TierProfileData {
  trade_count: number
  avg_r: number
  win_rate: number
  profile_quality: 'HIGH' | 'MEDIUM' | 'LOW'
  regime: string | null
  volatility_state: string | null
  has_regime_data: boolean
}

export interface TierProfile {
  market_id: string
  direction: 'BUY' | 'SELL'
  asset_class: string
  profile_data: TierProfileData
}

const MARKET_MIN_TRADES = 20
// Lowered from 10 to 5, mirroring the identical change in
// intelligence-engine/src/services/analystScoringService.ts: generateAnalystProfiles.ts
// now writes a row for every bucket down to 1 trade (MIN_PROFILE_TRADES), so
// the aggregate this rolls up is denser than before -- 5 real trades is
// still a thin sample (tierQualityFromCount grades it LOW), but a real one.
const REGIME_MIN_TRADES = 5
// Lowered from 10 to 5 alongside REGIME_MIN_TRADES so the two tiers stay on
// the same footing, and to keep this file mirroring analystScoringService.ts's
// scoreAnalystForMarket() exactly (same tier boundaries, same thresholds).
const DIRECTION_MIN_TRADES = 5
// Same thresholds generateAnalystProfiles.ts's profileQuality() uses -- reused
// (not reinvented) to grade the REGIME tier's aggregated sample, which has no
// single stored profile_quality of its own.
const TIER_HIGH_MIN_TRADES = 50
const TIER_MEDIUM_MIN_TRADES = 20

function tierQualityFromCount(tradeCount: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (tradeCount >= TIER_HIGH_MIN_TRADES) return 'HIGH'
  if (tradeCount >= TIER_MEDIUM_MIN_TRADES) return 'MEDIUM'
  return 'LOW'
}

function weightedAvg(rows: TierProfile[], field: 'avg_r' | 'win_rate'): number {
  const total = rows.reduce((s, p) => s + p.profile_data.trade_count, 0)
  if (total === 0) return 0
  return rows.reduce((s, p) => s + p.profile_data[field] * p.profile_data.trade_count, 0) / total
}

function trendStateWord(trendState: string | null): string {
  switch (trendState) {
    case 'TRENDING_UP': return 'trending up'
    case 'TRENDING_DOWN': return 'trending down'
    case 'RANGE': return 'ranging'
    // "mixed-trend" rather than bare "mixed" so this tier label reads
    // consistently with trendLabel()'s "Conflicting signals" headline for the
    // same MIXED trend_state -- both now name the trend explicitly instead of
    // one saying "mixed" and the other "conflicting".
    case 'MIXED': return 'mixed-trend'
    default: return 'unclassified'
  }
}

/**
 * Picks which evidence tier to show for an already-decided direction, trying
 * the most specific first and falling through -- same tier boundaries and
 * minimum-trade thresholds as analystScoringService.ts's scoreAnalystForMarket().
 */
export function selectEvidenceTier(
  marketProfiles: TierProfile[], // this market's own profile rows
  allProfiles: TierProfile[],    // this analyst's full profile set, every market
  assetClass: string,
  direction: 'BUY' | 'SELL',
  trendState: string | null,
  volatilityState: string | null,
  marketSymbol: string,
): EvidenceTier {
  // Tiers 1-2 require a genuine today's-regime reading. Without one, matching
  // on trendState/volatilityState === null would accidentally pick up the
  // regime-agnostic fallback profile rows (regime: null means "we don't have
  // regime data for this historical bucket", not "today is unclassified") --
  // that's what Tier 3 already handles explicitly, so a null reading here
  // skips straight to it rather than double-counting under the wrong label.
  const hasRegimeReading = trendState !== null && volatilityState !== null

  // Tier 1 -- MARKET specific
  const marketProfile = hasRegimeReading ? marketProfiles.find(p =>
    p.direction === direction &&
    p.profile_data.regime === trendState &&
    p.profile_data.volatility_state === volatilityState
  ) : undefined
  if (marketProfile && marketProfile.profile_data.trade_count >= MARKET_MIN_TRADES) {
    return {
      tier: 'MARKET',
      avgR: marketProfile.profile_data.avg_r,
      winRate: marketProfile.profile_data.win_rate,
      tradeCount: marketProfile.profile_data.trade_count,
      profileQuality: marketProfile.profile_data.profile_quality,
      label: `${marketSymbol} ${direction}`,
    }
  }

  // Tier 2 -- REGIME rollup, same asset class, matched on trend_state only
  // (not volatility_state too). generateAnalystProfiles.ts buckets by
  // trend+volatility+zone, so requiring an exact volatility match here on top
  // of the trend match double-filters an already-thin per-market sample --
  // confirmed live for EURUSD/Ian Coleman: TRENDING_DOWN+LOW_VOL had only 3
  // matching FX-wide trades (below REGIME_MIN_TRADES), while TRENDING_DOWN
  // alone (any volatility) had 37, a perfectly usable sample. This tier's own
  // label/subtext already call it "comparable conditions", not "identical
  // conditions" -- MARKET (tier 1) remains the tier that requires an exact
  // volatility match.
  const regimeProfiles = hasRegimeReading ? allProfiles.filter(p =>
    p.direction === direction &&
    p.profile_data.regime === trendState &&
    p.asset_class === assetClass
  ) : []
  const regimeTotalTrades = regimeProfiles.reduce((s, p) => s + p.profile_data.trade_count, 0)
  if (regimeTotalTrades >= REGIME_MIN_TRADES) {
    return {
      tier: 'REGIME',
      avgR: weightedAvg(regimeProfiles, 'avg_r'),
      winRate: weightedAvg(regimeProfiles, 'win_rate'),
      tradeCount: regimeTotalTrades,
      marketCount: new Set(regimeProfiles.map(p => p.market_id)).size,
      profileQuality: tierQualityFromCount(regimeTotalTrades),
      // Volatility dropped from the label to match what's actually matched now (trend only).
      label: `${direction} in ${trendStateWord(trendState)} ${assetClass} markets`,
    }
  }

  // Tier 3 -- DIRECTION fallback, market specific, regime-agnostic
  const directionProfile = marketProfiles.find(p =>
    p.direction === direction && !p.profile_data.has_regime_data
  )
  if (directionProfile && directionProfile.profile_data.trade_count >= DIRECTION_MIN_TRADES) {
    return {
      tier: 'DIRECTION',
      avgR: directionProfile.profile_data.avg_r,
      winRate: directionProfile.profile_data.win_rate,
      tradeCount: directionProfile.profile_data.trade_count,
      profileQuality: directionProfile.profile_data.profile_quality,
      label: `${direction} setups (all conditions)`,
    }
  }

  return { tier: 'NONE', avgR: 0, winRate: 0, tradeCount: 0, profileQuality: 'LOW', label: '' }
}

/** The one-line explanation shown under the win rate/expectancy/sample row --
 *  factual context for why this tier was used, never a hedge about how much
 *  to trust the numbers just shown. */
export function evidenceTierSubtext(tier: EvidenceTier, marketSymbol: string): string {
  switch (tier.tier) {
    case 'MARKET': return 'Market + direction + regime matched'
    case 'REGIME': return `${marketSymbol}-specific history is limited — showing comparable conditions`
    case 'DIRECTION': return 'No regime-matched history available for this market'
    default: return ''
  }
}

/** "Why This Is Being Recommended" opening clause -- one of exactly four
 *  shapes depending on which tier supplied the evidence. Always states what
 *  the data says; never hedges about whether to trust it. */
export function evidenceTierClause(
  tier: EvidenceTier, direction: 'BUY' | 'SELL' | null, assetClass: string | null, marketSymbol: string,
): string {
  const dirWord = direction ?? ''
  switch (tier.tier) {
    case 'MARKET':
      return `Based on your ${tier.tradeCount} trades on ${marketSymbol} in these conditions, `
        + `you've achieved ${formatPercent(tier.winRate)} win rate and ${formatR(tier.avgR)} expectancy`
    case 'REGIME': {
      const marketCount = tier.marketCount ?? 0
      return `Based on your ${tier.tradeCount} ${dirWord} setups in comparable ${assetClass ?? ''} conditions `
        + `across ${marketCount} market${marketCount === 1 ? '' : 's'}, you've achieved ${formatPercent(tier.winRate)} win rate and ${formatR(tier.avgR)} expectancy`
    }
    case 'DIRECTION':
      return `Based on your overall ${dirWord} track record (${tier.tradeCount} trades), `
        + `you've achieved ${formatPercent(tier.winRate)} win rate and ${formatR(tier.avgR)} expectancy`
    default:
      return 'This market is new territory for you — no historical pattern available'
  }
}

export type TodaysConditionsRating = 'SUPPORTIVE' | 'MIXED' | 'CONFLICTING'

/**
 * TODAY'S CONDITIONS rating. Combines the two objective signals this card
 * already computes elsewhere -- regime fit (isTrendingRegime/isRegimeAligned,
 * the same pair regimeFitRating() uses) and price location (zoneProximityClass,
 * the same function priceLocationRating() uses) -- into one read. Counter-trend,
 * or price sitting far from the preferred zone, is CONFLICTING (the strongest
 * single negative signal); trend-aligned + at-zone, or ranging + at-zone (the
 * existing mean-reversion rule from marketConditionsInterpretation), is
 * SUPPORTIVE; everything else (trend-aligned but not yet at zone, or no strong
 * signal either way) is MIXED -- some factors agree, others don't, or neither
 * pillar has a clear read. Three tiers only, matching the redesign's SUPPORTIVE/
 * MIXED/CONFLICTING taxonomy -- no thresholds here are new, only the label a
 * given branch maps to. Returns null when there's no regime data at all.
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

  if (trending && !aligned) return 'CONFLICTING'
  if (aligned && atZone) return 'SUPPORTIVE'
  if (!trending && atZone) return 'SUPPORTIVE'
  if (aligned && !atZone) return 'MIXED'
  if (proximity === 'red') return 'CONFLICTING'
  return 'MIXED'
}

type Polarity = 'positive' | 'neutral' | 'negative'

function evidenceTierPolarity(tier: EvidenceTier): Polarity {
  if (tier.tier === 'NONE') return 'neutral'
  if (tier.avgR > 0) return 'positive'
  if (tier.avgR < 0) return 'negative'
  return 'neutral'
}

function conditionsPolarity(r: TodaysConditionsRating | null): Polarity {
  if (r === 'SUPPORTIVE') return 'positive'
  if (r === 'CONFLICTING') return 'negative'
  return 'neutral' // MIXED or no data
}

/** Full-sentence regime phrase, each shape grammatically complete on its own
 *  (no trailing bare adjective) -- used where regimeTrendLabel()'s short noun
 *  phrase ("Ranging", "Strong Uptrend") would otherwise get spliced into a
 *  sentence like "remains in a ranging", which reads as truncated. Keyed off
 *  trendState directly rather than regimeTrendLabel()'s output because
 *  regimeTrendLabel() collapses both RANGE and MIXED to "Ranging", which would
 *  mislabel a genuinely MIXED (conflicting-signal) regime as ranging here. */
function conditionsRegimePhrase(trendState: string | null): string {
  switch (trendState) {
    case 'TRENDING_UP': return 'an uptrending market'
    case 'TRENDING_DOWN': return 'a downtrending market'
    case 'MIXED': return 'mixed conditions'
    case 'RANGE': return 'a ranging market'
    default: return 'unclear conditions'
  }
}

function conditionsClauseText(rating: TodaysConditionsRating | null, trendState: string | null, adx14: number | null): string {
  const isRanging = trendState === 'RANGE' || (adx14 != null && adx14 < 15)
  switch (rating) {
    case 'SUPPORTIVE':
      return isRanging
        ? `today's market is ranging, favouring a mean-reversion entry at this level`
        : `today's market remains in ${conditionsRegimePhrase(trendState)}`
    case 'MIXED':
      return `today's market conditions provide only partial support`
    case 'CONFLICTING':
      return `today's conditions work against the directional bias`
    default:
      return `today's market conditions are broadly neutral`
  }
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/**
 * "WHY THIS IS BEING RECOMMENDED" -- leads with the evidence tier's own
 * template clause (evidenceTierClause(), one of exactly four shapes depending
 * on MARKET/REGIME/DIRECTION/NONE), then states today's conditions as a plain
 * factual sentence. Never hedges about how much to trust the numbers just
 * shown -- if a tier has data, the data speaks for itself; the only place
 * this reads as cautious is when conditions genuinely conflict with the
 * historical bias, which is a real signal, not an apology.
 */
export function recommendationSynthesis(
  evidenceTier: EvidenceTier, tierClause: string,
  conditionsRating: TodaysConditionsRating | null, trendState: string | null, adx14: number | null,
): string {
  const tierSentence = `${capitalize(tierClause)}.`
  if (evidenceTier.tier === 'NONE') return tierSentence

  const hPol = evidenceTierPolarity(evidenceTier)
  const cPol = conditionsPolarity(conditionsRating)
  const cClause = `${capitalize(conditionsClauseText(conditionsRating, trendState, adx14))}.`

  if (hPol === 'positive' && cPol === 'negative') {
    return `${tierSentence} However, ${cClause.charAt(0).toLowerCase()}${cClause.slice(1)} A conditional setup to watch rather than an immediate entry.`
  }
  return `${tierSentence} ${cClause}`
}

// ============================================================================
// "Today's Conditions" plain-English redesign -- trend/volatility/price
// location each get a headline (one line, prominent) and an implication
// (what it means for this trade), replacing raw enum labels and unexplained
// zone jargon. ADX and the volatility percentile are folded into the
// headlines themselves (Keep: "ADX number -- always show it") rather than
// shown as separate rows. `!= null` is used throughout instead of truthy
// checks -- adx/atrPercentile of exactly 0 is a real, if rare, value and
// would otherwise be dropped by a `adx && ...` check.
// ============================================================================

export interface ConditionLabel {
  headline: string
  implication: string
}

export function trendLabel(trendState: string | null, adx: number | null): ConditionLabel {
  if (!trendState || trendState === 'RANGE') {
    if (adx != null && adx < 15) return {
      headline: `Ranging — no directional bias`,
      implication: `Suits mean-reversion setups. Price likely to oscillate within its range. ADX ${Math.round(adx)} confirms the lack of a directional trend.`,
    }
    return {
      headline: `Ranging`,
      implication: 'No strong trend. Mean-reversion setups favoured over trend-following.',
    }
  }

  if (trendState === 'TRENDING_UP') {
    if (adx != null && adx > 30) return {
      headline: `Strong uptrend`,
      implication: `Momentum is firmly bullish. BUY dips favoured, SELL rallies higher risk. ADX ${Math.round(adx)} confirms strong trend strength.`,
    }
    if (adx != null && adx > 20) return {
      headline: `Uptrend in progress`,
      implication: `Bullish bias. BUY setups have trend support, SELL setups are counter-trend. ADX ${Math.round(adx)} confirms meaningful trend strength.`,
    }
    return {
      headline: `Mild upward bias`,
      implication: 'Weak bullish lean. Trend support is limited.',
    }
  }

  if (trendState === 'TRENDING_DOWN') {
    if (adx != null && adx > 30) return {
      headline: `Strong downtrend`,
      implication: `Momentum is firmly bearish. SELL rallies favoured, BUY dips higher risk. ADX ${Math.round(adx)} confirms strong trend strength.`,
    }
    if (adx != null && adx > 20) return {
      headline: `Downtrend in progress`,
      implication: `Bearish bias. SELL setups have trend support, BUY setups are counter-trend. ADX ${Math.round(adx)} confirms meaningful trend strength.`,
    }
    return {
      headline: `Mild downward bias`,
      implication: 'Weak bearish lean. Trend support is limited.',
    }
  }

  if (trendState === 'MIXED') {
    if (adx != null && adx < 15) return {
      headline: `Conflicting signals — low momentum`,
      implication: `Trend signals disagree and momentum is weak. Lower probability for directional setups. ADX ${Math.round(adx)} confirms weak momentum.`,
    }
    if (adx != null && adx > 25) return {
      headline: `Conflicting signals — momentum present`,
      implication: `Trend signals disagree despite reasonable momentum. Exercise extra caution on direction. ADX ${Math.round(adx)} confirms momentum is present.`,
    }
    return {
      headline: `Conflicting signals`,
      implication: 'Short and longer-term trend signals are not aligned. Reduce position sizing.',
    }
  }

  return { headline: 'Trend unclear', implication: 'Insufficient data to classify trend conditions.' }
}

/** Named distinctly from the existing volatilityLabel(atrPercentile) -> string
 *  (still used by SupportingEvidence.tsx's "Detailed regime & volatility"
 *  subsection, out of scope here) -- this one takes volatility_state directly
 *  and returns the headline/implication pair for the Today's Conditions block. */
export function volatilityConditionLabel(volatilityState: string | null, atrPercentile: number | null): ConditionLabel {
  if (!volatilityState) return { headline: 'Volatility unknown', implication: '' }

  const pctClause = atrPercentile != null ? ` ATR sits at the ${ordinal(atrPercentile)} percentile of recent history.` : ''

  switch (volatilityState) {
    case 'LOW_VOL': return {
      headline: `Compressed`,
      implication: `Price movement is historically quiet. Entry ranges more likely to hold. Potential for sharp move if compressed too long.${pctClause}`,
    }
    case 'NORMAL_VOL': return {
      headline: `Normal`,
      implication: 'Typical market conditions. Standard position sizing applies.',
    }
    case 'HIGH_VOL': return {
      headline: `Elevated`,
      implication: `Price movement is above average. Wider stops may be needed. Reduce position size.${pctClause}`,
    }
    case 'EXTREME_VOL': return {
      headline: `Extreme`,
      implication: `Unusually large price swings. High risk of stop-outs. Consider sitting out or halving position size.${pctClause}`,
    }
    default: return { headline: volatilityState, implication: '' }
  }
}

const BUY_WAITING_ZONES = new Set(['ZONE_3', 'ZONE_4', 'TOO_HIGH', 'ZONE_2'])
const SELL_WAITING_ZONES = new Set(['ZONE_1', 'ZONE_2', 'TOO_DEEP', 'ZONE_3'])

export function priceLocationLabel(
  currentZone: string | null, preferredZone: string | null, direction: 'BUY' | 'SELL' | null,
  entryRangeLow: number | null, entryRangeHigh: number | null, currentPrice: number | null,
): ConditionLabel {
  const entryRangeText = entryRangeLow != null && entryRangeHigh != null
    ? `${entryRangeLow.toFixed(2)}–${entryRangeHigh.toFixed(2)}`
    : 'the suggested range'

  if (currentZone != null && currentZone === preferredZone) {
    return {
      headline: 'At entry zone — consider now',
      implication: `Price is within the suggested entry range (${entryRangeText}). Setup is active.`,
    }
  }

  const waitingForPullback = direction === 'BUY' && currentZone != null && BUY_WAITING_ZONES.has(currentZone)
  const waitingForRally = direction === 'SELL' && currentZone != null && SELL_WAITING_ZONES.has(currentZone)

  if (waitingForPullback) {
    const distance = currentPrice != null && entryRangeHigh != null ? ` Currently ${(currentPrice - entryRangeHigh).toFixed(2)} above entry.` : ''
    return {
      headline: 'Above entry — waiting for pullback',
      implication: `Price needs to pull back to ${entryRangeText} to trigger.${distance}`,
    }
  }

  if (waitingForRally) {
    const distance = currentPrice != null && entryRangeLow != null ? ` Currently ${(entryRangeLow - currentPrice).toFixed(2)} below entry.` : ''
    return {
      headline: 'Below entry — waiting for rally',
      implication: `Price needs to rally to ${entryRangeText} to trigger.${distance}`,
    }
  }

  if (currentZone === 'TOO_HIGH') return {
    headline: 'Extremely stretched — above normal range',
    implication: 'Price is well above its typical range. High-risk area for new longs. SELL setups may be compelling but require confirmation.',
  }
  if (currentZone === 'TOO_DEEP') return {
    headline: 'Extremely oversold — below normal range',
    implication: 'Price is well below its typical range. High-risk area for new shorts. BUY setups may be compelling but require confirmation.',
  }

  return { headline: 'In range', implication: 'Price is within normal trading range.' }
}

/** One paragraph combining trend + direction + zone into a plain-English
 *  setup description, replacing the static SUPPORTIVE/MIXED/CONFLICTING
 *  badge -- always says something concrete about this specific setup rather
 *  than a bare classification word. */
export function setupContext(
  direction: 'BUY' | 'SELL' | null, trendState: string | null,
  currentZone: string | null, preferredZone: string | null, adx: number | null,
): string {
  const isTrendAligned =
    (direction === 'BUY' && trendState === 'TRENDING_UP') ||
    (direction === 'SELL' && trendState === 'TRENDING_DOWN')

  const isCounterTrend =
    (direction === 'BUY' && trendState === 'TRENDING_DOWN') ||
    (direction === 'SELL' && trendState === 'TRENDING_UP')

  const isRanging = trendState === 'RANGE' || (adx != null && adx < 15)
  // != null-guarded, not the bare `currentZone === preferredZone` a naive
  // check would use -- two nulls would otherwise read as "at entry" when
  // neither zone is actually known.
  const atEntry = currentZone != null && currentZone === preferredZone

  // Price already being at the entry zone overrides every other framing below:
  // "approaching" or "waiting for" language would directly contradict
  // priceLocationLabel()'s "At entry zone — consider now" headline shown
  // alongside this text.
  if (atEntry) {
    if (isRanging) return `Mean-reversion ${direction} — price is now at the entry zone. Ranging conditions support a fade. Consider acting now.`
    if (isTrendAligned) return `Trend-following ${direction} — price has pulled back into the entry zone with trend intact. Setup is active — consider acting now.`
    if (isCounterTrend) return `Counter-trend ${direction} — price is at the entry zone. This trades against the prevailing trend — apply strict risk management.`
    return `${direction ?? 'This'} setup — price is at the suggested entry zone. Setup is active.`
  }

  if (isRanging) {
    if (direction === 'SELL') return `Mean-reversion SELL — price has extended above its normal range. The system is waiting for a rally into resistance before selling. Low trend momentum supports a fade approach.`
    if (direction === 'BUY') return `Mean-reversion BUY — price has pulled back below its normal range. The system is waiting for a dip into support before buying. Low trend momentum supports a fade approach.`
  }

  if (isTrendAligned) {
    return `Trend-following ${direction} — waiting for price to pull back into the entry zone. The broader trend supports this direction once entry triggers.`
  }

  if (isCounterTrend) {
    return `Counter-trend ${direction} — this setup trades against the prevailing ${direction === 'BUY' ? 'downtrend' : 'uptrend'}. Higher risk than a trend-aligned setup. The historical edge for this analyst in these conditions drives the recommendation despite the trend headwind.`
  }

  return `${direction ?? 'This'} setup — price approaching the suggested entry zone. Monitor for confirmation before acting.`
}
