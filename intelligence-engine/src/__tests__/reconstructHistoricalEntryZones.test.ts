import { describe, it, expect } from 'vitest';
import { findLastBarIndexOnOrBefore } from '../scripts/reconstructHistoricalEntryZones.js';
import type { OhlcBar } from '../services/marketStateService.js';

function bar(date: string): OhlcBar {
  return { date, open: 1, high: 1, low: 1, close: 1 };
}

describe('findLastBarIndexOnOrBefore', () => {
  const bars = [bar('2020-01-01'), bar('2020-01-02'), bar('2020-01-03'), bar('2020-01-06')]; // gap over a weekend

  it('finds the exact matching bar when the target date has a bar', () => {
    expect(findLastBarIndexOnOrBefore(bars, '2020-01-02')).toBe(1);
  });

  it('finds the most recent prior bar when the target date has no bar (e.g. a weekend)', () => {
    // 2020-01-04 and 01-05 have no bars (weekend) -- should fall back to 01-03 (index 2).
    expect(findLastBarIndexOnOrBefore(bars, '2020-01-04')).toBe(2);
    expect(findLastBarIndexOnOrBefore(bars, '2020-01-05')).toBe(2);
  });

  it('returns -1 when the target date predates every bar in the series', () => {
    expect(findLastBarIndexOnOrBefore(bars, '2019-12-31')).toBe(-1);
  });

  it('returns the last index when the target date is after every bar in the series', () => {
    expect(findLastBarIndexOnOrBefore(bars, '2099-01-01')).toBe(3);
  });

  it('returns -1 for an empty series', () => {
    expect(findLastBarIndexOnOrBefore([], '2020-01-01')).toBe(-1);
  });
});
