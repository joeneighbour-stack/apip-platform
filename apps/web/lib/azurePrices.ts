// apps/web/lib/azurePrices.ts
// Latest price from Azure Table Storage 5-minute bars -- the only price source
// (no Finnhub/EODHD/Binance). Server-side only: PRICES_TABLE_CONN is read once
// here and never sent to the client. Symbol -> AssetId comes from
// azureAssetMap.generated.ts (synced from intelligence-engine/finnhub_to_acuity.csv).
// Only import from server code (route handlers / server components).
import { TableClient, odata } from '@azure/data-tables'
import { AZURE_ASSET_IDS } from './azureAssetMap.generated'

const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000

let tableClient: TableClient | null = null
function getTableClient(): TableClient | null {
  if (tableClient) return tableClient
  const conn = process.env.PRICES_TABLE_CONN
  if (!conn) return null
  tableClient = TableClient.fromConnectionString(conn, 'Price5min')
  return tableClient
}

/** Converts a Date to the table's YYYYMMDDHHMMSS UTC RowKey format. */
function rowKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

export type LatestPrice =
  | { status: 'ok'; price: number; barTime: Date }
  | { status: 'degraded'; reason: string }

/** Close of the most recent Azure 5-min bar in the last 2 days for `priceSymbol`. */
export async function getLatestAzurePrice(priceSymbol: string): Promise<LatestPrice> {
  const assetId = AZURE_ASSET_IDS[priceSymbol]
  if (!assetId) return { status: 'degraded', reason: 'no Azure asset mapping' }
  const client = getTableClient()
  if (!client) return { status: 'degraded', reason: 'PRICES_TABLE_CONN is not set' }

  const now = new Date()
  const start = rowKey(new Date(now.getTime() - LOOKBACK_MS))
  let latest: { close: number; time: Date } | null = null
  const entities = client.listEntities<{ LastUpdatedDate: Date; Close: number }>({
    queryOptions: {
      filter: odata`PartitionKey eq ${assetId} and RowKey ge ${start}`,
      select: ['LastUpdatedDate', 'Close'],
    },
  })
  for await (const e of entities) {
    const time = new Date(e.LastUpdatedDate)
    if (!latest || time > latest.time) latest = { close: Number(e.Close), time }
  }
  if (!latest || !(latest.close > 0)) return { status: 'degraded', reason: 'no Azure 5-min bars in the last 2 days' }
  return { status: 'ok', price: latest.close, barTime: latest.time }
}
