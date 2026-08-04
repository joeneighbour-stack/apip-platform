// Date-range preset resolution and comparison-period logic, shared by the Analytics
// KPI strip and report builder. Comparison methodology must never be mixed silently --
// every comparison carries an explicit `label` describing which rule was applied.

export type DatePresetKey = '30D' | '90D' | '6M' | 'YTD' | '1Y' | 'SINCE_INCEPTION' | 'CUSTOM'

export interface DateRange {
  start: string
  end: string
}

// Matches the existing "beginning of time" convention already used by
// /api/analytics/kpis (from=2017-01-01 default).
export const SINCE_INCEPTION_FLOOR = '2017-01-01'

export const DATE_PRESET_OPTIONS: { key: DatePresetKey; label: string }[] = [
  { key: '30D', label: '30 Days' },
  { key: '90D', label: '90 Days' },
  { key: '6M', label: '6 Months' },
  { key: 'YTD', label: 'YTD' },
  { key: '1Y', label: '1 Year' },
  { key: 'SINCE_INCEPTION', label: 'Since Inception' },
  { key: 'CUSTOM', label: 'Custom Range' },
]

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function resolveDateRange(preset: DatePresetKey, customStart: string | undefined, customEnd: string | undefined, now = new Date()): DateRange {
  const end = now.toISOString().slice(0, 10)
  switch (preset) {
    case '30D': return { start: daysAgo(now, 30), end }
    case '90D': return { start: daysAgo(now, 90), end }
    case '6M': return { start: daysAgo(now, 182), end }
    case '1Y': return { start: daysAgo(now, 365), end }
    case 'YTD': return { start: `${now.getUTCFullYear()}-01-01`, end }
    case 'SINCE_INCEPTION': return { start: SINCE_INCEPTION_FLOOR, end }
    case 'CUSTOM': return { start: customStart ?? SINCE_INCEPTION_FLOOR, end: customEnd ?? end }
  }
}

export interface ComparisonRange {
  range: DateRange | null
  label: string
}

// YTD compares to the same point in the previous calendar year; every other preset
// (including custom) compares to the immediately preceding period of equal length.
// Since Inception has no meaningful "previous period" and is explicitly unsupported.
export function resolveComparisonRange(preset: DatePresetKey, range: DateRange): ComparisonRange {
  if (preset === 'SINCE_INCEPTION') {
    return { range: null, label: 'No comparison for Since Inception' }
  }
  if (preset === 'YTD') {
    const endDate = new Date(range.end + 'T00:00:00Z')
    const prevYear = endDate.getUTCFullYear() - 1
    const prevEnd = new Date(Date.UTC(prevYear, endDate.getUTCMonth(), endDate.getUTCDate()))
    return {
      range: { start: `${prevYear}-01-01`, end: prevEnd.toISOString().slice(0, 10) },
      label: 'vs same point previous year',
    }
  }
  const startDate = new Date(range.start + 'T00:00:00Z')
  const endDate = new Date(range.end + 'T00:00:00Z')
  const lengthMs = endDate.getTime() - startDate.getTime()
  const prevEnd = new Date(startDate.getTime() - 24 * 60 * 60 * 1000)
  const prevStart = new Date(prevEnd.getTime() - lengthMs)
  return {
    range: { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) },
    label: 'vs previous period',
  }
}
