// ============================================================================
// APIP Trading Intelligence & Performance Platform
// Condition Awareness Script
// ============================================================================
// Runs during publication windows to check if active recommendations are
// still valid given current market conditions.
//
// Compares current price/zone against price_at_generation/zone_at_generation
// and updates recommendation_validity_status accordingly.
//
// Thresholds (from model_parameters or defaults):
//   STALE_PRICE:          price move > 0.25 ATR since generation
//   DO_NOT_USE_RECALCULATE: price move > 0.50 ATR since generation
//   ZONE_CHANGED:         current zone != zone_at_generation
//
// Run every 15 mins via GitHub Actions during session windows.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assessCondition } from '../services/recommendationLifecycleService.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const STALE_ATR_THRESHOLD = 0.25
const FORCE_RECALC_ATR_THRESHOLD = 0.50

// SLA minutes per severity (per spec sheet 29)
const SLA_MINUTES: Record<string, number> = {
  CRITICAL:       30,
  WARNING:        240,  // 4 hours
  INFO:           0,
  SYSTEM_FAILURE: 15,
}

async function fetchCurrentPrice(finnhubSymbol: string, apiKey: string): Promise<number | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${apiKey}`
    const response = await fetch(url)
    if (!response.ok) return null
    const quote = await response.json() as { c: number }
    return quote.c && quote.c > 0 ? quote.c : null
  } catch {
    return null
  }
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FINNHUB_API_KEY) {
    console.error('Missing required env vars')
    process.exit(1)
  }

  const isDryRun = process.argv.includes('--dry-run')
  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log('Running condition awareness check...\n')

  const today = new Date().toISOString().slice(0, 10)

  // Load today's opportunities
  const { data: todayOpps } = await db
    .from('opportunities')
    .select('opportunity_id, date, session, market:market_id(market_id, symbol, price_data_symbol, price_data_provider)')
    .eq('date', today)

  if (!todayOpps?.length) {
    console.log('No opportunities for today.')
    return
  }

  const oppIds = todayOpps.map(o => o.opportunity_id)

  // Load active recommendation versions
  const { data: activeRecs } = await db
    .from('recommendation_versions')
    .select('recommendation_version_id, price_at_generation, zone_at_generation, recommendation_validity_status, requires_refresh, opportunity_id')
    .in('opportunity_id', oppIds)
    .in('recommendation_validity_status', ['VALID', 'CAUTION_VOLATILITY', 'STALE_PRICE'])

  if (!activeRecs?.length) {
    console.log('No active recommendations to check.')
    return
  }

  const oppById = new Map(todayOpps.map(o => [o.opportunity_id, o]))

  // Load latest ATR14 per market
  const marketIds = [...new Set(todayOpps.map(o => (o.market as any).market_id))]
  const { data: atrRows } = await db
    .from('market_state_daily')
    .select('market_id, atr14, date')
    .in('market_id', marketIds)
    .order('date', { ascending: false })

  const atr14ByMarketId = new Map<string, number>()
  for (const row of (atrRows ?? [])) {
    if (!atr14ByMarketId.has(row.market_id)) {
      atr14ByMarketId.set(row.market_id, Number(row.atr14))
    }
  }

  console.log(`Checking ${activeRecs.length} active recommendations...\n`)

  const summary = { valid: 0, caution: 0, stale: 0, zoneChanged: 0, doNotUse: 0, errors: 0 }

  for (const rec of activeRecs) {
    const opp = oppById.get(rec.opportunity_id) as any
    const market = opp?.market as any
    if (!market?.price_data_symbol) { summary.errors++; continue }

    const atr14 = atr14ByMarketId.get(market.market_id) ?? null

    const currentPrice = await fetchCurrentPrice(market.price_data_symbol, FINNHUB_API_KEY)
    if (!currentPrice) { summary.errors++; continue }

    const { data: intraday } = await db
      .from('market_state_intraday')
      .select('current_zone')
      .eq('market_id', market.market_id)
      .eq('session', opp.session)
      .gte('captured_at', today + 'T00:00:00Z')
      .order('captured_at', { ascending: false })
      .limit(1)
      .single()

    const currentZone = intraday?.current_zone ?? null

    const assessment = assessCondition({
      currentPrice,
      priceAtGeneration: Number(rec.price_at_generation),
      zoneAtGeneration: rec.zone_at_generation,
      currentZone,
      atr14,
      staleAtrThreshold: STALE_ATR_THRESHOLD,
      forceRecalcAtrThreshold: FORCE_RECALC_ATR_THRESHOLD,
    })

    const newStatus = assessment.recommendationValidityStatus
    const oldStatus = rec.recommendation_validity_status

    if (newStatus !== oldStatus) {
      console.log(`  ${market.symbol}: ${oldStatus} → ${newStatus} (price=${currentPrice}, atrMove=${assessment.atrMoveSinceGeneration?.toFixed(2) ?? '?'})`)

      if (!isDryRun) {
        await db
          .from('recommendation_versions')
          .update({
            recommendation_validity_status: newStatus,
            requires_refresh: assessment.requiresRefresh,
          })
          .eq('recommendation_version_id', rec.recommendation_version_id)

        // Create notification with routing and SLA (per spec sheet 29)
        if (['STALE_PRICE', 'ZONE_CHANGED', 'DO_NOT_USE_RECALCULATE', 'ENTRY_ALREADY_PASSED'].includes(newStatus)) {
          const severity = newStatus === 'DO_NOT_USE_RECALCULATE' ? 'CRITICAL' : 'WARNING'
          const slaMins = SLA_MINUTES[severity] ?? 240
          const sla_due_at = new Date(Date.now() + slaMins * 60 * 1000).toISOString()

          await db.from('notifications').insert({
            notification_type: 'STALE_RECOMMENDATION',
            severity,
            recipient_role: severity === 'CRITICAL' ? 'ADMIN' : 'MANAGER',
            title: `${market.symbol} recommendation ${newStatus.toLowerCase().replace(/_/g, ' ')}`,
            message: assessment.volatilityWarning || `${market.symbol} recommendation requires attention.`,
            related_table: 'recommendation_versions',
            related_id: rec.recommendation_version_id,
            notification_status: 'OPEN',
            sla_due_at,
          })
        }
      }
    } else {
      console.log(`  ${market.symbol}: ${oldStatus} (unchanged, atrMove=${assessment.atrMoveSinceGeneration?.toFixed(2) ?? '?'})`)
    }

    switch (newStatus) {
      case 'VALID': summary.valid++; break
      case 'CAUTION_VOLATILITY': summary.caution++; break
      case 'STALE_PRICE': summary.stale++; break
      case 'ZONE_CHANGED': summary.zoneChanged++; break
      case 'DO_NOT_USE_RECALCULATE': summary.doNotUse++; break
    }

    // Rate limit Finnhub
    await new Promise(r => setTimeout(r, 100))
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Valid:          ${summary.valid}`)
  console.log(`Caution:        ${summary.caution}`)
  console.log(`Stale price:    ${summary.stale}`)
  console.log(`Zone changed:   ${summary.zoneChanged}`)
  console.log(`Do not use:     ${summary.doNotUse}`)
  console.log(`Errors:         ${summary.errors}`)
  if (isDryRun) console.log('\nDRY RUN -- nothing written.')
}

const thisFilePath = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(thisFilePath)
if (invokedDirectly) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1) })
}
