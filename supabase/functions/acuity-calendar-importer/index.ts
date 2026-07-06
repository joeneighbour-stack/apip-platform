// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Phase 1.4 -- Acuity Calendar importer (Deno Edge Function)
// ============================================================================
// Opens a short-lived WebSocket connection to Acuity's FX calendar stream,
// collects events for 45 seconds (enough to receive the full upcoming
// calendar payload on initial subscribe), then processes each event through
// the existing upsert_economic_calendar_event RPC.
//
// messageType handling:
//   insert  -- new event, upsert as normal
//   update  -- forecast/actual revision, upsert handles revision tracking
//   delete  -- ignored (rare, no delete path in schema)
//
// Revision tracking is handled inside upsert_economic_calendar_event.
// After importing events, maps HIGH/MEDIUM events to affected markets
// via market_event_risk.
// ============================================================================

import {
  getServiceClient, startBatch, recordSuccess, recordError, finalizeBatch,
  buildErrorPayload,
} from "../_shared/ingestion.ts";

const COLLECTION_TIMEOUT_MS = 45_000

const COUNTRY_MARKET_MAP: Record<string, string[]> = {
  US: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'USDCHF', 'USDMXN', 'USDTRY',
       'AUDUSD', 'NZDUSD', 'Gold', 'Silver', 'Oil', 'Brent', 'Copper',
       'DOW', 'SP500', 'NASDAQ', 'US2000', 'Bitcoin', 'Ethereum', 'Ripple', 'Solana', 'Litecoin'],
  EU: ['EURUSD', 'EURGBP', 'EURJPY', 'EURCHF', 'EURAUD', 'EURNZD', 'EURCAD', 'EURSEK', 'DAX', 'CAC', 'EU50'],
  GB: ['GBPUSD', 'EURGBP', 'GBPJPY', 'GBPCHF', 'GBPCAD', 'GBPAUD', 'GBPNZD', 'FTSE'],
  JP: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'NZDJPY', 'CADJPY', 'CHFJPY', 'NIKKEI'],
  AU: ['AUDUSD', 'AUDCAD', 'AUDJPY', 'AUDNZD', 'AUDCHF', 'GBPAUD', 'EURAUD', 'ASX200'],
  NZ: ['NZDUSD', 'NZDJPY', 'NZDCAD', 'NZDCHF', 'AUDNZD', 'GBPNZD', 'EURNZD'],
  CA: ['USDCAD', 'AUDCAD', 'NZDCAD', 'CADCHF', 'CADJPY', 'GBPCAD', 'EURCAD'],
  CH: ['USDCHF', 'EURCHF', 'GBPCHF', 'AUDCHF', 'NZDCHF', 'CADCHF', 'CHFJPY'],
  CN: ['CHINA A50', 'SSE COMP', 'AUDUSD', 'AUDCAD', 'Copper'],
  HK: ['HS50'],
}

function mapImpact(volatility: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (volatility >= 2) return 'HIGH'
  if (volatility === 1) return 'MEDIUM'
  return 'LOW'
}

function riskWindow(eventTime: Date, impact: string): { start: string; end: string } {
  const bufferMs = impact === 'HIGH' ? 60 * 60 * 1000 : 30 * 60 * 1000
  return {
    start: new Date(eventTime.getTime() - 15 * 60 * 1000).toISOString(),
    end: new Date(eventTime.getTime() + bufferMs).toISOString(),
  }
}

Deno.serve(async (_req: Request) => {
  const ACUITY_API_KEY = Deno.env.get("ACUITY_CALENDAR_API_KEY")
  if (!ACUITY_API_KEY) {
    return new Response(JSON.stringify({ error: "ACUITY_CALENDAR_API_KEY not configured" }), { status: 500 })
  }

  const db = getServiceClient()
  const handle = await startBatch(db, "ACUITY_CALENDAR_API", "economic_calendar_events",
    "INCREMENTAL_API_SYNC", "ACUITY_CALENDAR_IMPORTER")

  const { data: markets } = await db.from('markets').select('market_id, symbol').eq('active', true)
  const marketIdBySymbol = new Map((markets ?? []).map((m: any) => [m.symbol, m.market_id]))

  // Collect events via WebSocket
  const messages: any[] = []
  let wsError: string | null = null

  // Note: API key goes in query param per Acuity's spec. logSafe/maskUrlSecrets
  // in the shared helper will strip it if it appears in any logged URL.
  const wsUrl = `wss://api.acuitytrading.com/api/streaming?apiKey=${ACUITY_API_KEY}`

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), COLLECTION_TIMEOUT_MS)

    try {
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log('[acuity-calendar] WebSocket connected')
        ws.send(JSON.stringify({
          action: 'subscribe',
          topic: 'fxcalendar',
          lang: 'en-gb',
          fillAssetInfo: true,
          format: 0,
        }))
      }

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.topic === 'fxcalendar' && msg.doc && msg.messageType !== 'delete') {
            messages.push(msg)
          }
        } catch { /* ignore parse errors */ }
      }

      ws.onerror = () => {
        wsError = 'WebSocket connection failed'
        clearTimeout(timeout)
        resolve()
      }

      ws.onclose = () => {
        clearTimeout(timeout)
        resolve()
      }
    } catch (err) {
      wsError = err instanceof Error ? err.message : String(err)
      clearTimeout(timeout)
      resolve()
    }
  })

  if (wsError && messages.length === 0) {
    await recordError(db, handle, null, 'PROVIDER_ERROR', wsError, buildErrorPayload(null))
    await finalizeBatch(db, handle, 1)
    return new Response(JSON.stringify({ error: wsError, importBatchId: handle.importBatchId }), { status: 502 })
  }

  console.log(`[acuity-calendar] Collected ${messages.length} events`)

  for (const msg of messages) {
    const doc = msg.doc
    if (!doc?.Id || !doc?.Date || !doc?.EventName) {
      await recordError(db, handle, doc?.Id ?? null, 'MISSING_REQUIRED_FIELD',
        'Missing Id, Date, or EventName', buildErrorPayload(doc))
      continue
    }

    const detail = doc.EventDetails?.[0] ?? {}
    const volatility = detail.Volatility ?? 0
    const impact = mapImpact(volatility)
    const country = (doc.Country ?? '').toUpperCase()

    try {
      const { data: result, error: rpcError } = await db.rpc('upsert_economic_calendar_event', {
        p_source_system: 'ACUITY_CALENDAR_API',
        p_source_record_id: doc.Id,
        p_source_event_id: doc.Id,
        p_event_time_uk: doc.Date,
        p_country: country,
        p_currency: country,
        p_event_name: doc.EventName.trim(),
        p_impact: impact,
        p_forecast: detail.Expected != null ? String(detail.Expected) : null,
        p_previous: detail.Previous != null ? String(detail.Previous) : null,
        p_actual: detail.Actual != null ? String(detail.Actual) : null,
        p_import_batch_id: handle.importBatchId,
        p_raw_payload: doc,
      })

      if (rpcError) {
        await recordError(db, handle, doc.Id, 'SCHEMA_MISMATCH', rpcError.message, buildErrorPayload(doc))
        continue
      }

      console.log(`[acuity-calendar] ${doc.Id} (${doc.EventName.trim()}): ${result}`)
      await recordSuccess(db, handle)

      if (impact !== 'LOW') {
        const affectedSymbols = COUNTRY_MARKET_MAP[country] ?? []
        if (affectedSymbols.length > 0) {
          const eventTime = new Date(doc.Date)
          const { start, end } = riskWindow(eventTime, impact)
          const eventRiskStatus = impact === 'HIGH' ? 'HIGH_RISK' : 'WATCH'
          const riskScore = impact === 'HIGH' ? 0.9 : 0.5
          const warning = `${impact === 'HIGH' ? 'High' : 'Medium'}-impact ${country} event: ${doc.EventName.trim()}. Be aware of potential volatility.`

          const { data: eventRow } = await db
            .from('economic_calendar_events')
            .select('event_id')
            .eq('source_record_id', doc.Id)
            .eq('source_system', 'ACUITY_CALENDAR_API')
            .single()

          if (eventRow?.event_id) {
            const riskRows = affectedSymbols
              .map((symbol: string) => marketIdBySymbol.get(symbol))
              .filter(Boolean)
              .map((marketId: string) => ({
                event_id: eventRow.event_id,
                market_id: marketId,
                risk_window_start: start,
                risk_window_end: end,
                event_risk_status: eventRiskStatus,
                risk_score: riskScore,
                analyst_warning: warning,
              }))

            if (riskRows.length > 0) {
              await db.from('market_event_risk').upsert(riskRows, { onConflict: 'event_id,market_id' })
            }
          }
        }
      }
    } catch (err) {
      await recordError(db, handle, doc.Id, 'PROVIDER_ERROR',
        err instanceof Error ? err.message : String(err), buildErrorPayload(doc))
    }
  }

  await finalizeBatch(db, handle, messages.length)

  return new Response(JSON.stringify({
    importBatchId: handle.importBatchId,
    processed: messages.length,
    success: handle.successRows,
    duplicate: handle.duplicateRows,
    errors: handle.errorRows,
  }), { headers: { 'Content-Type': 'application/json' } })
})
