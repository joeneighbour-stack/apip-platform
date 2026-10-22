// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Azure Table Storage price fetcher
// ============================================================================
// Drop-in replacement for the Finnhub /stock/candle, /forex/candle, and
// /crypto/candle endpoints used across monitorShadowTrades.ts,
// captureIntradaySnapshot.ts, populateMarketStateDaily.ts, and
// reconstructHistoricalEntryZones.ts. getCandles() returns the same
// { s, t, o, h, l, c, v } shape those endpoints returned, so each caller's
// downstream bar-slicing logic (entry/trigger detection, ATR, MFE/MAE) is
// unchanged.
//
// Required env vars:
//   PRICES_TABLE_CONN       Azure Table Storage connection string. Never
//                           logged or printed -- read once, held only in the
//                           TableClient instances constructed from it.
//   FINNHUB_ASSET_MAP_PATH  optional -- path to the FinnhubSymbol -> AssetId
//                           CSV. Defaults to intelligence-engine/finnhub_to_acuity.csv.
// ============================================================================
import { TableClient, odata } from '@azure/data-tables'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ASSET_MAP_PATH = path.join(__dirname, '../../finnhub_to_acuity.csv')

export type Resolution = '5' | '60' | '240' | 'D'

// Resolution -> Azure table name. Table *clients* (which need
// PRICES_TABLE_CONN) are constructed lazily in getTableClient() below, not
// from this map directly -- see the lazy-init note above getAssetMap().
const TABLE_NAMES: Record<Resolution, string> = {
  '5': 'Price5min',
  '60': 'Price1h',
  '240': 'Price4h',
  'D': 'Price1d',
}

export interface AzureBar {
  LastUpdatedDate: Date
  Open: number
  High: number
  Low: number
  Close: number
  Volume: number
}

export interface FinnhubCandleResponse {
  s: string
  t: number[]
  o: number[]
  h: number[]
  l: number[]
  c: number[]
  v: number[]
}

interface RawAzureEntity {
  LastUpdatedDate: Date
  Open: number
  High: number
  Low: number
  Close: number
  Volume: number
}

// ── Lazy, memoized asset-map + table-client initialisation ─────────────────
// Neither the CSV nor the Azure table clients are touched at module-import
// time -- a script that only imports this module for its types, without ever
// calling getCandles/getLatestBar, needs neither PRICES_TABLE_CONN set nor
// the CSV present. Both are loaded/constructed on first real use and cached
// for the lifetime of the process.

let assetMapPromise: Promise<Map<string, string>> | null = null
const tableClientCache = new Map<Resolution, TableClient>()

async function loadAssetMap(): Promise<Map<string, string>> {
  const csvPath = process.env.FINNHUB_ASSET_MAP_PATH ?? DEFAULT_ASSET_MAP_PATH
  const text = await readFile(csvPath, 'utf8')
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0)
  if (lines.length === 0) {
    throw new Error(`Asset map CSV at ${csvPath} is empty`)
  }

  const header = lines[0]!.split(',').map(h => h.trim())
  const symbolIdx = header.indexOf('FinnhubSymbol')
  const assetIdIdx = header.indexOf('AssetId')
  if (symbolIdx === -1 || assetIdIdx === -1) {
    throw new Error(`Asset map CSV at ${csvPath} must have FinnhubSymbol and AssetId columns`)
  }

  const map = new Map<string, string>()
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    const symbol = cols[symbolIdx]?.trim()
    const assetId = cols[assetIdIdx]?.trim() // kept as string -- never cast to number
    if (!symbol || !assetId) continue

    // Duplicate FinnhubSymbol -- keep the first occurrence and skip the rest
    // rather than overwrite, so lookup doesn't silently depend on CSV row
    // order (last one in winning).
    if (map.has(symbol)) continue
    map.set(symbol, assetId)
  }
  return map
}

function getAssetMap(): Promise<Map<string, string>> {
  if (!assetMapPromise) assetMapPromise = loadAssetMap()
  return assetMapPromise
}

async function resolveAssetId(symbol: string): Promise<string> {
  const map = await getAssetMap()
  const assetId = map.get(symbol)
  if (assetId === undefined) {
    throw new Error(`No AssetId mapping found for Finnhub symbol "${symbol}" in asset map CSV`)
  }
  return assetId
}

function getTableClient(resolution: string): TableClient {
  const tableName = TABLE_NAMES[resolution as Resolution]
  if (!tableName) {
    throw new Error(`Unknown resolution "${resolution}" -- expected one of ${Object.keys(TABLE_NAMES).join(', ')}`)
  }

  const cached = tableClientCache.get(resolution as Resolution)
  if (cached) return cached

  const conn = process.env.PRICES_TABLE_CONN
  if (!conn) {
    throw new Error('PRICES_TABLE_CONN is not set')
  }
  const client = TableClient.fromConnectionString(conn, tableName)
  tableClientCache.set(resolution as Resolution, client)
  return client
}

// ── rowKey ───────────────────────────────────────────────────────────────────

/** Converts a Unix timestamp (seconds) to the table's YYYYMMDDHHMMSS UTC RowKey format. */
export function rowKey(ts: number): string {
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    String(d.getUTCFullYear()) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  )
}

// ── fetchRange ───────────────────────────────────────────────────────────────

/**
 * Queries [start, end) bars for one asset: PartitionKey eq assetId, RowKey in
 * [start, end). Selects only the columns needed to build a candle (RowKey
 * itself is not requested -- LastUpdatedDate is used as each bar's timestamp
 * instead, see getCandles()).
 */
export async function fetchRange(
  tableClient: TableClient,
  assetId: string,
  start: string,
  end: string,
): Promise<AzureBar[]> {
  const bars: AzureBar[] = []
  const entities = tableClient.listEntities<RawAzureEntity>({
    queryOptions: {
      filter: odata`PartitionKey eq ${assetId} and RowKey ge ${start} and RowKey lt ${end}`,
      select: ['LastUpdatedDate', 'Open', 'High', 'Low', 'Close', 'Volume'],
    },
  })
  for await (const entity of entities) {
    bars.push({
      LastUpdatedDate: entity.LastUpdatedDate,
      Open: Number(entity.Open),
      High: Number(entity.High),
      Low: Number(entity.Low),
      Close: Number(entity.Close),
      Volume: Number(entity.Volume),
    })
  }
  return bars
}

// ── getCandles ───────────────────────────────────────────────────────────────

/** Same signature/response shape as Finnhub's candle endpoints. */
export async function getCandles(
  symbol: string,
  resolution: string,
  from: number,
  to: number,
): Promise<FinnhubCandleResponse> {
  const assetId = await resolveAssetId(symbol)
  const tableClient = getTableClient(resolution)

  const bars = await fetchRange(tableClient, assetId, rowKey(from), rowKey(to + 1))
  if (bars.length === 0) {
    return { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] }
  }

  const sorted = [...bars].sort((a, b) => a.LastUpdatedDate.getTime() - b.LastUpdatedDate.getTime())
  return {
    s: 'ok',
    t: sorted.map(b => Math.floor(b.LastUpdatedDate.getTime() / 1000)),
    o: sorted.map(b => b.Open),
    h: sorted.map(b => b.High),
    l: sorted.map(b => b.Low),
    c: sorted.map(b => b.Close),
    v: sorted.map(b => b.Volume),
  }
}

// ── getLatestBar ─────────────────────────────────────────────────────────────

/** Most recent bar within a trailing window (10 days for 'D', 2 days otherwise), or null. */
export async function getLatestBar(symbol: string, resolution: string): Promise<AzureBar | null> {
  const assetId = await resolveAssetId(symbol)
  const tableClient = getTableClient(resolution)

  const windowDays = resolution === 'D' ? 10 : 2
  const to = Math.floor(Date.now() / 1000)
  const from = to - windowDays * 24 * 60 * 60

  const bars = await fetchRange(tableClient, assetId, rowKey(from), rowKey(to + 1))
  if (bars.length === 0) return null

  const sorted = [...bars].sort((a, b) => a.LastUpdatedDate.getTime() - b.LastUpdatedDate.getTime())
  return sorted[sorted.length - 1]!
}
