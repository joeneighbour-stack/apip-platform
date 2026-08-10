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

export interface AnalystScore {
  analystId: string
  marketId: string
  preferredDirection: 'BUY' | 'SELL' | null
  avgR: number
  profileTier: ProfileTier
  profileQuality: 'HIGH' | 'MEDIUM' | 'LOW' | null
  confidence: number // 0-1
}

const TIER_WEIGHT: Record<ProfileTier, number> = { MARKET: 1.0, REGIME: 0.75, DIRECTION: 0.50, NONE: 0.0 }
const QUALITY_WEIGHT: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = { HIGH: 1.0, MEDIUM: 0.7, LOW: 0.4 }
const CONFIDENCE_TRADE_CAP = 50

const MARKET_MIN_TRADES = 20
const REGIME_MIN_TRADES = 10
const DIRECTION_MIN_TRADES = 10

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

function buildScore(analystId: string, marketId: string, tier: ProfileTier, pick: DirectionPick): AnalystScore {
  const confidence = TIER_WEIGHT[tier] * QUALITY_WEIGHT[pick.quality] * Math.min(pick.tradeCount / CONFIDENCE_TRADE_CAP, 1.0)
  return {
    analystId, marketId, preferredDirection: pick.direction, avgR: pick.avgR,
    profileTier: tier, profileQuality: pick.quality, confidence,
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
  if (marketPick) return buildScore(analystId, marketId, 'MARKET', marketPick)

  // Tier 2 -- REGIME: same asset class, same regime, rolled up across markets,
  // aggregate trade_count >= REGIME_MIN_TRADES
  const regimeProfiles = hasRegimeReading ? own.filter(p =>
    p.profile_data.regime === trendState &&
    p.profile_data.volatility_state === volatilityState &&
    p.asset_class === assetClass
  ) : []
  const regimeTotalTrades = regimeProfiles.reduce((s, p) => s + p.profile_data.trade_count, 0)
  if (regimeTotalTrades >= REGIME_MIN_TRADES) {
    const buyRegime = regimeProfiles.filter(p => p.direction === 'BUY')
    const sellRegime = regimeProfiles.filter(p => p.direction === 'SELL')
    const rollupPick = pickBetween(fromRollup(buyRegime), fromRollup(sellRegime))
    if (rollupPick) return buildScore(analystId, marketId, 'REGIME', rollupPick)
  }

  // Tier 3 -- DIRECTION: this market, regime-agnostic fallback, trade_count >= DIRECTION_MIN_TRADES
  const directionBuy = ownMarket.find(p => p.direction === 'BUY' && !p.profile_data.has_regime_data && p.profile_data.trade_count >= DIRECTION_MIN_TRADES)
  const directionSell = ownMarket.find(p => p.direction === 'SELL' && !p.profile_data.has_regime_data && p.profile_data.trade_count >= DIRECTION_MIN_TRADES)
  const directionPick = pickBetween(
    directionBuy ? fromProfile(directionBuy) : null,
    directionSell ? fromProfile(directionSell) : null,
  )
  if (directionPick) return buildScore(analystId, marketId, 'DIRECTION', directionPick)

  return { analystId, marketId, preferredDirection: null, avgR: 0, profileTier: 'NONE', profileQuality: null, confidence: 0 }
}
