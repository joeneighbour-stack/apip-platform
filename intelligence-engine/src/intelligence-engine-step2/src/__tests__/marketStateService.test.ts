import { describe, it, expect } from 'vitest';
import { buildMarketState, type OhlcBar } from '../services/marketStateService.js';

function makeBars(count: number, basePrice: number, dailyRange: number): OhlcBar[] {
  const bars: OhlcBar[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price; // flat series -- isolates the band/zone math from trend noise
    const high = open + dailyRange / 2;
    const low = open - dailyRange / 2;
    bars.push({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open, high, low, close });
  }
  return bars;
}

describe('MarketStateService', () => {
  it('returns all-null output when there are zero bars', () => {
    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: [], currentPrice: { price: 1.1, capturedAt: '2026-01-01T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
    });
    expect(result.atr14).toBeNull();
    expect(result.currentZone).toBeNull();
    expect(result.lowerBand).toBeNull();
    expect(result.upperBand).toBeNull();
  });

  it('returns null ATR when fewer than atrPeriod bars are available', () => {
    const bars = makeBars(10, 1.1, 0.01); // only 10 bars, period is 14
    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: bars, currentPrice: { price: 1.1, capturedAt: '2026-01-11T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
    });
    expect(result.atr14).toBeNull();
    expect(result.currentZone).toBeNull();
  });

  it('computes ATR14 correctly on a flat series (TR = dailyRange every bar)', () => {
    const bars = makeBars(20, 1.10, 0.0100); // high-low = 0.01 every bar, flat close -> tr2/tr3 = 0
    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: bars, currentPrice: { price: 1.10, capturedAt: '2026-01-20T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
    });
    // Flat series: every bar's high-low = 0.01, prevClose == close every time -> tr2=tr3=0 -> TR = 0.01 always.
    expect(result.atr14).not.toBeNull();
    expect(result.atr14).toBeCloseTo(0.01, 10);
  });

  it('classifies all 6 zones correctly at exact boundary values', () => {
    // Construct a market state with known bands. Flat series, high=1.105,
    // low=1.095, close=1.10 every bar -- TR per bar = high-low = 0.01
    // (prevClose==close always, so tr2=tr3=0), giving ATR14 = 0.01 exactly.
    // lowerBand = high - atr = 1.105 - 0.01 = 1.095
    // upperBand = low + atr = 1.095 + 0.01 = 1.105
    // step = (1.105 - 1.095) / 4 = 0.0025
    // zone1Top = 1.0975, zone2Top = 1.10, zone3Top = 1.1025
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 14; i++) {
      bars.push({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: 1.10, high: 1.105, low: 1.095, close: 1.10 });
    }
    const params = { atrPeriod: 14, zoneCount: 4 };

    function zoneAt(price: number) {
      return buildMarketState({
        marketId: 'TEST', ohlcSeries: bars, currentPrice: { price, capturedAt: '2026-01-14T00:00:00Z' }, parameters: params,
      }).currentZone;
    }

    expect(zoneAt(1.094)).toBe('TOO_DEEP');      // below lowerBand
    expect(zoneAt(1.095)).toBe('ZONE_1');         // exactly at lowerBand -- inclusive on the low side
    expect(zoneAt(1.0975)).toBe('ZONE_1');        // exactly at zone1Top -- inclusive
    expect(zoneAt(1.0976)).toBe('ZONE_2');
    expect(zoneAt(1.10)).toBe('ZONE_2');          // exactly at zone2Top -- inclusive
    expect(zoneAt(1.1001)).toBe('ZONE_3');
    expect(zoneAt(1.1025)).toBe('ZONE_3');        // exactly at zone3Top -- inclusive
    expect(zoneAt(1.1026)).toBe('ZONE_4');
    expect(zoneAt(1.105)).toBe('ZONE_4');         // exactly at upperBand -- inclusive
    expect(zoneAt(1.1051)).toBe('TOO_HIGH');      // above upperBand
  });

  it('applies the band-collapse guard when upperBand <= lowerBand', () => {
    // The guard triggers when upperBand <= lowerBand, i.e. (low+atr) <= (high-atr),
    // i.e. atr <= (high-low)/2 -- ATR SMALL relative to the latest bar's own
    // range, not large. Construct: 13 flat bars (tiny TR, keeps ATR small),
    // then one bar with a huge high-low spread.
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 13; i++) {
      bars.push({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: 1.10, high: 1.1005, low: 1.0995, close: 1.10 });
    }
    bars.push({ date: '2026-01-14', open: 1.10, high: 1.20, low: 1.00, close: 1.10 });
    // Hand-computed: 13 bars TR=0.001 each (flat, prevClose=close -> tr2=tr3=0).
    // Final bar: tr1=0.20, tr2=|1.20-1.10|=0.10, tr3=|1.00-1.10|=0.10 -> TR=0.20.
    // ATR14 = (13*0.001 + 0.20)/14 = 0.213/14 = 0.0152142857...
    // lowerBand = 1.20 - atr ~ 1.1848; upperBand = 1.00 + atr ~ 1.0152
    // upperBand <= lowerBand -> guard fires -> lowerBand=close-atr/2, upperBand=close+atr/2

    const result = buildMarketState({
      marketId: 'TEST', ohlcSeries: bars, currentPrice: { price: 1.10, capturedAt: '2026-01-14T00:00:00Z' },
      parameters: { atrPeriod: 14, zoneCount: 4 },
    });

    const expectedAtr = (13 * 0.001 + 0.20) / 14;
    expect(result.atr14).toBeCloseTo(expectedAtr, 10);
    // Guard must have fired: bands centred on close (1.10), not on high/low.
    expect(result.lowerBand).toBeCloseTo(1.10 - expectedAtr / 2, 10);
    expect(result.upperBand).toBeCloseTo(1.10 + expectedAtr / 2, 10);
    expect(result.lowerBand!).toBeLessThan(result.upperBand!);
  });
});
