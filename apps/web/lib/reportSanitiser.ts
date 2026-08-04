// Anonymisation boundary + compliance gate for generated reports. This is intentionally
// two layers of defence:
//  1. Structural: ReportData / ReportSafeTrade / ReportAttributionDimension simply have
//     no field capable of holding an analyst identity, and no code path builds one --
//     see components/analytics/report/*.
//  2. Runtime: sanitiseReport() re-scans the assembled payload for banned key names and
//     confirms every mandatory compliance item is present, and fails generation rather
//     than rendering a non-compliant report if anything is missing.
import type {
  PerformanceSummary, ComparisonResult, CumulativePoint, DrawdownPoint,
  RollingRow, MonthlyMatrixRow, AttributionRow, DistributionBucket,
} from './metrics'

export type ReportAttributionDimension = 'asset_class' | 'market' | 'strategy'

export interface ReportSafeUniverse {
  title: string
  subtitle: string
  periodLabel: string
  filterSummary: string
  tradeCount: number
  generatedAt: string
  dataThrough: string
}

export interface ReportSections {
  executiveSummary: boolean
  cumulativePerformance: boolean
  drawdown: boolean
  rollingPerformance: boolean
  monthlyPerformance: boolean
  attribution: boolean
  contribution: boolean
  tradeStatistics: boolean
  bestWorst: boolean
  methodology: boolean
}

export interface ReportSafeTrade {
  date: string
  symbol: string
  direction: 'BUY' | 'SELL'
  resultR: number
}

export interface ReportTradeStatistics {
  winRate: number | null
  lossRate: number | null
  avgWinner: number | null
  avgLoser: number | null
  avgR: number | null
  profitFactor: number | null
  triggerRate: number | null
  generated: number
  triggered: number
  expired: number
  avgDurationHours: number | null
}

export interface ReportCompliance {
  logoPresent: boolean
  companyName: string
  fcaStatement: string
  disclaimer: string[]
  pastPerformanceWarning: string
}

export interface ReportData {
  universe: ReportSafeUniverse
  sections: ReportSections
  attributionDimensions: ReportAttributionDimension[]
  summary: PerformanceSummary
  comparison: ComparisonResult | null
  cumulative: CumulativePoint[]
  drawdown: DrawdownPoint[]
  rolling: RollingRow[]
  monthly: MonthlyMatrixRow[]
  attribution: Partial<Record<ReportAttributionDimension, AttributionRow[]>>
  contribution: Partial<Record<ReportAttributionDimension, AttributionRow[]>>
  tradeStats: ReportTradeStatistics
  distribution: DistributionBucket[]
  // null when automatically omitted by the anonymity safeguard (see distinctAnalystCount).
  // No individual "worst" trades -- the worst a single trade can be is -1R (capped), so
  // every stop-out ranks equally; bestMarkets/worstMarkets below carries that signal
  // instead, and isn't subject to the same trade-level anonymity gate (aggregated,
  // min-sample-size rows carry materially less re-identification risk than a specific
  // trade's date+market+direction).
  bestWorst: { best: ReportSafeTrade[] } | null
  bestMarkets: AttributionRow[]
  worstMarkets: AttributionRow[]
  distinctAnalystCount: number
  compliance: ReportCompliance
}

const BANNED_KEYS = ['analyst_id', 'analystId', 'analyst_name', 'analystName', 'display_name', 'displayName', 'analyst', 'analysts']

function scanForBannedKeys(value: unknown, path = 'report'): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap((item, i) => scanForBannedKeys(item, `${path}[${i}]`))
  if (typeof value === 'object') {
    const found: string[] = []
    for (const [key, v] of Object.entries(value)) {
      if (BANNED_KEYS.includes(key)) found.push(`${path}.${key}`)
      found.push(...scanForBannedKeys(v, `${path}.${key}`))
    }
    return found
  }
  return []
}

const UNSUPPORTED_FUND_TERMS = [
  'nav', 'net asset value', 'fund return', 'investment portfolio',
  'client return', 'guaranteed return', 'expected future return',
]

export interface SanitiseResult {
  ok: boolean
  errors: string[]
}

export function sanitiseReport(report: ReportData): SanitiseResult {
  const errors: string[] = []

  const bannedFields = scanForBannedKeys(report)
  if (bannedFields.length > 0) errors.push(`Analyst-identifying field(s) present: ${bannedFields.join(', ')}`)

  if (!report.compliance.logoPresent) errors.push('Acuity logo mark is missing')
  if (!report.compliance.companyName?.trim()) errors.push('Company identity is missing')
  if (!report.compliance.fcaStatement?.includes('Financial Conduct Authority')) errors.push('FCA regulatory statement is missing')
  if (!report.compliance.disclaimer || report.compliance.disclaimer.length === 0) errors.push('Mandatory disclaimer is missing')
  if (!report.compliance.disclaimer?.some(p => p.toLowerCase().includes('sanctions'))) errors.push('Sanctions statement is missing')
  if (!report.compliance.pastPerformanceWarning?.toLowerCase().includes('past performance')) errors.push('Past-performance warning is missing')
  if (!report.universe.periodLabel?.trim()) errors.push('Reporting period is missing')
  if (!report.universe.dataThrough?.trim()) errors.push('Data-through date is missing')
  if (!report.universe.filterSummary?.trim() && !report.universe.subtitle?.trim()) errors.push('Report universe description is missing')

  const haystack = `${report.universe.title} ${report.universe.subtitle}`.toLowerCase()
  const fundTerm = UNSUPPORTED_FUND_TERMS.find(term => haystack.includes(term))
  if (fundTerm) errors.push(`Unsupported fund/NAV terminology detected: "${fundTerm}"`)

  return { ok: errors.length === 0, errors }
}

// Anonymity safeguard beyond the literal spec checklist: a narrow filter (e.g. one
// niche market) can make a single analyst inferable even with no name printed. Reduces
// but cannot mathematically guarantee zero re-identification risk for pathologically
// narrow filters -- documented, not a cryptographic guarantee.
export const MIN_ANALYSTS_FOR_TRADE_LEVEL_SECTIONS = 3
export const MIN_TRADES_PER_ATTRIBUTION_ROW = 5
