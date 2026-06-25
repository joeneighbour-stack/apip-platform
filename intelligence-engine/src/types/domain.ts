// ============================================================================
// APIP Intelligence Engine -- shared domain types
// Source of truth: APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md, Sections 1.2-1.4
// ============================================================================
// These mirror the live Postgres enums exactly (001_schema.sql). Do not drift
// from the DB enum values -- if the schema changes, this file changes first,
// deliberately, not as an afterthought.

export const ATR_ZONES = [
  'TOO_DEEP', 'ZONE_1', 'ZONE_2', 'ZONE_3', 'ZONE_4', 'TOO_HIGH',
] as const;
export type AtrZone = (typeof ATR_ZONES)[number];

export const SESSION_TYPES = ['EUROPEAN', 'US', 'APAC', 'CRYPTO'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const DIRECTIONS = ['BUY', 'SELL'] as const;
export type Direction = (typeof DIRECTIONS)[number];

// ----------------------------------------------------------------------------
// Architecture V1.1 Section 1.1 / Amendment 7: implemented vs reserved states.
// RecommendationLifecycleService's return type must be narrowed to
// ImplementedValidityState, never the full 8-value DB enum -- this is what
// makes returning a reserved state a compile error, not just a documentation
// note someone could miss.
// ----------------------------------------------------------------------------

export const IMPLEMENTED_VALIDITY_STATES = [
  'VALID', 'ZONE_CHANGED', 'STALE_PRICE', 'DO_NOT_USE_RECALCULATE',
] as const;
export type ImplementedValidityState = (typeof IMPLEMENTED_VALIDITY_STATES)[number];

export const RESERVED_VALIDITY_STATES = [
  'CAUTION_VOLATILITY', 'ENTRY_ALREADY_PASSED', 'RECALCULATING', 'ARCHIVED',
] as const;
export type ReservedValidityState = (typeof RESERVED_VALIDITY_STATES)[number];

export type RecommendationValidityStatus = ImplementedValidityState | ReservedValidityState;

/**
 * Runtime backstop for the type-level guard above. If a future code path
 * constructs a validity status dynamically (not as a literal) and it turns
 * out to be a reserved state, this fails loudly in every environment rather
 * than silently persisting an unimplemented behaviour as if it were real.
 */
export function assertImplementedState(status: string): asserts status is ImplementedValidityState {
  if (!(IMPLEMENTED_VALIDITY_STATES as readonly string[]).includes(status)) {
    throw new Error(
      `RecommendationLifecycleService produced '${status}', which is a RESERVED schema ` +
      `capability, not an implemented one. This indicates either a bug or an undocumented ` +
      `behaviour change that needs its own architecture amendment (see ` +
      `APIP_INTELLIGENCE_ENGINE_ARCHITECTURE_V1.1.md Section 1.1 / Amendment 7).`
    );
  }
}

// ----------------------------------------------------------------------------
// Architecture V1.1 Section 1.2 / 1.3: notebook-to-DB naming translation.
// One function per translation, used at every boundary where a value crosses
// from computation into persistence or vice versa. Never inline these
// transforms at a call site -- this exact class of bug (silent mismatch
// between two equivalent-looking string formats) has cost real debugging
// time multiple times already in this project's ingestion phase.
// ----------------------------------------------------------------------------

const NOTEBOOK_ZONE_TO_DB: Record<string, AtrZone> = {
  'Too Deep': 'TOO_DEEP',
  'Zone 1': 'ZONE_1',
  'Zone 2': 'ZONE_2',
  'Zone 3': 'ZONE_3',
  'Zone 4': 'ZONE_4',
  'Too High': 'TOO_HIGH',
};

/** Converts a notebook-style zone string ('Zone 2') to the DB enum value ('ZONE_2'). */
export function toDbZone(notebookZone: string): AtrZone {
  const mapped = NOTEBOOK_ZONE_TO_DB[notebookZone];
  if (!mapped) {
    throw new Error(`toDbZone: unrecognised notebook zone value '${notebookZone}'. Expected one of: ${Object.keys(NOTEBOOK_ZONE_TO_DB).join(', ')}`);
  }
  return mapped;
}

const NOTEBOOK_SESSION_TO_DB: Record<string, SessionType> = {
  'Europe': 'EUROPEAN', // NOT a case change -- a different word. See Architecture V1.1 Section 1.3.
  'US': 'US',
  'APAC': 'APAC',
  'Crypto': 'CRYPTO',
};

/** Converts a notebook-style session string ('Europe') to the DB enum value ('EUROPEAN'). */
export function toDbSession(notebookSession: string): SessionType {
  const mapped = NOTEBOOK_SESSION_TO_DB[notebookSession];
  if (!mapped) {
    throw new Error(`toDbSession: unrecognised notebook session value '${notebookSession}'. Expected one of: ${Object.keys(NOTEBOOK_SESSION_TO_DB).join(', ')}`);
  }
  return mapped;
}
