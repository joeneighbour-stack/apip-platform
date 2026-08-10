// ============================================================================
// AnalystScoringService
// ============================================================================
// Scores a single analyst's fit for a market under today's regime, using the
// analyst_profiles rows generateAnalystProfiles.ts already writes, in three
// tiers of decreasing specificity:
//   MARKET   -- this analyst, this market, this trend+volatility regime,
//               trade_count >= MARKET_MIN_TRADES
//   REGIME   -- this analyst, same asset class, same trend+volatility regime,
//               rolled up across every market that qualifies, aggregate
//               trade_count >= REGIME_MIN_TRADES
//   DIRECTION -- this analyst, this market, regime-agnostic fallback,
//               trade_count >= DIRECTION_MIN_TRADES
//   NONE     -- no tier has a usable signal
// Zone matching (the FULL tier from the previous design) is deliberately
// dropped here -- zone is only meaningfully populated on analyst_profiles
// rows from 2026-01-01 onward, too thin a sample to be a reliable direction
// signal on its own; the REGIME rollup gives a denser, still-honest signal
// instead of stretching a near-empty zone tier.
//
// Pure function, no I/O -- callers load analyst_profiles rows (enriched with
// each row's market asset_class) once and pass them in.
// ============================================================================

export interface AnalystProfileRow {
  analyst_id: string
  market_id: string
  direction: 'BUY' | 'SELL'
  zone: string | null
  asset_class: string // joined in by the caller from markets.asset_class
  profile_data: {
    trade_count: number
    avg_r: number
    win_rate: number
    trigger_rate: number
    profile_quality: 'HIGH' | 'MEDIUM' | 'LOW'
    regime: string | null
    volatility_state?: string | null
    zone?: string | null
    has_regime_data: boolean
  }
}

export type ProfileTier = 'MARKET' | 'REGIME' | 'DIRECTION' | 'NONE'

export type DirectionAlignment = 'TREND_ALIGNED' | 'COUNTER_TREND' | 'NEUTRAL' | 'NONE'

export interface AnalystScore {
  analystId: string
  marketId: string
  preferredDirection: 'BUY' | 'SELL' | null
  avgR: number
  profileTier: ProfileTier
  profileQuality: 'HIGH' | 'MEDIUM' | 'LOW' | null
  confidence: number // 0-1
  // How this analyst's preferred direction relates to today's trend regime --
  // TREND_ALIGNED/COUNTER_TREND/NEUTRAL (RANGE or MIXED, where neither side
  // is favoured) or NONE (no direction picked, or no regime reading at all).
  directionAlignment: DirectionAlignment
  // Multiplies confidence x avgR at the call site so a counter-trend pick
  // needs a meaningfully stronger historical edge to outrank a trend-aligned
  // one, rather than the two competing on raw edge alone.
  alignmentMultiplier: number
}

const TIER_WEIGHT: Record<ProfileTier, number> = { MARKET: 1.0, REGIME: 0.75, DIRECTION: 0.50, NONE: 0.0 }
const QUALITY_WEIGHT: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = { HIGH: 1.0, MEDIUM: 0.7, LOW: 0.4 }
const CONFIDENCE_TRADE_CAP = 50

const MARKET_MIN_TRADES = 20
// Lowered from 10 to 5: generateAnalystProfiles.ts now writes a row for
// every bucket down to 1 trade (MIN_PROFILE_TRADES), so the aggregate this
// rolls up is denser than before -- 5 real trades across a rollup is still
// a thin sample (profileQuality/qualityFromCount grades it LOW), but a real
// one, not a threshold tuned for a since-relaxed per-bucket floor.
const REGIME_MIN_TRADES = 5
// Lowered from 10 to 5 alongside REGIME_MIN_TRADES so the two tiers stay on
// the same footing, and to keep this file mirroring workspaceUtils.ts's
// selectEvidenceTier() exactly (same tier boundaries, same thresholds) --
// see that file's identical change.
const DIRECTION_MIN_TRADES = 5

// Same thresholds profileQuality() in generateAnalystProfiles.ts already uses
// -- reused here (not reinvented) to grade the REGIME tier's aggregated
// sample, which has no single stored profile_quality of its own.
const HIGH_CONFIDENCE_MIN_TRADES = 50
const MEDIUM_CONFIDENCE_MIN_TRADES = 20

function qualityFromCount(tradeCount: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (tradeCount >= HIGH_CONFIDENCE_MIN_TRADES) return 'HIGH'
  if (tradeCount >= MEDIUM_CONFIDENCE_MIN_TRADES) return 'MEDIUM'
  return 'LOW'
}

function weightedAvgR(rows: AnalystProfileRow[]): number {
  const total = rows.reduce((s, p) => s + p.profile_data.trade_count, 0)
  if (total === 0) return 0
  return rows.reduce((s, p) => s + p.profile_data.avg_r * p.profile_data.trade_count, 0) / total
}

interface DirectionCandidate {
  avgR: number
  tradeCount: number
  quality: 'HIGH' | 'MEDIUM' | 'LOW'
}

interface DirectionPick extends DirectionCandidate {
  direction: 'BUY' | 'SELL' | null
}

function fromProfile(p: AnalystProfileRow): DirectionCandidate {
  return { avgR: p.profile_data.avg_r, tradeCount: p.profile_data.trade_count, quality: p.profile_data.profile_quality }
}

function fromRollup(rows: AnalystProfileRow[]): DirectionCandidate | null {
  const tradeCount = rows.reduce((s, p) => s + p.profile_data.trade_count, 0)
  if (tradeCount === 0) return null
  return { avgR: weightedAvgR(rows), tradeCount, quality: qualityFromCount(tradeCount) }
}

/**
 * Picks a direction between an optional BUY-side and SELL-side candidate at
 * the same tier: whichever has positive avgR wins; if both are positive, the
 * higher avgR wins; if neither is positive, still returns whichever candidate
 * had the higher avgR (so tier/quality/avgR stay honest for logging) but with
 * direction: null -- the caller's own analyst-vs-analyst comparison (confidence
 * x avgR) naturally deprioritises a null-direction pick against any analyst
 * with a genuinely positive one. Returns null only when neither side exists.
 */
function pickBetween(buy: DirectionCandidate | null, sell: DirectionCandidate | null): DirectionPick | null {
  if (buy && buy.avgR > 0 && sell && sell.avgR > 0) {
    return buy.avgR >= sell.avgR ? { direction: 'BUY', ...buy } : { direction: 'SELL', ...sell }
  }
  if (buy && buy.avgR > 0) return { direction: 'BUY', ...buy }
  if (sell && sell.avgR > 0) return { direction: 'SELL', ...sell }
  if (buy && sell) return buy.avgR >= sell.avgR ? { direction: null, ...buy } : { direction: null, ...sell }
  if (buy) return { direction: null, ...buy }
  if (sell) return { direction: null, ...sell }
  return null
}

/**
 * How preferredDirection relates to today's trend regime. RANGE/MIXED are
 * NEUTRAL, not COUNTER_TREND -- there's no trend to be counter to, and
 * mean-reversion setups are valid either direction in those regimes. A
 * missing direction or regime reading is NONE, distinct from NEUTRAL, since
 * there's nothing to grade alignment on at all (multiplier still applies a
 * mild discount rather than 1.0, since an ungraded pick shouldn't score as
 * well as a confirmed trend-aligned one).
 */
function computeDirectionAlignment(
  preferredDirection: 'BUY' | 'SELL' | null,
  trendState: string | null,
): { alignment: DirectionAlignment, multiplier: number } {
  if (!preferredDirection || !trendState) {
    return { alignment: 'NONE', multiplier: 0.85 }
  }

  const trendBullish = trendState === 'TRENDING_UP'
  const trendBearish = trendState === 'TRENDING_DOWN'
  const ranging = trendState === 'RANGE' || trendState === 'MIXED'

  if (ranging) {
    return { alignment: 'NEUTRAL', multiplier: 1.0 }
  }

  const aligned =
    (preferredDirection === 'BUY' && trendBullish) ||
    (preferredDirection === 'SELL' && trendBearish)

  const counter =
    (preferredDirection === 'BUY' && trendBearish) ||
    (preferredDirection === 'SELL' && trendBullish)

  if (aligned) return { alignment: 'TREND_ALIGNED', multiplier: 1.0 }
  if (counter) return { alignment: 'COUNTER_TREND', multiplier: 0.7 }

  return { alignment: 'NEUTRAL', multiplier: 0.85 }
}

function buildScore(analystId: string, marketId: string, tier: ProfileTier, pick: DirectionPick, trendState: string | null): AnalystScore {
  const confidence = TIER_WEIGHT[tier] * QUALITY_WEIGHT[pick.quality] * Math.min(pick.tradeCount / CONFIDENCE_TRADE_CAP, 1.0)
  const { alignment, multiplier } = computeDirectionAlignment(pick.direction, trendState)
  return {
    analystId, marketId, preferredDirection: pick.direction, avgR: pick.avgR,
    profileTier: tier, profileQuality: pick.quality, confidence,
    directionAlignment: alignment, alignmentMultiplier: multiplier,
  }
}

export function scoreAnalystForMarket(
  analystId: string,
  marketId: string,
  assetClass: string,
  trendState: string | null,
  volatilityState: string | null,
  currentZone: string | null,
  profiles: AnalystProfileRow[], // all profiles for this analyst
): AnalystScore {
  const own = profiles.filter(p => p.analyst_id === analystId)
  const ownMarket = own.filter(p => p.market_id === marketId)

  // Tiers 1-2 require a genuine today's-regime reading. Without one, matching
  // on trendState/volatilityState === null would accidentally pick up the
  // regime-agnostic fallback profile rows (regime: null means "we don't have
  // regime data for this historical bucket", not "today is unclassified") --
  // that's what Tier 3 already handles explicitly, so a null reading here
  // skips straight to it rather than double-counting under the wrong label.
  const hasRegimeReading = trendState !== null && volatilityState !== null

  // Tier 1 -- MARKET: this market, this regime, trade_count >= MARKET_MIN_TRADES
  const marketBuy = hasRegimeReading ? ownMarket.find(p =>
    p.direction === 'BUY' &&
    p.profile_data.regime === trendState &&
    p.profile_data.volatility_state === volatilityState &&
    p.profile_data.trade_count >= MARKET_MIN_TRADES
  ) : undefined
  const marketSell = hasRegimeReading ? ownMarket.find(p =>
    p.direction === 'SELL' &&
    p.profile_data.regime === trendState &&
    p.profile_data.volatility_state === volatilityState &&
    p.profile_data.trade_count >= MARKET_MIN_TRADES
  ) : undefined
  const marketPick = pickBetween(
    marketBuy ? fromProfile(marketBuy) : null,
    marketSell ? fromProfile(marketSell) : null,
  )
  if (marketPick) return buildScore(analystId, marketId, 'MARKET', marketPick, trendState)

  // Tier 2 -- REGIME: same asset class, same regime, rolled up across markets,
  // aggregate trade_count >= REGIME_MIN_TRADES. Matched on trend_state only,
  // not volatility_state -- generateAnalystProfiles.ts already buckets by
  // trend+volatility+zone, so an additional exact volatility match here
  // double-filters an already-thin per-market sample down to near nothing
  // (confirmed live: EURUSD TRENDING_DOWN+LOW_VOL had 3 FX-wide matching
  // trades vs. 37 for TRENDING_DOWN alone). Mirrors the identical change in
  // workspaceUtils.ts's selectEvidenceTier() -- see that file's comment.
  const regimeProfiles = hasRegimeReading ? own.filter(p =>
    p.profile_data.regime === trendState &&
    p.asset_class === assetClass
  ) : []
  const regimeTotalTrades = regimeProfiles.reduce((s, p) => s + p.profile_data.trade_count, 0)
  if (regimeTotalTrades >= REGIME_MIN_TRADES) {
    const buyRegime = regimeProfiles.filter(p => p.direction === 'BUY')
    const sellRegime = regimeProfiles.filter(p => p.direction === 'SELL')
    const rollupPick = pickBetween(fromRollup(buyRegime), fromRollup(sellRegime))
    if (rollupPick) return buildScore(analystId, marketId, 'REGIME', rollupPick, trendState)
  }

  // Tier 3 -- DIRECTION: this market, regime-agnostic fallback, trade_count >= DIRECTION_MIN_TRADES
  const directionBuy = ownMarket.find(p => p.direction === 'BUY' && !p.profile_data.has_regime_data && p.profile_data.trade_count >= DIRECTION_MIN_TRADES)
  const directionSell = ownMarket.find(p => p.direction === 'SELL' && !p.profile_data.has_regime_data && p.profile_data.trade_count >= DIRECTION_MIN_TRADES)
  const directionPick = pickBetween(
    directionBuy ? fromProfile(directionBuy) : null,
    directionSell ? fromProfile(directionSell) : null,
  )
  if (directionPick) return buildScore(analystId, marketId, 'DIRECTION', directionPick, trendState)

  return {
    analystId, marketId, preferredDirection: null, avgR: 0, profileTier: 'NONE', profileQuality: null, confidence: 0,
    directionAlignment: 'NONE', alignmentMultiplier: 0.85,
  }
}
