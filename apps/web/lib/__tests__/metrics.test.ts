import { describe, it, expect } from 'vitest'
import { maxDrawdown, type MetricsTrade } from '../metrics.js'

function trade(overrides: Partial<MetricsTrade> = {}): MetricsTrade {
  return {
    analyst_id: 'A1', market_id: 'M1', symbol: 'EURUSD', asset_class: 'FX',
    direction: 'BUY', session: 'EUROPEAN', source_system: 'ACUITY_PERFORMANCE_API',
    triggered: true, result_r: 1.0, published_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('maxDrawdown', () => {
  it('tracks drawdown all the way to the final low, not just the first trough after the peak', () => {
    // Equity: +0.24, then steadily negative to -15.08 (peak at trade 1, trough at
    // the final trade -- both drawdown magnitude and the running peak must survive
    // the whole pass, not stop updating partway through).
    const trades: MetricsTrade[] = [
      trade({ published_at: '2026-01-01T00:00:00Z', result_r: 0.24 }),
      ...Array.from({ length: 15 }, (_, i) => trade({
        published_at: `2026-01-${String(i + 2).padStart(2, '0')}T00:00:00Z`,
        result_r: -1.0,
      })),
      trade({ published_at: '2026-01-17T00:00:00Z', result_r: -0.32 }),
    ]
    // Sanity check on the fixture itself: final equity is -15.08.
    const finalEquity = trades.reduce((s, t) => s + (t.result_r ?? 0), 0)
    expect(finalEquity).toBeCloseTo(-15.08, 10)

    const result = maxDrawdown(trades)
    expect(result.value).toBeCloseTo(-15.32, 10) // peak +0.24 to trough -15.08
    expect(result.sequenceLength).toBe(16)
  })
})
