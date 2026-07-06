// ============================================================================
// APIP Calendar Service
// Persistent WebSocket listener for Acuity FX Calendar stream
// ============================================================================
// Runs as a Railway service. Connects to Acuity's streaming API and writes
// economic calendar events to Supabase as they arrive.
//
// Environment variables (set in Railway):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ACUITY_CALENDAR_API_KEY
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ACUITY_API_KEY = process.env.ACUITY_CALENDAR_API_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ACUITY_API_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ACUITY_CALENDAR_API_KEY')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

const COUNTRY_MARKET_MAP = {
  US: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'USDCHF', 'USDMXN', 'USDTRY',
       'AUDUSD', 'NZDUSD', 'Gold', 'Silver', 'Oil', 'Brent', 'Copper',
       'DOW', 'SP500', 'NASDAQ', 'US2000', 'Bitcoin', 'Ethereum', 'Ripple', 'Solana', 'Litecoin'],
  EU: ['EURUSD', 'EURGBP', 'EURJPY', 'EURCHF', 'EURAUD', 'EURNZD', 'EURCAD', 'EURSEK', 'DAX', 'CAC', 'EU50'],
  DE: ['EURUSD', 'EURGBP', 'DAX'],
  FR: ['EURUSD', 'EURGBP', 'CAC'],
  GB: ['GBPUSD', 'EURGBP', 'GBPJPY', 'GBPCHF', 'GBPCAD', 'GBPAUD', 'GBPNZD', 'FTSE'],
  JP: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'NZDJPY', 'CADJPY', 'CHFJPY', 'NIKKEI'],
  AU: ['AUDUSD', 'AUDCAD', 'AUDJPY', 'AUDNZD', 'AUDCHF', 'GBPAUD', 'EURAUD', 'ASX200'],
  NZ: ['NZDUSD', 'NZDJPY', 'NZDCAD', 'NZDCHF', 'AUDNZD', 'GBPNZD', 'EURNZD'],
  CA: ['USDCAD', 'AUDCAD', 'NZDCAD', 'CADCHF', 'CADJPY', 'GBPCAD', 'EURCAD'],
  CH: ['USDCHF', 'EURCHF', 'GBPCHF', 'AUDCHF', 'NZDCHF', 'CADCHF', 'CHFJPY'],
  CN: ['CHINA A50', 'SSE COMP', 'AUDUSD', 'AUDCAD', 'Copper'],
  HK: ['HS50'],
  MX: ['USDMXN'],
  TR: ['USDTRY'],
  SE: ['EURSEK'],
}

function mapImpact(volatility) {
  if (volatility >= 2) return 'HIGH'
  if (volatility === 1) return 'MEDIUM'
  return 'LOW'
}

function riskWindow(eventTime, impact) {
  const bufferMs = impact === 'HIGH' ? 60 * 60 * 1000 : 30 * 60 * 1000
  return {
    start: new Date(eventTime.getTime() - 15 * 60 * 1000).toISOString(),
    end: new Date(eventTime.getTime() + bufferMs).toISOString(),
  }
}

// Load market symbol -> market_id map
let marketIdBySymbol = new Map()

async function loadMarkets() {
  const { data } = await db.from('markets').select('market_id, symbol').eq('active', true)
  marketIdBySymbol = new Map((data ?? []).map(m => [m.symbol, m.market_id]))
  console.log(`[calendar] Loaded ${marketIdBySymbol.size} markets`)
}

async function processEvent(doc, messageType) {
  const eventId = doc.IdEventDate ?? doc.Id
  const eventDate = doc.DateUtc ?? doc.Date
  const eventName = doc.Name ?? doc.EventName
  const countryCode = (doc.CountryCode ?? doc.Country ?? '').toUpperCase()

  if (!eventId || !eventDate || !eventName) {
    console.warn(`[calendar] Skipping event with missing fields: ${JSON.stringify(doc).slice(0, 100)}`)
    return
  }

  if (messageType === 'delete') return

  const impact = mapImpact(doc.Volatility ?? 0)
  const forecast = doc.Consensus != null ? String(doc.Consensus) : null
  const previous = doc.Previous != null ? String(doc.Previous) : null
  const actual = doc.Actual != null ? String(doc.Actual) : null

  try {
    const { data: result, error } = await db.rpc('upsert_economic_calendar_event', {
      p_source_system: 'ACUITY_CALENDAR_API',
      p_source_record_id: eventId,
      p_source_event_id: doc.Id ?? eventId,
      p_event_time_uk: eventDate,
      p_country: countryCode,
      p_currency: doc.CurrencyId ?? countryCode,
      p_event_name: eventName.trim(),
      p_impact: impact,
      p_forecast: forecast,
      p_previous: previous,
      p_actual: actual,
      p_import_batch_id: null,
      p_raw_payload: doc,
    })

    if (error) {
      console.error(`[calendar] RPC error for ${eventId}: ${error.message}`)
      return
    }

    console.log(`[calendar] ${eventId} (${eventName.trim()}) [${countryCode}/${impact}]: ${result}`)

    // Map to affected markets for HIGH/MEDIUM events
    if (impact !== 'LOW') {
      const affectedSymbols = COUNTRY_MARKET_MAP[countryCode] ?? []
      if (affectedSymbols.length > 0) {
        const eventTime = new Date(eventDate)
        const { start, end } = riskWindow(eventTime, impact)
        const warning = `${impact === 'HIGH' ? 'High' : 'Medium'}-impact ${countryCode} event: ${eventName.trim()}. Be aware of potential volatility.`

        const { data: eventRow } = await db
          .from('economic_calendar_events')
          .select('event_id')
          .eq('source_record_id', eventId)
          .eq('source_system', 'ACUITY_CALENDAR_API')
          .single()

        if (eventRow?.event_id) {
          const riskRows = affectedSymbols
            .map(symbol => marketIdBySymbol.get(symbol))
            .filter(Boolean)
            .map(marketId => ({
              event_id: eventRow.event_id,
              market_id: marketId,
              risk_window_start: start,
              risk_window_end: end,
              event_risk_status: impact === 'HIGH' ? 'HIGH_RISK' : 'WATCH',
              risk_score: impact === 'HIGH' ? 0.9 : 0.5,
              analyst_warning: warning,
            }))

          if (riskRows.length > 0) {
            const { error: riskError } = await db
              .from('market_event_risk')
              .upsert(riskRows, { onConflict: 'event_id,market_id' })
            if (riskError) console.error(`[calendar] market_event_risk error: ${riskError.message}`)
          }
        }
      }
    }
  } catch (err) {
    console.error(`[calendar] Unexpected error for ${eventId}: ${err.message}`)
  }
}

// WebSocket connection with auto-reconnect
let reconnectDelay = 5000
const MAX_RECONNECT_DELAY = 60000

function connect() {
  const wsUrl = `wss://api.acuitytrading.com/api/streaming?apiKey=${ACUITY_API_KEY}`
  console.log(`[calendar] Connecting to Acuity stream...`)

  const ws = new WebSocket(wsUrl)

  ws.on('open', () => {
    console.log('[calendar] Connected. Subscribing to fxcalendar...')
    reconnectDelay = 5000 // reset on successful connect
    ws.send(JSON.stringify({
      action: 'subscribe',
      topic: 'fxcalendar',
      lang: 'en-gb',
      countries: ['us', 'eu', 'gb', 'jp', 'au', 'nz', 'ca', 'ch', 'cn', 'de', 'fr',
                  'it', 'es', 'se', 'no', 'dk', 'sg', 'hk', 'in', 'br', 'mx', 'tr'],
      fillAssetInfo: true,
      format: 0,
    }))
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.topic === 'fxcalendar' && msg.doc) {
        processEvent(msg.doc, msg.messageType).catch(err => {
          console.error('[calendar] processEvent error:', err.message)
        })
      }
    } catch (err) {
      console.error('[calendar] Failed to parse message:', err.message)
    }
  })

  ws.on('close', (code, reason) => {
    console.log(`[calendar] Disconnected: code=${code} reason=${reason.toString()}`)
    console.log(`[calendar] Reconnecting in ${reconnectDelay / 1000}s...`)
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
      connect()
    }, reconnectDelay)
  })

  ws.on('error', (err) => {
    console.error('[calendar] WebSocket error:', err.message)
  })

  // Keep-alive ping every 30 seconds
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping()
    } else {
      clearInterval(pingInterval)
    }
  }, 30000)
}

// Start
console.log('[calendar] APIP Calendar Service starting...')
loadMarkets().then(() => {
  connect()
  // Refresh market list every hour
  setInterval(loadMarkets, 60 * 60 * 1000)
}).catch(err => {
  console.error('[calendar] Failed to load markets:', err.message)
  process.exit(1)
})

// Health check endpoint for Railway
import http from 'http'
const server = http.createServer((req, res) => {
  res.writeHead(200)
  res.end(JSON.stringify({ status: 'ok', markets: marketIdBySymbol.size }))
})
server.listen(process.env.PORT || 3000, () => {
  console.log(`[calendar] Health check listening on port ${process.env.PORT || 3000}`)
})
