-- ============================================================================
-- APIP Phase 1.7 -- Add price data provider symbol mapping to markets
-- ============================================================================
-- Adds price_data_provider and price_data_symbol columns to markets so
-- the Finnhub/OANDA/IC Markets symbol mapping lives in the database rather
-- than hardcoded in scripts. Scripts query these columns at runtime.
--
-- price_data_provider: which API provides price data for this market
-- price_data_symbol:   the symbol string to use with that provider
-- price_data_notes:    free text for edge cases (e.g. SA40 via IC Markets)
-- ============================================================================

alter table markets
  add column if not exists price_data_provider text,
  add column if not exists price_data_symbol   text,
  add column if not exists price_data_notes    text;

comment on column markets.price_data_provider is
  'API provider for live price data. e.g. FINNHUB_OANDA, IC_MARKETS, FINNHUB_CRYPTO';
comment on column markets.price_data_symbol is
  'Symbol string used with the price_data_provider API. e.g. OANDA:EUR_USD';

-- ── OANDA via Finnhub ─────────────────────────────────────────────────────
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:EUR_USD'   where symbol = 'EURUSD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:GBP_USD'   where symbol = 'GBPUSD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:EUR_GBP'   where symbol = 'EURGBP';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:EUR_NZD'   where symbol = 'EURNZD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:AUD_CAD'   where symbol = 'AUDCAD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:AUD_JPY'   where symbol = 'AUDJPY';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:GBP_CHF'   where symbol = 'GBPCHF';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:USD_MXN'   where symbol = 'USDMXN';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:NZD_JPY'   where symbol = 'NZDJPY';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:USD_CHF'   where symbol = 'USDCHF';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:USD_JPY'   where symbol = 'USDJPY';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:USD_CAD'   where symbol = 'USDCAD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:EUR_CHF'   where symbol = 'EURCHF';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:AUD_USD'   where symbol = 'AUDUSD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:GBP_JPY'   where symbol = 'GBPJPY';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:GBP_AUD'   where symbol = 'GBPAUD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:NZD_USD'   where symbol = 'NZDUSD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:EUR_AUD'   where symbol = 'EURAUD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:GBP_NZD'   where symbol = 'GBPNZD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:USD_TRY'   where symbol = 'USDTRY';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:GBP_CAD'   where symbol = 'GBPCAD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:EUR_JPY'   where symbol = 'EURJPY';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:EUR_SEK'   where symbol = 'EURSEK';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:USD_CNH'   where symbol = 'USDCNH';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:GBP_ZAR'   where symbol = 'GBPZAR';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:EUR_CAD'   where symbol = 'EURCAD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:AUD_NZD'   where symbol = 'AUDNZD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:EUR_NOK'   where symbol = 'EURNOK';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:USD_ZAR'   where symbol = 'USDZAR';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:CAD_JPY'   where symbol = 'CADJPY';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:NZD_CAD'   where symbol = 'NZDCAD';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:CHF_JPY'   where symbol = 'CHFJPY';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:EUR_PLN'   where symbol = 'EURPLN';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:GBP_PLN'   where symbol = 'GBPPLN';

-- Indices
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:US30_USD'    where symbol = 'DOW';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:NAS100_USD'  where symbol = 'NASDAQ';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:SPX500_USD'  where symbol = 'SP500';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:UK100_GBP'   where symbol = 'FTSE';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:DE30_EUR'    where symbol = 'DAX';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:FR40_EUR'    where symbol = 'CAC';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:AU200_AUD'   where symbol = 'ASX200';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:CN50_USD'    where symbol = 'CHINA A50';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:HK33_HKD'   where symbol = 'HS50';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:JP225_USD'   where symbol = 'NIKKEI';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:US2000_USD'  where symbol = 'Russell2000';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:US30_USD'    where symbol = 'DOW Futures';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:NAS100_USD'  where symbol = 'NASDAQ Futures';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:SPX500_USD'  where symbol = 'SP500 Futures';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:US2000_USD'  where symbol = 'Russell2000 Futures';

-- SA40 -- IC Markets provider (Finnhub OANDA does not carry this)
update markets set
  price_data_provider = 'IC_MARKETS',
  price_data_symbol   = 'SA40',
  price_data_notes    = 'South Africa Top 40. Not available via Finnhub OANDA. Requires IC Markets data feed.'
where symbol = 'SA40';

-- Commodities
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:WTICO_USD'   where symbol = 'Oil';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:BCO_USD'     where symbol = 'Brent';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:BCO_USD'     where symbol = 'Brent Oil';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:XAU_USD'     where symbol = 'Gold';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:XAG_USD'     where symbol = 'Silver';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:XCU_USD'     where symbol = 'Copper';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:XPT_USD'     where symbol = 'Platinum';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:XPD_USD'     where symbol = 'Palladium';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:NATGAS_USD'  where symbol = 'Natural Gas';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:XAU_USD'     where symbol = 'Gold Futures';
update markets set price_data_provider = 'FINNHUB_OANDA', price_data_symbol = 'OANDA:WTICO_USD'   where symbol = 'Oil Futures';

-- Crypto -- Finnhub crypto endpoint (different from OANDA)
update markets set price_data_provider = 'FINNHUB_CRYPTO', price_data_symbol = 'BINANCE:BTCUSDT'  where symbol = 'Bitcoin';
update markets set price_data_provider = 'FINNHUB_CRYPTO', price_data_symbol = 'BINANCE:ETHUSDT'  where symbol = 'Ethereum';
update markets set price_data_provider = 'FINNHUB_CRYPTO', price_data_symbol = 'BINANCE:XRPUSDT'  where symbol = 'XRP';
update markets set price_data_provider = 'FINNHUB_CRYPTO', price_data_symbol = 'BINANCE:SOLUSDT'  where symbol = 'Solana';
update markets set price_data_provider = 'FINNHUB_CRYPTO', price_data_symbol = 'BINANCE:LTCUSDT'  where symbol = 'Litecoin';

-- Verify
select count(*) as mapped, count(*) filter (where price_data_symbol is null) as unmapped
from markets where active = true;
