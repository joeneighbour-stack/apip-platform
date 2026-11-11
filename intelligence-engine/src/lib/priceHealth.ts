// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Price-data health reporting
// ============================================================================
// RULE: all pricing (5-min, daily, quotes) comes from Azure Table Storage only
// (src/lib/azurePrices.ts). A market with no Azure data is DEGRADED -- it is
// reported loudly and skipped, never switched to another price source.
//
// reportDegraded() logs a DEGRADED line and, when running under GitHub
// Actions, emits an ::error annotation (shown on the workflow run page) and a
// line in the job summary.
// ============================================================================
import { appendFileSync } from 'node:fs'

export function reportDegraded(market: string, priceSymbol: string, reason: string): void {
  const message = `DEGRADED: ${market} (${priceSymbol}) -- ${reason}. No Azure price data; market skipped, no other source used.`
  console.error(`  ${message}`)
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::error title=DEGRADED price data: ${market}::${message}`)
    const summaryPath = process.env.GITHUB_STEP_SUMMARY
    if (summaryPath) {
      try { appendFileSync(summaryPath, `- :warning: ${message}\n`) } catch { /* summary is best-effort */ }
    }
  }
}
