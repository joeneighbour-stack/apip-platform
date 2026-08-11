// ============================================================================
// AnalystAtrProfileService
// ============================================================================
// Single-lookup accessor for analyst_atr_profiles (migrations/046). Provided
// for direct/ad hoc use and testing; the production engine session
// (runEngineSession.ts) does NOT call this per-market -- it preloads every
// row once into a Map and looks up from that instead, to avoid one DB round
// trip per market per session (the same "preload once" pattern already used
// there for analyst_profiles).
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AtrProfile } from './entryOptimizerService.js';

export async function getAnalystAtrProfile(
  analystId: string,
  direction: string,
  zone: string,
  db: SupabaseClient,
): Promise<AtrProfile | null> {
  const { data } = await db
    .from('analyst_atr_profiles')
    .select('*')
    .eq('analyst_id', analystId)
    .eq('direction', direction)
    .eq('zone', zone)
    .maybeSingle()

  if (!data) return null

  return {
    stopAtrQ25: Number((data as any).stop_atr_q25),
    stopAtrMedian: Number((data as any).stop_atr_median),
    stopAtrQ75: Number((data as any).stop_atr_q75),
    targetAtrQ25: Number((data as any).target_atr_q25),
    targetAtrMedian: Number((data as any).target_atr_median),
    targetAtrQ75: Number((data as any).target_atr_q75),
  }
}

// Same shape the preloaded map in runEngineSession.ts builds -- exported so
// that file (and any other caller) can key/parse consistently rather than
// re-deriving the "analystId:direction:zone" convention independently.
export function atrProfileMapKey(analystId: string, direction: string, zone: string): string {
  return `${analystId}:${direction}:${zone}`
}
