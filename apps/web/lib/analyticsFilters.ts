import type { DatePresetKey, DateRange } from './dateRanges'
import type { MetricsTrade, MetricsPublication } from './metrics'
import { formatDate } from './format'

export type ProductStrategy = 'ALL' | 'HUMAN_ANALYST' | 'PATTERN' | 'AI'
export type TriggerStatusFilter = 'ALL' | 'TRIGGERED' | 'NOT_TRIGGERED'

export const PRODUCT_OPTIONS: { key: ProductStrategy; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'HUMAN_ANALYST', label: 'Human Analyst' },
  { key: 'PATTERN', label: 'Pattern' },
  { key: 'AI', label: 'AI' },
]

export interface AnalyticsFilterState {
  datePreset: DatePresetKey
  customStart: string | null
  customEnd: string | null
  product: ProductStrategy
  analystIds: string[]
  assetClasses: string[]
  marketIds: string[]
  directions: string[]
  sessions: string[]
  triggerStatus: TriggerStatusFilter
}

export const DEFAULT_FILTERS: AnalyticsFilterState = {
  datePreset: 'YTD',
  customStart: null,
  customEnd: null,
  product: 'ALL',
  analystIds: [],
  assetClasses: [],
  marketIds: [],
  directions: [],
  sessions: [],
  triggerStatus: 'ALL',
}

export function filtersToSearchParams(filters: AnalyticsFilterState): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.datePreset !== DEFAULT_FILTERS.datePreset) params.set('date', filters.datePreset)
  if (filters.customStart) params.set('from', filters.customStart)
  if (filters.customEnd) params.set('to', filters.customEnd)
  if (filters.product !== 'ALL') params.set('product', filters.product)
  if (filters.analystIds.length) params.set('analysts', filters.analystIds.join(','))
  if (filters.assetClasses.length) params.set('assetClasses', filters.assetClasses.join(','))
  if (filters.marketIds.length) params.set('markets', filters.marketIds.join(','))
  if (filters.directions.length) params.set('directions', filters.directions.join(','))
  if (filters.sessions.length) params.set('sessions', filters.sessions.join(','))
  if (filters.triggerStatus !== 'ALL') params.set('trigger', filters.triggerStatus)
  return params
}

export function filtersFromSearchParams(params: URLSearchParams): AnalyticsFilterState {
  return {
    datePreset: (params.get('date') as DatePresetKey) ?? DEFAULT_FILTERS.datePreset,
    customStart: params.get('from'),
    customEnd: params.get('to'),
    product: (params.get('product') as ProductStrategy) ?? 'ALL',
    analystIds: params.get('analysts')?.split(',').filter(Boolean) ?? [],
    assetClasses: params.get('assetClasses')?.split(',').filter(Boolean) ?? [],
    marketIds: params.get('markets')?.split(',').filter(Boolean) ?? [],
    directions: params.get('directions')?.split(',').filter(Boolean) ?? [],
    sessions: params.get('sessions')?.split(',').filter(Boolean) ?? [],
    triggerStatus: (params.get('trigger') as TriggerStatusFilter) ?? 'ALL',
  }
}

export function hasActiveFilters(filters: AnalyticsFilterState): boolean {
  return filters.datePreset !== DEFAULT_FILTERS.datePreset || filters.product !== 'ALL' ||
    filters.analystIds.length > 0 || filters.assetClasses.length > 0 || filters.marketIds.length > 0 ||
    filters.directions.length > 0 || filters.sessions.length > 0 || filters.triggerStatus !== 'ALL'
}

// "Human Analyst" is the only product bucket with real data today (source_system on
// actual_trades is ingestion source, not a strategy classification -- see plan).
// Pattern/AI filters intentionally yield zero rows rather than fabricating data.
export function filterTrades(trades: MetricsTrade[], filters: AnalyticsFilterState, range: DateRange): MetricsTrade[] {
  return trades.filter(t => {
    const d = t.published_at.slice(0, 10)
    if (d < range.start || d > range.end) return false
    if (filters.product === 'HUMAN_ANALYST' && !['ACUITY_PERFORMANCE_API', 'MANUAL_BACKFILL'].includes(t.source_system)) return false
    if (filters.product === 'PATTERN' || filters.product === 'AI') return false
    if (filters.analystIds.length > 0 && !filters.analystIds.includes(t.analyst_id)) return false
    if (filters.assetClasses.length > 0 && !filters.assetClasses.includes(t.asset_class)) return false
    if (filters.marketIds.length > 0 && !filters.marketIds.includes(t.market_id)) return false
    if (filters.directions.length > 0 && !filters.directions.includes(t.direction)) return false
    if (filters.sessions.length > 0 && !filters.sessions.includes(t.session ?? '')) return false
    if (filters.triggerStatus === 'TRIGGERED' && !t.triggered) return false
    if (filters.triggerStatus === 'NOT_TRIGGERED' && t.triggered) return false
    return true
  })
}

// analyst_publications has no embedded asset_class -- resolved via a market_id lookup.
export function filterPublications(
  pubs: MetricsPublication[], filters: AnalyticsFilterState, range: DateRange,
  assetClassByMarketId: Map<string, string>
): MetricsPublication[] {
  return pubs.filter(p => {
    const d = p.published_at.slice(0, 10)
    if (d < range.start || d > range.end) return false
    if (filters.product === 'PATTERN' || filters.product === 'AI') return false
    if (filters.analystIds.length > 0 && !filters.analystIds.includes(p.analyst_id)) return false
    if (filters.marketIds.length > 0 && (!p.market_id || !filters.marketIds.includes(p.market_id))) return false
    if (filters.assetClasses.length > 0) {
      const ac = p.market_id ? assetClassByMarketId.get(p.market_id) : undefined
      if (!ac || !filters.assetClasses.includes(ac)) return false
    }
    return true
  })
}

export interface UniverseDescription {
  title: string
  periodLabel: string
  segments: string[]
  analystSegment: string | null
}

function productLabel(product: ProductStrategy): string {
  return PRODUCT_OPTIONS.find(p => p.key === product)?.label ?? 'All'
}

export function describeUniverse(
  filters: AnalyticsFilterState, range: DateRange,
  markets: { market_id: string; symbol: string }[], analysts: { analyst_id: string; display_name: string }[]
): UniverseDescription {
  const title = `${filters.product === 'ALL' ? 'All Product' : productLabel(filters.product)} Performance`
  const periodLabel = `${formatDate(range.start)} – ${formatDate(range.end)}`

  const segments: string[] = []
  if (filters.assetClasses.length > 0) segments.push(filters.assetClasses.join(' + '))
  if (filters.marketIds.length > 0) {
    const symbols = filters.marketIds
      .map(id => markets.find(m => m.market_id === id)?.symbol)
      .filter((s): s is string => Boolean(s))
    if (symbols.length > 0) segments.push(symbols.join(', '))
  }

  let analystSegment: string | null = 'All Analysts'
  if (filters.analystIds.length === 1) {
    analystSegment = analysts.find(a => a.analyst_id === filters.analystIds[0])?.display_name ?? '1 Analyst Selected'
  } else if (filters.analystIds.length > 1) {
    analystSegment = `${filters.analystIds.length} Analysts Selected`
  }

  return { title, periodLabel, segments, analystSegment }
}
