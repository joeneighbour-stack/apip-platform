// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Price-data health reporting
// ============================================================================
// RULE: all pricing (5-min, daily, quotes) comes from Azure Table Storage only
// (src/lib/azurePrices.ts). A market with no Azure data is DEGRADED -- it is
// reported loudly and skipped, never switched to another price source.
//
// Not only missing feeds: a market the engine can't use because its daily
// history is too thin (insufficient bars), is about to become too thin (low
// row count in the 30-day window), or has a corrupt flat bar (O=H=L=C) is
// reported the same way, with its own reason and consequence.
//
// reportDegraded() logs a DEGRADED line immediately and, under GitHub Actions,
// emits an ::error annotation and a job-summary line. It also queues the
// market; sendDegradedAlerts(), called once at the end of a run, POSTs every
// queued market in a single message to the n8n webhook in
// DEGRADED_ALERT_WEBHOOK (pointed at Slack) -- one alert per run, not one per
// market, so a feed outage doesn't flood the channel.
//
// Env: DEGRADED_ALERT_WEBHOOK  n8n webhook URL. If unset while markets are
//                              DEGRADED, that is itself logged as an ::error.
// ============================================================================
import { appendFileSync } from 'node:fs'

export interface DegradedMarket { market: string; priceSymbol: string; reason: string; consequence: string }

export const NO_AZURE_DATA = 'No Azure price data; market skipped, no other source used.'

const pending: DegradedMarket[] = []
const ALERT_TIMEOUT_MS = 10_000

function annotate(title: string, message: string): void {
  if (process.env.GITHUB_ACTIONS !== 'true') return
  console.log(`::error title=${title}::${message}`)
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath) {
    try { appendFileSync(summaryPath, `- :warning: ${message}\n`) } catch { /* summary is best-effort */ }
  }
}

export function reportDegraded(market: string, priceSymbol: string, reason: string, consequence: string = NO_AZURE_DATA): void {
  const message = `DEGRADED: ${market} (${priceSymbol}) -- ${reason}. ${consequence}`
  console.error(`  ${message}`)
  annotate(`DEGRADED market data: ${market}`, message)
  pending.push({ market, priceSymbol, reason, consequence })
}

/**
 * Sends every market reported DEGRADED during this run to DEGRADED_ALERT_WEBHOOK
 * as one POST, then clears the queue. Never throws -- a failed alert is logged
 * (and annotated) but must not fail the run it is reporting on.
 */
export async function sendDegradedAlerts(source: string): Promise<void> {
  if (pending.length === 0) return
  const degraded = pending.splice(0, pending.length)
  const url = process.env.DEGRADED_ALERT_WEBHOOK
  if (!url) {
    const message = `DEGRADED_ALERT_WEBHOOK is not set -- ${degraded.length} DEGRADED market(s) from ${source} were NOT alerted: ${degraded.map(d => d.market).join(', ')}`
    console.error(`  ${message}`)
    annotate('DEGRADED alert not sent', message)
    return
  }

  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null
  const text = `:warning: DEGRADED market data (${source}):\n` +
    degraded.map(d => `• ${d.market} (${d.priceSymbol}): ${d.reason}. ${d.consequence}`).join('\n') +
    (runUrl ? `\n${runUrl}` : '')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'DEGRADED', source, at: new Date().toISOString(), run_url: runUrl, degraded, text }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    console.log(`  DEGRADED alert sent for ${degraded.length} market(s)`)
  } catch (err) {
    const message = `DEGRADED alert webhook failed (${(err as Error).message}) for: ${degraded.map(d => d.market).join(', ')}`
    console.error(`  ${message}`)
    annotate('DEGRADED alert not sent', message)
  }
}
