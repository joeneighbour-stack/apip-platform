'use client'
import { useState, useTransition } from 'react'
import { getCoverageHoursForMonth, type CoverageHoursResult } from '@/app/actions/coverageHours'
import { DYNAMIC_ALLOCATION_START } from '@/lib/hoursTracker'

interface Props {
  initialYear: number
  initialMonth: number // 1-indexed
  initialData: CoverageHoursResult
}

// Monthly Coverage Hours -- server-rendered for the current month (initialData),
// with a client-side prev/next month selector that re-fetches via the same
// getCoverageHoursForMonth() server action used for the initial render.
export function MonthlyCoverageHours({ initialYear, initialMonth, initialData }: Props) {
  const now = new Date()
  const [viewMonth, setViewMonth] = useState({ year: initialYear, month: initialMonth })
  const [data, setData] = useState<CoverageHoursResult>(initialData)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Can't go back before DYNAMIC_ALLOCATION_START's own month -- there's no
  // publication data before dynamic allocation went live.
  const canGoPrev = new Date(viewMonth.year, viewMonth.month - 2, 1).toISOString().slice(0, 10) >= DYNAMIC_ALLOCATION_START
  // Can't go past the current calendar month.
  const canGoNext = viewMonth.year < now.getFullYear() || viewMonth.month < now.getMonth() + 1

  function changeMonth(delta: number) {
    let { year, month } = viewMonth
    month += delta
    if (month < 1) { month = 12; year -= 1 }
    if (month > 12) { month = 1; year += 1 }
    setViewMonth({ year, month })
    startTransition(async () => {
      const result = await getCoverageHoursForMonth(year, month)
      if (result.success) {
        setData(result.data)
        setError(null)
      } else {
        setError(result.error)
      }
    })
  }

  const monthLabel = new Date(viewMonth.year, viewMonth.month - 1, 1)
    .toLocaleString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Monthly Coverage Hours</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            disabled={!canGoPrev || isPending}
            className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            aria-label="Previous month"
          >
            &larr;
          </button>
          <span className="text-xs text-muted-foreground min-w-[8rem] text-center">
            {isPending ? 'Loading…' : monthLabel}
          </span>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            disabled={!canGoNext || isPending}
            className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            aria-label="Next month"
          >
            &rarr;
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 pt-3 pb-2 text-xs font-medium text-muted-foreground">Analyst</th>
              <th className="px-4 pt-3 pb-2 text-xs font-medium text-muted-foreground text-right">Markets</th>
              <th className="px-4 pt-3 pb-2 text-xs font-medium text-muted-foreground text-right">Hours</th>
            </tr>
          </thead>
          <tbody>
            {data.analystHours.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No coverage recorded for {monthLabel}.
                </td>
              </tr>
            ) : data.analystHours.map(a => (
              <tr key={a.analyst_id} className="border-b border-border/50">
                <td className="px-4 py-2">{a.display_name}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{a.markets}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{a.hoursDisplay}</td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="px-4 pt-3 pb-3">Total</td>
              <td className="px-4 pt-3 pb-3 text-right tabular-nums text-muted-foreground">{data.totalMarkets}</td>
              <td className="px-4 pt-3 pb-3 text-right tabular-nums">{data.totalHoursDisplay}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
