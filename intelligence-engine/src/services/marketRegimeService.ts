// ============================================================================
// MarketRegimeService
// Maps to: APIP_RESEARCH_ENGINE_V1_0.ipynb cell 7 (derive_market_regime)
// Contract: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md Section 3.2
// ============================================================================
// Pure function. No I/O.
//
// INVARIANT (do not "improve"): regimeConfidence is 'LOW' if volatilityState
// is 'UNKNOWN', else 'MEDIUM'. The notebook never produces 'HIGH' under any
// input. Do not add a HIGH threshold without research re-validation.

export type TrendState = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGE';
export type VolatilityState = 'LOW_VOL' | 'NORMAL_VOL' | 'HIGH_VOL' | 'UNKNOWN';
export type RegimeConfidence = 'LOW' | 'MEDIUM';

export interface CloseBar { date: string; close: number; }

export interface MarketRegimeInput {
  marketId: string;
  closeSeries: CloseBar[]; // ascending date order; >= 60 bars for vol60 to be meaningful
}

export interface MarketRegimeOutput {
  marketId: string;
  trendState: TrendState;
  volatilityState: VolatilityState;
  regimeTags: string[];          // lowercase [trendState, volatilityState], matches notebook exactly
  regimeConfidence: RegimeConfidence;
  capturedAt: string;
}

/** Exponential moving average, matching pandas .ewm(span=N, adjust=False).mean(). */
function ema(values: number[], span: number): number[] {
  const alpha = 2 / (span + 1);
  const out: number[] = [];
  let prev: number | undefined;
  for (const v of values) {
    prev = prev === undefined ? v : alpha * v + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

export function deriveMarketRegime(input: MarketRegimeInput): MarketRegimeOutput {
  const { marketId, closeSeries } = input;
  const closes = closeSeries.map((b) => b.close);
  const n = closes.length;

  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);

  const ema20Latest = ema20Series[n - 1];
  const ema50Latest = ema50Series[n - 1];
  // diff(5): ema20 now minus ema20 five bars ago. Undefined (treated as 0/flat)
  // if fewer than 6 bars exist -- matches pandas producing NaN, which the
  // notebook's trend_state comparison (`r.ema20_slope>0`) would treat as
  // False either side, equivalent to falling through to RANGE.
  const ema20Slope = n > 5 ? ema20Series[n - 1]! - ema20Series[n - 6]! : undefined;

  let trendState: TrendState;
  if (ema20Latest !== undefined && ema50Latest !== undefined && ema20Slope !== undefined
      && ema20Latest > ema50Latest && ema20Slope > 0) {
    trendState = 'TRENDING_UP';
  } else if (ema20Latest !== undefined && ema50Latest !== undefined && ema20Slope !== undefined
      && ema20Latest < ema50Latest && ema20Slope < 0) {
    trendState = 'TRENDING_DOWN';
  } else {
    trendState = 'RANGE';
  }

  // returnAbs[i] = |close[i]/close[i-1] - 1|, undefined for i=0 (no prior close).
  const returnAbs: (number | undefined)[] = closes.map((c, i) =>
    i === 0 ? undefined : Math.abs(c / closes[i - 1]! - 1)
  );

  function rollingMean(series: (number | undefined)[], window: number, minPeriods: number): number | undefined {
    const tail = series.slice(Math.max(0, series.length - window)).filter((v): v is number => v !== undefined);
    if (tail.length < minPeriods) return undefined;
    return tail.reduce((a, v) => a + v, 0) / tail.length;
  }

  const vol20 = rollingMean(returnAbs, 20, 10);
  const vol60 = rollingMean(returnAbs, 60, 20);

  let volatilityState: VolatilityState;
  if (vol20 === undefined || vol60 === undefined || vol60 === 0) {
    volatilityState = 'UNKNOWN';
  } else {
    const ratio = vol20 / vol60;
    if (ratio >= 1.5) volatilityState = 'HIGH_VOL';
    else if (ratio <= 0.7) volatilityState = 'LOW_VOL';
    else volatilityState = 'NORMAL_VOL';
  }

  const regimeConfidence: RegimeConfidence = volatilityState === 'UNKNOWN' ? 'LOW' : 'MEDIUM';

  return {
    marketId,
    trendState,
    volatilityState,
    regimeTags: [trendState.toLowerCase(), volatilityState.toLowerCase()],
    regimeConfidence,
    capturedAt: new Date().toISOString(),
  };
}
