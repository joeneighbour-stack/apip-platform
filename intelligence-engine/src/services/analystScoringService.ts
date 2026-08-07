// ============================================================================
// AnalystScoringService
// ============================================================================
// Scores a single analyst's fit for a market under today's regime + zone,
// using the tiered analyst_profiles rows generateAnalystProfiles.ts already
// writes: FULL (trend + volatility + zone), REGIME (trend + volatility only),
// DIRECTION (fully pooled, regime-agnostic). Tries the most specific tier
// first and degrades gracefully -- the same "prefer specific, fall back"
// pattern analystProfileService.ts's selectBestAnalyst() already uses for its
// own exact/market/fallback cascade, applied per-tier here instead.
//
// Zone (the FULL tier's extra dimension) is only ever populated on
// analyst_profiles rows for trades published on/after 2026-01-01 --
// generateAnalystProfiles.ts's ZONE_VALID_FROM gate -- so a FULL-tier match
// here can only ever be built from genuine, non-placeholder zone data.
//
// Pure function, no I/O -- callers load analyst_profiles rows once and pass
// each analyst's own rows in.
// ============================================================================

export interface AnalystProfileRow {
  analyst_id: string
  market_id: string
  direction: 'BUY' | 'SELL'
  zone: string | null
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

export type ProfileTier = 'FULL' | 'REGIME' | 'DIRECTION' | 'NONE'

export interface AnalystScore {
  analystId: string
  marketId: string
  preferredDirection: 'BUY' | 'SELL' | null
  avgR: number
  profileTier: ProfileTier
  profileQuality: 'HIGH' | 'MEDIUM' | 'LOW' | null
  confidence: number // 0-1
}

const TIER_WEIGHT: Record<ProfileTier, number> = { FULL: 1.0, REGIME: 0.75, DIRECTION: 0.50, NONE: 0.0 }
const QUALITY_WEIGHT: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = { HIGH: 1.0, MEDIUM: 0.7, LOW: 0.4 }
const CONFIDENCE_TRADE_CAP = 50

interface DirectionPick {
  profile: AnalystProfileRow
  direction: 'BUY' | 'SELL' | null
}

/**
 * Picks a direction between an optional BUY-side and SELL-side profile match
 * at the same tier: whichever has positive avg_r wins; if both are positive,
 * the higher avg_r wins; if neither is positive, still returns whichever
 * profile had the higher avg_r (so tier/quality/avgR stay honest for logging)
 * but with direction: null -- the caller falls back to a regime-only signal.
 * Returns null only when neither side has a profile at all.
 */
function pickDirection(buy: AnalystProfileRow | undefined, sell: AnalystProfileRow | undefined): DirectionPick | null {
  const buyR = buy?.profile_data.avg_r ?? null
  const sellR = sell?.profile_data.avg_r ?? null

  if (buy && buyR! > 0 && sell && sellR! > 0) {
    return buyR! >= sellR! ? { profile: buy, direction: 'BUY' } : { profile: sell, direction: 'SELL' }
  }
  if (buy && buyR! > 0) return { profile: buy, direction: 'BUY' }
  if (sell && sellR! > 0) return { profile: sell, direction: 'SELL' }
  if (buy && sell) return { profile: buyR! >= sellR! ? buy : sell, direction: null }
  if (buy) return { profile: buy, direction: null }
  if (sell) return { profile: sell, direction: null }
  return null
}

export function scoreAnalystForMarket(
  analystId: string,
  marketId: string,
  trendState: string | null,
  volatilityState: string | null,
  currentZone: string | null,
  profiles: AnalystProfileRow[], // all profiles for this analyst
): AnalystScore {
  const own = profiles.filter(p => p.analyst_id === analystId && p.market_id === marketId)

  let tier: ProfileTier = 'NONE'
  let picked: DirectionPick | null = null

  // Tier 1 -- FULL: trend + volatility + zone
  if (!picked && currentZone) {
    const buy = own.find(p =>
      p.direction === 'BUY' &&
      p.profile_data.regime === trendState &&
      p.profile_data.volatility_state === volatilityState &&
      p.zone === currentZone && p.zone !== null
    )
    const sell = own.find(p =>
      p.direction === 'SELL' &&
      p.profile_data.regime === trendState &&
      p.profile_data.volatility_state === volatilityState &&
      p.zone === currentZone && p.zone !== null
    )
    const result = pickDirection(buy, sell)
    if (result) { tier = 'FULL'; picked = result }
  }

  // Tier 2 -- REGIME: trend + volatility, zone-agnostic
  if (!picked) {
    const buy = own.find(p =>
      p.direction === 'BUY' &&
      p.profile_data.regime === trendState &&
      p.profile_data.volatility_state === volatilityState &&
      p.zone === null
    )
    const sell = own.find(p =>
      p.direction === 'SELL' &&
      p.profile_data.regime === trendState &&
      p.profile_data.volatility_state === volatilityState &&
      p.zone === null
    )
    const result = pickDirection(buy, sell)
    if (result) { tier = 'REGIME'; picked = result }
  }

  // Tier 3 -- DIRECTION: market only, fully regime-agnostic fallback
  if (!picked) {
    const buy = own.find(p => p.direction === 'BUY' && !p.profile_data.has_regime_data)
    const sell = own.find(p => p.direction === 'SELL' && !p.profile_data.has_regime_data)
    const result = pickDirection(buy, sell)
    if (result) { tier = 'DIRECTION'; picked = result }
  }

  if (!picked) {
    return { analystId, marketId, preferredDirection: null, avgR: 0, profileTier: 'NONE', profileQuality: null, confidence: 0 }
  }

  const { profile, direction } = picked
  const avgR = profile.profile_data.avg_r
  const quality = profile.profile_data.profile_quality
  const tradeCount = profile.profile_data.trade_count
  const confidence = TIER_WEIGHT[tier] * QUALITY_WEIGHT[quality] * Math.min(tradeCount / CONFIDENCE_TRADE_CAP, 1.0)

  return { analystId, marketId, preferredDirection: direction, avgR, profileTier: tier, profileQuality: quality, confidence }
}
