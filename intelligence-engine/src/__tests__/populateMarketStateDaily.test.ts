import { describe, it, expect } from 'vitest'
import { isFlatBar } from '../scripts/populateMarketStateDaily.js'

describe('isFlatBar', () => {
  it('flags a bar with open = high = low = close', () => {
    expect(isFlatBar({ date: '2026-10-28', open: 50, high: 50, low: 50, close: 50 })).toBe(true)
  })

  it('keeps a bar with any range', () => {
    expect(isFlatBar({ date: '2026-10-29', open: 49.8, high: 49.835, low: 49.748, close: 49.825 })).toBe(false)
    expect(isFlatBar({ date: '2026-11-08', open: 50.133, high: 50.133, low: 50.119, close: 50.125 })).toBe(false)
  })
})
