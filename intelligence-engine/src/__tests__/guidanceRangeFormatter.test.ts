// ============================================================================
// GuidanceRangeFormatter Tests
// Tests the CANONICAL V2 interface:
//   { entryMid, distanceLow, distanceHigh, direction, type, displayPrecision }
// where distanceLow/distanceHigh are ATR-normalised q25/q75 distances (absolute, positive).
//
// The OLD interface (anchorPrice ± atr*0.125) was retired when the service
// moved to historical distance distributions. These tests verify the current
// canonical contract, not the retired one.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { formatMarketPrice, formatGuidanceRange } from '../services/guidanceRangeFormatter.js';

describe('formatMarketPrice', () => {
  it('formats to the given decimal places', () => {
    expect(formatMarketPrice(1.23456789, 4)).toBe('1.2346');
    expect(formatMarketPrice(1.23456789, 5)).toBe('1.23457');
    expect(formatMarketPrice(110.5, 3)).toBe('110.500');
    expect(formatMarketPrice(4500, 2)).toBe('4500.00');
  });
  it('falls back to 4dp when displayPrecision is null', () => {
    expect(formatMarketPrice(1.23456, null)).toBe('1.2346');
  });
  it('falls back to 4dp when displayPrecision is undefined', () => {
    expect(formatMarketPrice(1.23456, undefined)).toBe('1.2346');
  });
  it('handles zero and integer prices', () => {
    expect(formatMarketPrice(0, 4)).toBe('0.0000');
    expect(formatMarketPrice(100, 2)).toBe('100.00');
  });
  it('rounds correctly at the boundary', () => {
    expect(formatMarketPrice(1.09996, 4)).toBe('1.1000'); // 1.09995 is ambiguous in JS binary FP; 1.09996 reliably rounds up
  });
  it('handles negative prices (guard case)', () => {
    expect(formatMarketPrice(-1.1234, 4)).toBe('-1.1234');
  });
});

describe('formatGuidanceRange', () => {
  // ── BUY risk: stop is BELOW entry (entryMid - distanceHigh to entryMid - distanceLow) ──
  it('BUY risk produces correct range below entry — EURUSD 4dp', () => {
    // entryMid=1.0870, distanceLow=0.0003 (q25), distanceHigh=0.0007 (q75)
    // low  = 1.0870 - 0.0007 = 1.0863
    // high = 1.0870 - 0.0003 = 1.0867
    const result = formatGuidanceRange({
      entryMid: 1.0870, distanceLow: 0.0003, distanceHigh: 0.0007,
      direction: 'BUY', type: 'risk', displayPrecision: 4,
    });
    expect(result).toBe('1.0863\u20131.0867');
  });

  // ── SELL risk: stop is ABOVE entry (entryMid + distanceLow to entryMid + distanceHigh) ──
  it('SELL risk produces correct range above entry — JPY pair 3dp', () => {
    // entryMid=110.500, distanceLow=0.037, distanceHigh=0.075
    // low  = 110.500 + 0.037 = 110.537
    // high = 110.500 + 0.075 = 110.575
    const result = formatGuidanceRange({
      entryMid: 110.500, distanceLow: 0.037, distanceHigh: 0.075,
      direction: 'SELL', type: 'risk', displayPrecision: 3,
    });
    expect(result).toBe('110.537\u2013110.575');
  });

  // ── BUY target: profit is ABOVE entry (entryMid + distanceLow to entryMid + distanceHigh) ──
  it('BUY target produces correct range above entry — index 2dp', () => {
    // entryMid=4500.00, distanceLow=2.0, distanceHigh=4.0
    // low  = 4500 + 2.0 = 4502.00
    // high = 4500 + 4.0 = 4504.00
    const result = formatGuidanceRange({
      entryMid: 4500.00, distanceLow: 2.0, distanceHigh: 4.0,
      direction: 'BUY', type: 'target', displayPrecision: 2,
    });
    expect(result).toBe('4502.00\u20134504.00');
  });

  // ── SELL target: profit is BELOW entry (entryMid - distanceHigh to entryMid - distanceLow) ──
  it('SELL target produces correct range below entry — Gold 2dp', () => {
    // entryMid=4080.00, distanceLow=15.0, distanceHigh=30.0
    // low  = 4080 - 30.0 = 4050.00
    // high = 4080 - 15.0 = 4065.00
    const result = formatGuidanceRange({
      entryMid: 4080.00, distanceLow: 15.0, distanceHigh: 30.0,
      direction: 'SELL', type: 'target', displayPrecision: 2,
    });
    expect(result).toBe('4050.00\u20134065.00');
  });

  it('type does not change the math when BUY risk and BUY target use same direction+distances', () => {
    // risk: below entry; target: above entry — verified by sign of offsets
    const risk   = formatGuidanceRange({ entryMid: 1.0960, distanceLow: 0.0010, distanceHigh: 0.0020, direction: 'BUY', type: 'risk',   displayPrecision: 4 });
    const target = formatGuidanceRange({ entryMid: 1.0960, distanceLow: 0.0010, distanceHigh: 0.0020, direction: 'BUY', type: 'target', displayPrecision: 4 });
    expect(risk).toBe('1.0940\u20131.0950');    // 1.0960 - 0.0020 to 1.0960 - 0.0010
    expect(target).toBe('1.0970\u20131.0980'); // 1.0960 + 0.0010 to 1.0960 + 0.0020
  });

  it('direction does not swap the range order — BUY and SELL produce ranges on opposite sides', () => {
    const buy  = formatGuidanceRange({ entryMid: 1.10, distanceLow: 0.002, distanceHigh: 0.004, direction: 'BUY',  type: 'risk', displayPrecision: 4 });
    const sell = formatGuidanceRange({ entryMid: 1.10, distanceLow: 0.002, distanceHigh: 0.004, direction: 'SELL', type: 'risk', displayPrecision: 4 });
    expect(buy).toBe('1.0960\u20131.0980');    // below entry
    expect(sell).toBe('1.1020\u20131.1040');   // above entry
  });

  it('returns empty string when distanceLow is NaN', () => {
    expect(formatGuidanceRange({ entryMid: 1.10, distanceLow: NaN,   distanceHigh: 0.004, direction: 'BUY', type: 'risk', displayPrecision: 4 })).toBe('');
  });
  it('returns empty string when distanceHigh is NaN', () => {
    expect(formatGuidanceRange({ entryMid: 1.10, distanceLow: 0.002, distanceHigh: NaN,   direction: 'BUY', type: 'risk', displayPrecision: 4 })).toBe('');
  });
  it('returns empty string when distanceLow <= 0', () => {
    expect(formatGuidanceRange({ entryMid: 1.10, distanceLow: 0,     distanceHigh: 0.004, direction: 'BUY', type: 'risk', displayPrecision: 4 })).toBe('');
    expect(formatGuidanceRange({ entryMid: 1.10, distanceLow: -0.01, distanceHigh: 0.004, direction: 'BUY', type: 'risk', displayPrecision: 4 })).toBe('');
  });
  it('returns empty string when entryMid is NaN', () => {
    expect(formatGuidanceRange({ entryMid: NaN,  distanceLow: 0.002, distanceHigh: 0.004, direction: 'BUY', type: 'risk', displayPrecision: 4 })).toBe('');
  });
  it('falls back to documented default precision (4dp) when displayPrecision is null', () => {
    const result = formatGuidanceRange({ entryMid: 1.0870, distanceLow: 0.0003, distanceHigh: 0.0007, direction: 'BUY', type: 'risk', displayPrecision: null });
    expect(result).toBe('1.0863\u20131.0867');
  });
});

