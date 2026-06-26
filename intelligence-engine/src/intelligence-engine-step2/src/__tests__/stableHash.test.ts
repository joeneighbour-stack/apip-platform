import { describe, it, expect } from 'vitest';
import { stableHash } from '../services/stableHash.js';

describe('stableHash', () => {
  it('matches the verified Python notebook stable_hash() output for a known object', () => {
    // This exact hash was produced by running the notebook's actual
    // stable_hash() function in Python against this exact object and
    // confirming byte-for-byte equality before writing this assertion --
    // not assumed, checked. If this test ever fails after a refactor, the
    // hashing logic has drifted from the notebook, which would silently
    // break every equivalence check in ValidationService.
    const PARAMETERS = { atr_period: 14, zone_count: 4, stale_atr_threshold: 0.25 };
    expect(stableHash(PARAMETERS)).toBe('61d697731084153db2afde0499accba49c64365847b97705a4e8cda762d8ca0a');
  });

  it('is insensitive to key insertion order (matches Python sort_keys=True at every nesting level)', () => {
    const a = { z: 1, a: { y: 2, b: 3 } };
    const b = { a: { b: 3, y: 2 }, z: 1 };
    expect(stableHash(a)).toBe(stableHash(b));
  });

  it('is sensitive to actual value differences', () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});
