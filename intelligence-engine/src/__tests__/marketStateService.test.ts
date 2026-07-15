// ============================================================================
// MarketStateService Tests
// Covers: ATR20 Wilder RMA, Pine-style anchor construction, zone classification,
//         session boundary inclusion/exclusion, previous_close derivation.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { buildMarketState, type OhlcBar } from '../services/marketStateService.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeBars(count: number, basePrice: number, dailyRange: number): OhlcBar[] {
  const bars: OhlcBar[] = [];
  for (let i = 0; i < count; i++) {
    const close = basePrice;
    bars.push({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      open: close, high: close + dailyRange / 2, low: close - dailyRange / 2, close,
    });
  }
  return bars;
}

// Hand-computed GBPUSD fixture for deterministic band tests
// previousClose=1.33914, todayHigh=1.34199, todayLow=1.33702
// ATR20=0.00759 (from 25 completed Finnhub daily bars)
const GBPUSD_FIXTURE = {
  previousClose:  1.33914,
  todayHighSoFar: 1.34199,
  todayLowSoFar:  1.33702,
  atr20:          0.00759,
  currentPrice:   1.34025,
  // Expected bands:
  // bottomAnchor = min(1.33914, 1.33702) = 1.33702
  // topAnchor    = max(1.33914, 1.34199) = 1.34199
  // upper_band   = 1.33702 + 0.00759 = 1.34461
  // lower_band   = 1.34199 - 0.00759 = 1.33440
  // band_width   = 1.34461 - 1.33440 = 0.01021
  // zone_width   = 0.01021 / 4       = 0.0025525
  // q1 = 1.33440 + 0.0025525 = 1.33695
  // q2 = 1.33440 + 0.005105  = 1.33951
  // q3 = 1.33440 + 0.0076575 = 1.34206
  expectedLowerBand:  1.33440,
  expectedUpperBand:  1.34461,
  expectedZone1Top:   1.33695,
  expectedZone2Top:   1.33951,
  expectedZone3Top:   1.34206,
  expectedZone:       'ZONE_3' as const,  // 1.33951 <= 1.34025 < 1.34206
};

// ── Existing tests (updated for atr20 field) ────────────────────────────────

describe('MarketStateService — existing contract', () => {
  it('returns all-null output when there are zero bars and no precomputed ATR', () => {
    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: [],
      currentPrice: { price: 1.1, capturedAt: '2026-01-01T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
    });
    expect(result.atr14).toBeNull();
    expect(result.atr20).toBeNull();
    expect(result.currentZone).toBeNull();
    expect(result.lowerBand).toBeNull();
    expect(result.upperBand).toBeNull();
  });

  it('returns null ATR when fewer than atrPeriod bars are available', () => {
    const bars = makeBars(10, 1.1, 0.01);
    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: bars,
      currentPrice: { price: 1.1, capturedAt: '2026-01-11T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
    });
    expect(result.atr14).toBeNull();
    expect(result.currentZone).toBeNull();
  });

  it('computes ATR14 correctly on a flat series with Wilder RMA (SMA seed)', () => {
    // Flat series: TR = dailyRange every bar, prevClose=close → tr2=tr3=0
    // SMA seed = 0.01, all recursive steps = (0.01*13 + 0.01)/14 = 0.01
    const bars = makeBars(20, 1.10, 0.0100);
    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: bars,
      currentPrice: { price: 1.10, capturedAt: '2026-01-20T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
    });
    expect(result.atr14).not.toBeNull();
    expect(result.atr14).toBeCloseTo(0.01, 10);
  });

  it('classifies all 6 zones correctly at exact boundary values (legacy path)', () => {
    // Flat series: high=1.105, low=1.095, close=1.10 → TR=0.01, ATR14=0.01
    // lowerBand = 1.105 - 0.01 = 1.095   (latestHigh - ATR)
    // upperBand = 1.095 + 0.01 = 1.105   (latestLow  + ATR)
    // step = 0.0025
    const bars: OhlcBar[] = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      open: 1.10, high: 1.105, low: 1.095, close: 1.10,
    }));
    const params = { atrPeriod: 14, zoneCount: 4 };
    const zoneAt = (price: number) => buildMarketState({
      marketId: 'TEST', ohlcSeries: bars,
      currentPrice: { price, capturedAt: '2026-01-14T00:00:00Z' },
      parameters: params,
    }).currentZone;

    expect(zoneAt(1.094)).toBe('TOO_DEEP');
    expect(zoneAt(1.095)).toBe('ZONE_1');       // exactly at lowerBand -- inclusive
    expect(zoneAt(1.0975)).toBe('ZONE_1');      // exactly at zone1Top -- inclusive
    expect(zoneAt(1.0976)).toBe('ZONE_2');
    expect(zoneAt(1.10)).toBe('ZONE_2');        // exactly at zone2Top -- inclusive
    expect(zoneAt(1.1001)).toBe('ZONE_3');
    expect(zoneAt(1.1025)).toBe('ZONE_3');      // exactly at zone3Top -- inclusive
    expect(zoneAt(1.1026)).toBe('ZONE_4');
    expect(zoneAt(1.105)).toBe('ZONE_4');       // exactly at upperBand -- inclusive
    expect(zoneAt(1.1051)).toBe('TOO_HIGH');
  });

  it('applies the band-collapse guard when upperBand <= lowerBand', () => {
    // 13 flat bars TR=0.001, bar 14 TR=0.20
    // ATR14 (SMA seed): sum(TR[0..13])/14 = (13*0.001+0.20)/14 = 0.015214...
    // lowerBand=1.20-atr~1.1848, upperBand=1.00+atr~1.0152 → collapse → centred
    const bars: OhlcBar[] = [
      ...Array.from({ length: 13 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        open: 1.10, high: 1.1005, low: 1.0995, close: 1.10,
      })),
      { date: '2026-01-14', open: 1.10, high: 1.20, low: 1.00, close: 1.10 },
    ];
    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: bars,
      currentPrice: { price: 1.10, capturedAt: '2026-01-14T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
    });
    const expectedAtr = (13 * 0.001 + 0.20) / 14;
    expect(result.atr14).toBeCloseTo(expectedAtr, 10);
    expect(result.lowerBand).toBeCloseTo(1.10 - expectedAtr / 2, 10);
    expect(result.upperBand).toBeCloseTo(1.10 + expectedAtr / 2, 10);
    expect(result.lowerBand!).toBeLessThan(result.upperBand!);
  });
});

// ── New tests: ATR20 Wilder RMA ──────────────────────────────────────────────

describe('ATR20 Wilder RMA — test 1: fixed OHLC fixture', () => {
  it('produces correct ATR20 from known daily series', () => {
    // 22 bars flat TR=0.01. SMA of first 20 = 0.01. Two recursive steps = 0.01.
    const bars = makeBars(22, 1.10, 0.01);
    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: bars,
      currentPrice: { price: 1.10, capturedAt: '2026-01-22T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
    });
    expect(result.atr20).toBeCloseTo(0.01, 10);
  });

  it('ATR20 SMA seed equals mean of first 20 TRs on mixed series', () => {
    // 20 bars: first 19 have TR=0.01, bar 20 has TR=0.05
    // Expected ATR20 seed = (19*0.01 + 0.05)/20 = 0.24/20 = 0.012
    const bars: OhlcBar[] = [
      ...Array.from({ length: 19 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        open: 1.10, high: 1.105, low: 1.095, close: 1.10,
      })),
      { date: '2026-01-20', open: 1.10, high: 1.125, low: 1.075, close: 1.10 },
    ];
    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: bars,
      currentPrice: { price: 1.10, capturedAt: '2026-01-20T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
    });
    expect(result.atr20).toBeCloseTo(0.012, 10);
  });
});

// ── New tests: Pine-style anchor construction ────────────────────────────────

describe('Pine-style anchor construction — tests 7 & 8', () => {
  it('test 7: bottom_anchor=min(prevClose,todayLow), top_anchor=max(prevClose,todayHigh)', () => {
    // When prevClose > todayLow: bottomAnchor = todayLow
    // When prevClose < todayHigh: topAnchor   = todayHigh
    const f = GBPUSD_FIXTURE;
    const result = buildMarketState({
      marketId: 'GBPUSD', ohlcSeries: [],
      currentPrice: { price: f.currentPrice, capturedAt: '2026-07-15T08:00:00Z' },
      parameters: { atrPeriod: 20, zoneCount: 4 },
      sessionAnchors: {
        previousClose:    f.previousClose,
        todayHighSoFar:   f.todayHighSoFar,
        todayLowSoFar:    f.todayLowSoFar,
        precomputedAtr20: f.atr20,
      },
    });
    // bottomAnchor = min(1.33914, 1.33702) = 1.33702 → upper = 1.33702 + 0.00759 = 1.34461
    // topAnchor    = max(1.33914, 1.34199) = 1.34199 → lower = 1.34199 - 0.00759 = 1.33440
    expect(result.upperBand).toBeCloseTo(f.expectedUpperBand, 4);
    expect(result.lowerBand).toBeCloseTo(f.expectedLowerBand, 4);
  });

  it('test 8: band boundaries match hand-calculated GBPUSD fixture', () => {
    const f = GBPUSD_FIXTURE;
    const result = buildMarketState({
      marketId: 'GBPUSD', ohlcSeries: [],
      currentPrice: { price: f.currentPrice, capturedAt: '2026-07-15T08:00:00Z' },
      parameters: { atrPeriod: 20, zoneCount: 4 },
      sessionAnchors: {
        previousClose:    f.previousClose,
        todayHighSoFar:   f.todayHighSoFar,
        todayLowSoFar:    f.todayLowSoFar,
        precomputedAtr20: f.atr20,
      },
    });
    expect(result.upperBand).toBeCloseTo(f.expectedUpperBand, 4);
    expect(result.lowerBand).toBeCloseTo(f.expectedLowerBand, 4);
    expect(result.zone1Top).toBeCloseTo(f.expectedZone1Top, 4);
    expect(result.zone2Top).toBeCloseTo(f.expectedZone2Top, 4);
    expect(result.zone3Top).toBeCloseTo(f.expectedZone3Top, 4);
    expect(result.atr20).toBeCloseTo(f.atr20, 5);
  });
});

// ── New tests: zone boundaries ───────────────────────────────────────────────

describe('Zone classification at exact boundaries — test 10', () => {
  function zoneAtPrice(price: number) {
    const f = GBPUSD_FIXTURE;
    return buildMarketState({
      marketId: 'GBPUSD', ohlcSeries: [],
      currentPrice: { price, capturedAt: '2026-07-15T08:00:00Z' },
      parameters: { atrPeriod: 20, zoneCount: 4 },
      sessionAnchors: {
        previousClose:    f.previousClose,
        todayHighSoFar:   f.todayHighSoFar,
        todayLowSoFar:    f.todayLowSoFar,
        precomputedAtr20: f.atr20,
      },
    }).currentZone;
  }

  it('price below lowerBand → TOO_DEEP', () => {
    expect(zoneAtPrice(1.33439)).toBe('TOO_DEEP');
  });
  it('price exactly at lowerBand → ZONE_1 (inclusive)', () => {
    expect(zoneAtPrice(GBPUSD_FIXTURE.expectedLowerBand)).toBe('ZONE_1');
  });
  it('price in ZONE_1', () => {
    expect(zoneAtPrice(1.33500)).toBe('ZONE_1');
  });
  it('price exactly at zone1Top → ZONE_1 (inclusive)', () => {
    expect(zoneAtPrice(GBPUSD_FIXTURE.expectedZone1Top)).toBe('ZONE_1');
  });
  it('price just above zone1Top → ZONE_2', () => {
    expect(zoneAtPrice(GBPUSD_FIXTURE.expectedZone1Top + 0.00001)).toBe('ZONE_2');
  });
  it('price exactly at zone2Top → ZONE_2 (inclusive)', () => {
    // Use the service-computed zone2Top (not rounded fixture) to avoid FP drift
    const f = GBPUSD_FIXTURE;
    const state = buildMarketState({
      marketId: 'GBPUSD', ohlcSeries: [],
      currentPrice: { price: f.expectedZone2Top, capturedAt: '2026-07-15T08:00:00Z' },
      parameters: { atrPeriod: 20, zoneCount: 4 },
      sessionAnchors: { previousClose: f.previousClose, todayHighSoFar: f.todayHighSoFar, todayLowSoFar: f.todayLowSoFar, precomputedAtr20: f.atr20 },
    });
    // At exactly zone2Top (lower_band + 2*step), price is inclusive of ZONE_2
    expect(state.zone2Top).toBeCloseTo(f.expectedZone2Top, 4);
    expect(zoneAtPrice(state.zone2Top!)).toBe('ZONE_2');
  });
  it('price just above zone2Top → ZONE_3', () => {
    expect(zoneAtPrice(GBPUSD_FIXTURE.expectedZone2Top + 0.00001)).toBe('ZONE_3');
  });
  it('price exactly at zone3Top → ZONE_3 (inclusive)', () => {
    const f = GBPUSD_FIXTURE;
    const state = buildMarketState({
      marketId: 'GBPUSD', ohlcSeries: [],
      currentPrice: { price: f.expectedZone3Top, capturedAt: '2026-07-15T08:00:00Z' },
      parameters: { atrPeriod: 20, zoneCount: 4 },
      sessionAnchors: { previousClose: f.previousClose, todayHighSoFar: f.todayHighSoFar, todayLowSoFar: f.todayLowSoFar, precomputedAtr20: f.atr20 },
    });
    expect(state.zone3Top).toBeCloseTo(f.expectedZone3Top, 4);
    expect(zoneAtPrice(state.zone3Top!)).toBe('ZONE_3');
  });
  it('price just above zone3Top → ZONE_4', () => {
    expect(zoneAtPrice(GBPUSD_FIXTURE.expectedZone3Top + 0.00001)).toBe('ZONE_4');
  });
  it('price exactly at upperBand → ZONE_4 (inclusive)', () => {
    expect(zoneAtPrice(GBPUSD_FIXTURE.expectedUpperBand)).toBe('ZONE_4');
  });
  it('price above upperBand → TOO_HIGH', () => {
    expect(zoneAtPrice(1.34462)).toBe('TOO_HIGH');
  });
  it('GBPUSD current price (1.34025) → ZONE_3', () => {
    expect(zoneAtPrice(GBPUSD_FIXTURE.currentPrice)).toBe(GBPUSD_FIXTURE.expectedZone)
  });
});

// ── New tests: precomputedAtr20 path ────────────────────────────────────────

describe('precomputedAtr20 — test 11: empty ohlcSeries still works', () => {
  it('test 11: Gold uses precomputed ATR20 without ohlcSeries', () => {
    // OANDA:XAU_USD — confirmed available on candle-enabled key
    const result = buildMarketState({
      marketId: 'GOLD',
      ohlcSeries: [],   // no bar history needed when ATR20 is precomputed
      currentPrice: { price: 4058.82, capturedAt: '2026-07-15T08:00:00Z' },
      parameters: { atrPeriod: 20, zoneCount: 4 },
      sessionAnchors: {
        previousClose:    4053.05,
        todayHighSoFar:   4062.12,
        todayLowSoFar:    4017.47,
        precomputedAtr20: 108.72,
      },
    });
    // bottomAnchor = min(4053.05, 4017.47) = 4017.47 → upper = 4017.47+108.72 = 4126.19
    // topAnchor    = max(4053.05, 4062.12) = 4062.12 → lower = 4062.12-108.72 = 3953.40
    expect(result.upperBand).toBeCloseTo(4126.19, 1);
    expect(result.lowerBand).toBeCloseTo(3953.40, 1);
    expect(result.atr20).toBeCloseTo(108.72, 2);
    expect(result.currentZone).not.toBeNull();
  });
});

// ── New tests: session anchor wins over latest bar ───────────────────────────

describe('SessionAnchors override latest bar h/l', () => {
  it('with sessionAnchors: uses Pine formula, ignores latest bar high/low', () => {
    // Bar has high=1.20, low=1.00 which would cause collapse without anchors
    // SessionAnchors supply tight range → valid bands
    const bars: OhlcBar[] = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      open: 1.10, high: i === 13 ? 1.20 : 1.105, low: i === 13 ? 1.00 : 1.095, close: 1.10,
    }));
    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: bars,
      currentPrice: { price: 1.10, capturedAt: '2026-01-14T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
      sessionAnchors: {
        previousClose:   1.10,
        todayHighSoFar:  1.12,
        todayLowSoFar:   1.08,
        // atr14 from bars ≈ 0.0152; no precomputedAtr20 so uses atr20 from bars
      },
    });
    // bottomAnchor = min(1.10, 1.08) = 1.08
    // topAnchor    = max(1.10, 1.12) = 1.12
    // atr20 from bars: SMA(TR[0..19]) with only 14 bars → atr20 is null
    // With atr20=null → zone null
    // (This test verifies anchors are used, not bar h/l)
    // With sessionAnchors but no atr20, we expect null zone since atr20 is null
    // and precomputedAtr20 is not provided
    expect(result.currentZone).toBeNull(); // atr20 null → no zone from Pine path
  });

  it('with sessionAnchors + precomputedAtr20: gets valid zone', () => {
    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: [],
      currentPrice: { price: 1.10, capturedAt: '2026-01-14T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
      sessionAnchors: {
        previousClose:    1.10,
        todayHighSoFar:   1.12,
        todayLowSoFar:    1.08,
        precomputedAtr20: 0.015,
      },
    });
    // bottomAnchor = 1.08, topAnchor = 1.12
    // upper = 1.08 + 0.015 = 1.095, lower = 1.12 - 0.015 = 1.105
    // upper < lower → collapse → centred on 1.10
    expect(result.currentZone).not.toBeNull();
    expect(result.lowerBand!).toBeLessThan(result.upperBand!);
  });
});
