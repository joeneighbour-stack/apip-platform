// Shared formatting so decimal precision/sign conventions stay identical across every
// KPI tile, chart, table, and the printed report -- not reimplemented per component.

export function formatR(value: number | null): string {
  if (value === null) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}R`
}

export function formatPercent(value: number | null): string {
  if (value === null) return '—'
  return `${Math.round(value * 100)}%`
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateShort(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function positivityClass(value: number | null): string {
  if (value === null) return 'text-muted-foreground'
  return value >= 0 ? 'text-green-700' : 'text-red-700'
}
