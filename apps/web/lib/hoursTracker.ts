// Monthly coverage-hours tracker for analyst_publications. Each
// ACUITY_PERFORMANCE_API publication represents one 15-minute market coverage
// slot, tracked from DYNAMIC_ALLOCATION_START (the dynamic-allocation go-live
// date) onward -- there is no meaningful publication-based coverage data
// before that date.

export const DYNAMIC_ALLOCATION_START = '2026-09-01'

export function calcHours(publicationCount: number): { markets: number; hours: number; minutes: number; display: string } {
  const totalMinutes = publicationCount * 15
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const display = hours > 0
    ? `${hours}h ${minutes > 0 ? `${minutes}m` : ''}`.trim()
    : `${minutes}m`
  return { markets: publicationCount, hours, minutes, display }
}

// year is a plain 4-digit year, month is 1-indexed (1 = January). Returns
// YYYY-MM-DD date-only strings (no time component) -- callers append a time
// suffix themselves when comparing against a timestamptz column, e.g.
// `.lte('published_at', end + 'T23:59:59Z')`.
export function getMonthRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  // Clamp start to DYNAMIC_ALLOCATION_START -- a month straddling go-live
  // (or entirely before it) should never report data from before the
  // dynamic-allocation system existed.
  return {
    start: start < DYNAMIC_ALLOCATION_START ? DYNAMIC_ALLOCATION_START : start,
    end,
  }
}
