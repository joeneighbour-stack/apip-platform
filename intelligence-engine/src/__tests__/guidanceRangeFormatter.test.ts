import { describe, it, expect } from 'vitest';
import { formatGuidanceRange, formatMarketPrice } from '../services/guidanceRangeFormatter.js';

describe('formatMarketPrice', () => {
  it('formats EURUSD-style FX majors at 4 decimal places', () => {
    expect(formatMarketPrice(1.08305, 4)).toBe('1.0831'); // toFixed rounds, matching standard rounding
    expect(formatMarketPrice(1.0830, 4)).toBe('1.0830');
  });

  it('formats USDJPY-style JPY pairs at 3 decimal places (fewer than non-JPY FX)', () => {
    expect(formatMarketPrice(110.123, 3)).toBe('110.123');
  });

  it('formats Gold at 2 decimal places', () => {
    expect(formatMarketPrice(1950.456, 2)).toBe('1950.46');
  });

  it('formats an index at 2 decimal places', () => {
    expect(formatMarketPrice(4500.25, 2)).toBe('4500.25');
  });

  it('formats crypto at 2 decimal places (V1 default, not differentiated per-symbol)', () => {
    expect(formatMarketPrice(43215.789, 2)).toBe('43215.79');
  });

  it('falls back to a documented default (4dp) when displayPrecision is null or undefined -- never silently picks an arbitrary value', () => {
    expect(formatMarketPrice(1.0830, null)).toBe('1.0830');
    expect(formatMarketPrice(1.0830, undefined)).toBe('1.0830');
  });
});

describe('formatGuidanceRange', () => {
  it('produces the exact example from the product clarification (stop=1.0830, atr=0.0040), at EURUSD 4dp precision', () => {
    // half-width = 0.0040 * 0.125 = 0.0005 -> 1.0825-1.0835
    const result = formatGuidanceRange({ anchorPrice: 1.0830, atr: 0.0040, direction: 'BUY', type: 'risk', displayPrecision: 4 });
    expect(result).toBe('1.0825\u20131.0835');
  });

  it('produces correctly-precisioned text for a JPY pair (3dp), not the FX-major default', () => {
    // anchor=110.500, atr=0.300 -> half-width=0.0375 -> 110.4625/110.5375 before rounding.
    // Verified directly in Node (not hand-calculated): 110.5375.toFixed(3) -> '110.537',
    // not '110.538' -- a classic floating-point representation quirk (110.5375 is not
    // exactly representable in binary), confirming why these tests check real computed
    // output rather than trust arithmetic done by eye.
    const result = formatGuidanceRange({ anchorPrice: 110.500, atr: 0.300, direction: 'BUY', type: 'risk', displayPrecision: 3 });
    expect(result).toBe('110.463\u2013110.537');
  });

  it('produces correctly-precisioned text for an index (2dp), distinct from FX', () => {
    const result = formatGuidanceRange({ anchorPrice: 4500.00, atr: 16.0, direction: 'BUY', type: 'target', displayPrecision: 2 });
    // half-width = 16.0 * 0.125 = 2.0 -> 4498.00-4502.00
    expect(result).toBe('4498.00\u20134502.00');
  });

  it('uses the same half-width formula for both risk and target types in V1 (type does not change the math)', () => {
    const risk = formatGuidanceRange({ anchorPrice: 1.0960, atr: 0.0040, direction: 'BUY', type: 'risk', displayPrecision: 4 });
    const target = formatGuidanceRange({ anchorPrice: 1.0960, atr: 0.0040, direction: 'BUY', type: 'target', displayPrecision: 4 });
    expect(risk).toBe(target);
  });

  it('does not vary by direction in V1 (reserved parameter, not yet used in the formula)', () => {
    const buy = formatGuidanceRange({ anchorPrice: 1.10, atr: 0.004, direction: 'BUY', type: 'risk', displayPrecision: 4 });
    const sell = formatGuidanceRange({ anchorPrice: 1.10, atr: 0.004, direction: 'SELL', type: 'risk', displayPrecision: 4 });
    expect(buy).toBe(sell);
  });

  it('returns empty text rather than a fabricated range when atr is NaN, zero, or negative', () => {
    expect(formatGuidanceRange({ anchorPrice: 1.10, atr: NaN, direction: 'BUY', type: 'risk', displayPrecision: 4 })).toBe('');
    expect(formatGuidanceRange({ anchorPrice: 1.10, atr: 0, direction: 'BUY', type: 'risk', displayPrecision: 4 })).toBe('');
    expect(formatGuidanceRange({ anchorPrice: 1.10, atr: -0.01, direction: 'BUY', type: 'risk', displayPrecision: 4 })).toBe('');
  });

  it('returns empty text when anchorPrice is NaN', () => {
    expect(formatGuidanceRange({ anchorPrice: NaN, atr: 0.004, direction: 'BUY', type: 'risk', displayPrecision: 4 })).toBe('');
  });

  it('falls back to the documented default precision when displayPrecision is null (market not yet backfilled)', () => {
    const result = formatGuidanceRange({ anchorPrice: 1.0830, atr: 0.0040, direction: 'BUY', type: 'risk', displayPrecision: null });
    expect(result).toBe('1.0825\u20131.0835'); // same as the 4dp case -- confirms the documented fallback, not an arbitrary one
  });
});
