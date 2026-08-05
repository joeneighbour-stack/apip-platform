'use client'
import { useState, useMemo } from 'react'

interface BreakdownRow {
  date: string
  symbol: string
  direction: string
  shadowStatus: string
  shadowR: number | null
  analystId: string
  hasPublication: boolean
  analystTriggered: boolean | null
  analystR: number | null
}
interface AnalystOption {
  analyst_id: string
  display_name: string
}
interface Props {
  rows: BreakdownRow[]
  analysts: AnalystOption[]
}

const STATUS_STYLES: Record<string, string> = {
  TARGET_HIT:    'bg-green-100 text-green-800',
  STOP_HIT:      'bg-red-100 text-red-800',
  EXPIRY:        'bg-muted text-muted-foreground',
  TRIGGERED:     'bg-blue-50 text-blue-700',
  NOT_TRIGGERED: 'bg-slate-100 text-slate-600',
}

const SHADOW_TRIGGERED_STATUSES = ['TARGET_HIT', 'STOP_HIT', 'TRIGGERED', 'CLOSED_PROFIT', 'CLOSED_LOSS']

function fmtR(r: number): string {
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}R`
}

function todayIso() { return new Date().toISOString().slice(0, 10) }
function daysAgoIso(n: number) { return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) }

export function AnalystShadowBreakdown({ rows, analysts }: Props) {
  const [fromDate, setFromDate] = useState(daysAgoIso(30))
  const [toDate, setToDate] = useState(todayIso())
  const [bothSidesOnly, setBothSidesOnly] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (r.date < fromDate || r.date > toDate) return false
      if (bothSidesOnly && (r.shadowR === null || r.analystR === null)) return false
      return true
    })
  }, [rows, fromDate, toDate, bothSidesOnly])

  const byAnalyst = useMemo(() => {
    const map = new Map<string, BreakdownRow[]>()
    for (const a of analysts) map.set(a.analyst_id, [])
    for (const r of filteredRows) {
      if (!map.has(r.analystId)) map.set(r.analystId, [])
      map.get(r.analystId)!.push(r)
    }
    return map
  }, [filteredRows, analysts])

  function toggle(analystId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(analystId)) next.delete(analystId)
      else next.add(analystId)
      return next
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-medium">Analyst vs Shadow Breakdown</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="date" value={fromDate} max={toDate}
              onChange={e => setFromDate(e.target.value)}
              className="px-2 py-1 rounded-md border border-border bg-background text-xs" />
            <span>to</span>
            <input type="date" value={toDate} min={fromDate} max={todayIso()}
              onChange={e => setToDate(e.target.value)}
              className="px-2 py-1 rounded-md border border-border bg-background text-xs" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={bothSidesOnly} onChange={e => setBothSidesOnly(e.target.checked)} />
            Both sides only
          </label>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Per-analyst comparison: for each shadow setup, the analyst&apos;s own publication for the same market, direction and date, if any.
      </p>

      <div className="space-y-2">
        {analysts.map(analyst => {
          const analystRows = byAnalyst.get(analyst.analyst_id) ?? []
          const isOpen = expanded.has(analyst.analyst_id)

          const shadowTriggered = analystRows.filter(r => SHADOW_TRIGGERED_STATUSES.includes(r.shadowStatus))
          const shadowWins = analystRows.filter(r => r.shadowR !== null && r.shadowR > 0)
          const shadowWinRate = shadowTriggered.length > 0 ? shadowWins.length / shadowTriggered.length : null
          const shadowTotalR = analystRows.reduce((s, r) => s + (r.shadowR ?? 0), 0)

          const analystTriggeredRows = analystRows.filter(r => r.analystTriggered === true)
          const analystWins = analystRows.filter(r => r.analystR !== null && r.analystR > 0)
          const analystWinRate = analystTriggeredRows.length > 0 ? analystWins.length / analystTriggeredRows.length : null
          const analystTotalR = analystRows.reduce((s, r) => s + (r.analystR ?? 0), 0)

          const edge = shadowTotalR - analystTotalR

          return (
            <div key={analyst.analyst_id} className="rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => toggle(analyst.analyst_id)}
                className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/30 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs text-muted-foreground transition-transform inline-block ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                  <span className="text-sm font-medium">{analyst.display_name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap justify-end">
                  <span>Markets compared: <span className="font-medium text-foreground">{analystRows.length}</span></span>
                  <span>Win rate &mdash; shadow <span className="font-medium text-foreground">{shadowWinRate !== null ? `${Math.round(shadowWinRate * 100)}%` : '—'}</span> vs analyst <span className="font-medium text-foreground">{analystWinRate !== null ? `${Math.round(analystWinRate * 100)}%` : '—'}</span></span>
                  <span>Total R &mdash; shadow <span className={`font-medium ${shadowTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmtR(shadowTotalR)}</span> vs analyst <span className={`font-medium ${analystTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmtR(analystTotalR)}</span></span>
                  <span>Edge <span className={`font-medium ${edge >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmtR(edge)}</span></span>
                </div>
              </button>

              {isOpen && (
                <div className="overflow-x-auto border-t border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        {['Date', 'Market', 'Direction', 'Shadow Result', 'Analyst Result', 'Edge'].map(h => (
                          <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {analystRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">
                            No comparisons for the selected period.
                          </td>
                        </tr>
                      ) : [...analystRows].sort((a, b) => b.date.localeCompare(a.date)).map((r, i) => {
                        const edgeR = r.shadowR !== null && r.analystR !== null ? r.shadowR - r.analystR : null
                        return (
                          <tr key={`${r.date}-${r.symbol}-${r.direction}-${i}`} className="hover:bg-muted/30">
                            <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{r.date}</td>
                            <td className="px-3 py-2 text-xs font-medium whitespace-nowrap">{r.symbol}</td>
                            <td className="px-3 py-2">
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                                r.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`}>{r.direction}</span>
                            </td>
                            <td className="px-3 py-2 text-xs whitespace-nowrap">
                              <span className={`font-medium px-2 py-0.5 rounded-full ${
                                STATUS_STYLES[r.shadowStatus] ?? 'bg-muted text-muted-foreground'
                              }`}>
                                {r.shadowStatus.replace(/_/g, ' ')}
                              </span>
                              {r.shadowR !== null && (
                                <span className={`ml-1.5 tabular-nums font-medium ${r.shadowR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                  {fmtR(r.shadowR)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs whitespace-nowrap">
                              {!r.hasPublication ? (
                                <span className="text-muted-foreground">No publication</span>
                              ) : r.analystTriggered === false ? (
                                <span className="text-muted-foreground">Not Triggered</span>
                              ) : r.analystR !== null ? (
                                <span className={`font-medium tabular-nums ${r.analystR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                  Triggered ({fmtR(r.analystR)})
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Triggered</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs tabular-nums font-medium">
                              {edgeR !== null ? (
                                <span className={edgeR >= 0 ? 'text-green-700' : 'text-red-700'}>{fmtR(edgeR)}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
