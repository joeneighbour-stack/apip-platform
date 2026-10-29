// Single source of truth for API-vendor-symbol -> APIP market-symbol normalisation,
// used by both apps/web (this report-time lookup) and
// intelligence-engine/src/scripts/importActualTrades.ts (which imports SYMBOL_OVERRIDES
// from this file via a cross-package relative import -- apps/web and intelligence-engine
// are separate deployable units with no shared lib package, so a relative import across
// the two is the only way to avoid a second, driftable copy).
//
// pattern_trades.symbol is the raw vendor symbol from the n8n webhook and is inserted
// with NO normalisation at all (see importActualTrades.ts's pattern-routing block:
// `symbol: (t.Symbol as string ?? '').replace('/', '')`, no SYMBOL_OVERRIDES lookup) --
// so a pattern on Bitcoin can show up labelled "BTCUSD" while the same market in the
// Analyst report is labelled "Bitcoin". normaliseSymbol() below is this file's own
// report-time fix for that display mismatch; it does NOT touch the stored pattern_trades
// rows (see that function's comment for why a backfill would be needed to go further).
export const SYMBOL_OVERRIDES: Record<string, string> = {
  'NATURAL GAS.1': 'SKIP',
  'US100': 'NASDAQ',
  'NAS100': 'NASDAQ',
  'WTI': 'Oil',
  'CRUDE': 'Oil',
  'XAUUSD': 'Gold',
  'XAGUSD': 'Silver',
  'BTCUSD': 'Bitcoin',
  'ETHUSD': 'Ethereum',
  'UK100': 'FTSE',
  'GER30': 'DAX',
  'GER40': 'DAX',
  'FRA40': 'CAC',
  'JP225': 'NIKKEI',
  'NIK225': 'NIKKEI',
  'AUS200': 'ASX200',
  'HK50': 'HS50',
  'CHN50': 'CHINA A50',
  'CHINA50': 'CHINA A50',
  'US30': 'DOW',
  'DOWJONES': 'DOW',
  'SPX500': 'SP500',
  'US500': 'SP500',
  'US2000': 'US2000',
  'XCUUSD': 'Copper',
  'COPPER': 'Copper',
  'PLATINUM': 'Platinum',
  'PALLADIUM': 'Palladium',
  'NATGAS': 'Natural Gas',
  'NATURAL GAS': 'Natural Gas',
  'BRENT': 'Brent',
  'XRP': 'Ripple',
}

// Pattern trades have no "out of scope, skip entirely" concept the way actual_trades
// import does (a 'SKIP' mapping there drops the row before insert) -- a pattern trade
// already exists as a row by the time this runs, so 'SKIP' here just means "no better
// name available", and the raw symbol is kept rather than displaying the literal
// string "SKIP" as an asset name.
export function normaliseSymbol(raw: string | null | undefined): string {
  if (!raw) return 'Unknown'
  const mapped = SYMBOL_OVERRIDES[raw.toUpperCase()] ?? SYMBOL_OVERRIDES[raw] ?? raw
  return mapped === 'SKIP' ? raw : mapped
}
