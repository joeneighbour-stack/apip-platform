import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AZURE_ASSET_IDS } from '../azureAssetMap.generated'
import { venueAssetMap } from '../../../../scripts/sync-web-asset-map.mjs'

const csvPath = path.resolve(__dirname, '../../../../intelligence-engine/finnhub_to_acuity.csv')

describe('azureAssetMap.generated', () => {
  it('matches intelligence-engine/finnhub_to_acuity.csv (run scripts/sync-web-asset-map.mjs if this fails)', () => {
    const expected = Object.fromEntries(venueAssetMap(readFileSync(csvPath, 'utf8')))
    expect(AZURE_ASSET_IDS).toEqual(expected)
  })

  it('maps Solana and Litecoin to their Coinbase AssetIds', () => {
    expect(AZURE_ASSET_IDS['BINANCE:SOLUSDT']).toBe('115401')
    expect(AZURE_ASSET_IDS['BINANCE:LTCUSDT']).toBe('113062')
  })
})
