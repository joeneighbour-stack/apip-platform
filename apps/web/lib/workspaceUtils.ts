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
 * One-line "why this recommendation" summary, shown directly on the card so
 * the trade thesis is visible without opening the coaching-note tooltip.
 * direction/winRate/trades aren't part of the actual sentence (only zone
 * position and trend strength are), so they're deliberately not parameters
 * here -- keeping the signature honest about what it uses.
 */
export function tradeSummary(currentZone: string | null, preferredZone: string | null, adx: number | null): string | null {
  if (!currentZone || !preferredZone || adx == null) return null

  const zoneContext = currentZone === preferredZone
    ? `Price is in the preferred ${zonePlainLabel(currentZone)} zone`
    : `Price is in ${zonePlainLabel(currentZone)}, targeting ${zonePlainLabel(preferredZone)}`

  const trendContext = adx < 15
    ? 'Low ADX confirms ranging conditions — mean reversion setup'
    : adx > 25
    ? `Strong trend (ADX ${adx.toFixed(0)}) supports directional bias`
    : `Moderate trend strength (ADX ${adx.toFixed(0)})`

  return `${zoneContext}. ${trendContext}.`
}

/** Abbreviated zone label for the 140px-wide ladder strip -- arrows instead of
 *  "High"/"Low" for the extreme zones, and the preferred-zone star folded
 *  directly into the label text rather than as a separate marker element. */
export function zoneLadderLabel(zone: string | null, isPreferred: boolean): string {
  switch (zone) {
    case 'TOO_DEEP': return 'Extreme ↓'
    case 'ZONE_1': return isPreferred ? 'Deep Value ★' : 'Deep Value'
    case 'ZONE_2': return isPreferred ? 'Value ★' : 'Value'
    case 'ZONE_3': return 'Fair Value'
    case 'ZONE_4': return 'Stretched'
    case 'TOO_HIGH': return 'Extreme ↑'
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

/** Same semantic colours as ZONE_BAND_BG_CLASS, as hex fills for the chart's
 *  Recharts ReferenceAreas (which take actual colour values, not classes).
 *  'neutral' renders as no fill at all -- matching the ladder's plain bg-card
 *  treatment for Zone 3 ("Fair Value") on both directions. */
export const ZONE_COLOUR_HEX: Record<ZoneSemanticColour, string | null> = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  neutral: null,
  muted: '#9ca3af',
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

/**
 * Shared y-axis price domain for the ladder + chart pairing: the zone range
 * (lowerBand to upperBand) with 2% padding on each side, so both widgets
 * scale to the exact same price window and their bands line up. Widened to
 * also cover the entry range as a safety net -- with engine-accurate zones,
 * the entry range should already fall inside [lowerBand, upperBand] (it's
 * derived from the same anchors), so this should rarely actually extend
 * anything in practice; it stays as a guard rather than an assumption.
 */
export function computeSharedYDomain(
  zoneBoundaries: ZoneBoundaries | null,
  entryRangeLow: number | null,
  entryRangeHigh: number | null,
): [number, number] | null {
  if (!zoneBoundaries) return null
  const rangeLow = zoneBoundaries.zone1.min
  const rangeHigh = zoneBoundaries.zone4.max
  const yMin = Math.min(rangeLow, entryRangeLow ?? rangeLow) * 0.98
  const yMax = Math.max(rangeHigh, entryRangeHigh ?? rangeHigh) * 1.02
  return [yMin, yMax]
}

export function zoneRangeFor(zone: AtrZone, b: ZoneBoundaries): { min: number; max: number } {
  switch (zone) {
    case 'TOO_HIGH': return b.tooHigh
    case 'ZONE_4': return b.zone4
    case 'ZONE_3': return b.zone3
    case 'ZONE_2': return b.zone2
    case 'ZONE_1': return b.zone1
    case 'TOO_DEEP': return b.tooDeep
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

// ============================================================================
// Recommendation card redesign -- evidence indicators, block ratings, and
// event grouping. All pure functions over already-fetched WorkspaceRow data;
// no new data sources. Colour is restricted to the same 4-value palette used
// throughout the redesign (green/amber/red/neutral) -- "grey" states from the
// spec (e.g. expired) render as 'neutral' with a distinguishing label, not a
// 5th colour, per the design principle that colour is used only for
// supportive/caution/risk/everything-else.
// ============================================================================

export type EvidenceStatus = 'green' | 'amber' | 'red' | 'neutral'

export interface EvidenceIndicator {
  status: EvidenceStatus
  label: string
}

export const EVIDENCE_STATUS_CLASS: Record<EvidenceStatus, string> = {
  green: 'text-green-700',
  amber: 'text-amber-600',
  red: 'text-red-600',
  neutral: 'text-muted-foreground',
}

export const EVIDENCE_STATUS_ICON: Record<EvidenceStatus, string> = {
  green: '✓',
  amber: '⚠',
  red: '⚠',
  neutral: '○',
}

/** Regime aligned: green if trend direction matches trade direction, amber if
 *  counter-trend, neutral (hidden by caller) if no regime/direction data. */
export function regimeAlignmentEvidence(direction: 'BUY' | 'SELL' | null, trendState: string | null): EvidenceIndicator | null {
  if (!direction || !trendState) return null
  if (trendState === 'TRENDING_UP') {
    return direction === 'BUY' ? { status: 'green', label: 'Regime aligned' } : { status: 'amber', label: 'Counter-trend' }
  }
  if (trendState === 'TRENDING_DOWN') {
    return direction === 'SELL' ? { status: 'green', label: 'Regime aligned' } : { status: 'amber', label: 'Counter-trend' }
  }
  return { status: 'neutral', label: 'Ranging market' }
}

/** Price location: same green/amber/red/neutral thresholds as zoneProximityClass. */
export function priceLocationEvidence(currentZone: string | null, preferredZone: string | null): EvidenceIndicator | null {
  if (!currentZone || !preferredZone) return null
  const cls = zoneProximityClass(currentZone, preferredZone)
  if (cls === 'neutral') return null
  const label = cls === 'green' ? 'Price at preferred zone'
    : cls === 'amber' ? 'Price near preferred zone'
    : 'Price far from preferred zone'
  return { status: cls, label }
}

/** Event risk: red if any HIGH-impact event today, amber if events exist but none
 *  are HIGH impact, hidden (null) if no relevant events at all. */
export function eventRiskEvidence(eventRiskItems: { impact: string }[]): EvidenceIndicator | null {
  if (eventRiskItems.length === 0) return null
  const hasHigh = eventRiskItems.some(e => e.impact === 'HIGH')
  return hasHigh ? { status: 'red', label: 'Major event risk' } : { status: 'amber', label: 'Event risk today' }
}

/** Entry status: green once price is at the preferred zone (ENTER_NOW), neutral
 *  while waiting, neutral-with-different-label once the session has expired. */
export function entryStatusEvidence(analystAction: string | null, isExpired: boolean): EvidenceIndicator {
  if (isExpired) return { status: 'neutral', label: 'Session expired' }
  if (analystAction === 'ENTER_NOW') return { status: 'green', label: 'Entry triggered' }
  return { status: 'neutral', label: 'Entry not triggered' }
}

/** Historical fit: green if avgR>0.10 & winRate>0.50, amber if avgR>0 & winRate>0.45,
 *  red if avgR<=0, hidden (null) if there's no historical data at all. */
export function historicalFitEvidence(avgR: number | null, winRate: number | null): EvidenceIndicator | null {
  if (avgR == null) return null
  if (avgR <= 0) return { status: 'red', label: 'Weak historical fit' }
  if (avgR > 0.10 && winRate != null && winRate > 0.50) return { status: 'green', label: 'Strong historical fit' }
  if (avgR > 0 && winRate != null && winRate > 0.45) return { status: 'amber', label: 'Moderate historical fit' }
  return { status: 'amber', label: 'Weak historical fit' }
}

/** Header status line: LEVELS OUTDATED > SESSION EXPIRED > ENTRY PASSED > ENTRY
 *  TRIGGERED > WAITING FOR ENTRY, in that priority order. */
export function recommendationStatusLabel(
  isDoNotUse: boolean, isEntryPassed: boolean, analystAction: string | null, isExpired: boolean,
): string {
  if (isDoNotUse) return 'LEVELS OUTDATED'
  if (isExpired) return 'SESSION EXPIRED'
  if (isEntryPassed) return 'ENTRY PASSED'
  if (analystAction === 'ENTER_NOW') return 'ENTRY TRIGGERED'
  return 'WAITING FOR ENTRY'
}

export type BlockRating = 'Strong' | 'Neutral' | 'Weak' | 'Good' | 'Caution' | 'Positive'

export const BLOCK_RATING_CLASS: Record<BlockRating, string> = {
  Strong: 'text-green-700', Good: 'text-green-700', Positive: 'text-green-700',
  Neutral: 'text-muted-foreground',
  Caution: 'text-amber-600',
  Weak: 'text-red-600',
}

/** Section 4 Block 1 -- Price Location rating. Caller only invokes this once
 *  currentZone/preferredZone are both known to be present. */
export function priceLocationRating(currentZone: string, preferredZone: string): 'Strong' | 'Neutral' | 'Weak' {
  const cls = zoneProximityClass(currentZone, preferredZone)
  if (cls === 'green') return 'Strong'
  if (cls === 'amber') return 'Neutral'
  return 'Weak'
}

function isTrendingRegime(trendState: string | null, adx14: number | null): boolean {
  return adx14 != null && adx14 >= 25 && (trendState === 'TRENDING_UP' || trendState === 'TRENDING_DOWN')
}

function isRegimeAligned(direction: 'BUY' | 'SELL' | null, trendState: string | null): boolean {
  return (trendState === 'TRENDING_UP' && direction === 'BUY') || (trendState === 'TRENDING_DOWN' && direction === 'SELL')
}

/** Section 4 Block 2 -- Regime Fit rating. */
export function regimeFitRating(direction: 'BUY' | 'SELL' | null, trendState: string | null, adx14: number | null): 'Good' | 'Neutral' | 'Caution' {
  if (!isTrendingRegime(trendState, adx14)) return 'Neutral'
  return isRegimeAligned(direction, trendState) ? 'Good' : 'Caution'
}

/** Section 4 Block 2 / Section 6 -- one-line regime interpretation, per the
 *  spec's explicit ranging / trending-aligned / trending-counter rule order. */
export function regimeFitInterpretation(direction: 'BUY' | 'SELL' | null, trendState: string | null, adx14: number | null): string {
  if (!isTrendingRegime(trendState, adx14)) return 'Range conditions favour mean-reversion setups.'
  return isRegimeAligned(direction, trendState)
    ? 'Trend conditions support directional bias.'
    : 'Setup trades against prevailing trend — lower probability.'
}

/** Section 4 Block 3 -- Historical Evidence rating. Caller only invokes this
 *  once avgR is known to be non-null (i.e. some historical data exists). */
export function historicalEvidenceRating(avgR: number): 'Positive' | 'Neutral' | 'Weak' {
  if (avgR <= 0) return 'Weak'
  if (avgR > 0.10) return 'Positive'
  return 'Neutral'
}

/** Section 6 -- Market Conditions one-line interpretation, per the spec's
 *  explicit rule priority: ranging+aligned, trending+aligned, trending+counter,
 *  low volatility, else none. */
export function marketConditionsInterpretation(
  direction: 'BUY' | 'SELL' | null, currentZone: string | null, preferredZone: string | null,
  trendState: string | null, adx14: number | null, atrPercentile: number | null,
): string | null {
  const zoneAligned = currentZone != null && preferredZone != null && currentZone === preferredZone
  const isRanging = trendState === 'RANGE' || (adx14 != null && adx14 < 15)
  if (isRanging && zoneAligned) return 'Range conditions support mean-reversion.'
  if (isTrendingRegime(trendState, adx14)) {
    return isRegimeAligned(direction, trendState)
      ? 'Trend direction supports this setup.'
      : 'Prevailing trend works against this setup.'
  }
  if (atrPercentile != null && atrPercentile <= 20) return 'Compressed volatility — potential for directional move.'
  return null
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
