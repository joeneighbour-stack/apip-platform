// Curated market bundles for the Analytics filter UI. No market-grouping concept
// exists in the schema (asset_class is free text, no group/bundle table) -- this is a
// deliberately hardcoded, single, extensible config rather than scattering the same
// symbol lists across components. Symbols match the canonical names markets are
// stored/displayed under elsewhere in the app (see importActualTrades.ts SYMBOL_OVERRIDES).

export interface MarketGroup {
  key: string
  label: string
  symbols: string[]
}

export const MARKET_GROUPS: MarketGroup[] = [
  {
    key: 'major_fx',
    label: 'Major FX',
    symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD'],
  },
  {
    key: 'energy',
    label: 'Energy',
    symbols: ['Oil', 'Brent', 'Natural Gas'],
  },
  {
    key: 'metals',
    label: 'Metals',
    symbols: ['Gold', 'Silver', 'Copper', 'Platinum', 'Palladium'],
  },
  {
    key: 'us_indices',
    label: 'US Indices',
    symbols: ['NASDAQ', 'DOW', 'SP500', 'US2000'],
  },
  {
    key: 'core_markets',
    label: 'Core Markets',
    symbols: ['EURUSD', 'GBPUSD', 'Gold', 'Oil', 'NASDAQ', 'Bitcoin'],
  },
]

export function marketGroupSymbols(key: string): string[] {
  return MARKET_GROUPS.find(g => g.key === key)?.symbols ?? []
}
