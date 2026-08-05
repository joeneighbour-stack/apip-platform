'use client'
import { useState, useMemo } from 'react'

interface BreakdownRow {
  analystId: string
  date: string
  symbol: string
  analystDirection: string
  analystTriggered: boolean
  analystR: number | null
  shadowDirection: string | null
  shadowStatus: string
  shadowR: number | null
}
interface AnalystOption {
  analyst_id: string
  display_name: string
}
interface Props {
  rows: BreakdownRow[]
  analysts: AnalystOption[]
}

const SHADOW_TRIGGERED_STATUSES = ['TARGET_HIT', 'STOP_HIT', 'TRIGGERED', 'CLOSED_PROFIT', 'CLOSED_LOSS']

function fmtR(r: number): string {
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}R`
}

function rClass(r: number): string {
  return r >= 0 ? 'text-green-700' : 'text-red-700'
}

// "45 of 122" hides how good/bad that ratio actually is at a glance -- the percentage is the
// number that matters, with the raw count kept alongside for anyone who wants to verify it.
function fmtPctCount(count: number, total: number): string {
  if (total === 0) return '—'
  return `${Math.round(count / total * 100)}% (${count}/${total})`
}

function fmtPct(count: number, total: number): string {
  if (total === 0) return '—'
  return `${Math.round(count / total * 100)}%`
}

// Resolved (both sides have a result) comparisons are the ones worth looking at first --
// rows where only one side triggered, or neither did, carry no Edge and are pushed down.
function resolutionTier(r: BreakdownRow): number {
  const hasAnalyst = r.analystR !== null
  const hasShadow = r.shadowR !== null
  if (hasAnalyst && hasShadow) return 2
  if (hasAnalyst || hasShadow) return 1
  return 0
}

function DirectionBadge({ direction }: { direction: string | null }) {
  if (!direction) return <span className="text-muted-foreground">—</span>
  return (
    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
      direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
    }`}>{direction}</span>
  )
}

function Chip({ label, value, valueClassName }: { label: string; value: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-muted/30 text-xs whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${valueClassName ?? ''}`}>{value}</span>
    </div>
  )
}

function StatBox({ label, value, valueClassName, sublabel }: { label: string; value: React.ReactNode; valueClassName?: string; sublabel?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold mt-1 tabular-nums ${valueClassName ?? ''}`}>{value}</p>
      {sublabel && <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>}
    </div>
  )
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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center gap-1.5">
            <input type="date" value={fromDate} max={toDate}
              onChange={e => setFromDate(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-background" />
            <span className="text-xs text-muted-foreground">to</span>
            <input type="date" value={toDate} min={fromDate} max={todayIso()}
              onChange={e => setToDate(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-background" />
          </div>
          <button
            onClick={() => setBothSidesOnly(v => !v)}
            className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
              bothSidesOnly
                ? 'bg-foreground text-background border-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            Both sides only
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Per-analyst comparison, scoped to the analyst&apos;s own coverage: markets the analyst published on where
        the shadow system also generated a setup for the same market and date. Direction is not part of the
        match &mdash; the two sides can disagree on the trade.
      </p>

      <div className="space-y-1 pt-1">
        <h3 className="text-sm font-semibold">Analyst vs Shadow &mdash; Head to Head</h3>
        <p className="text-xs text-muted-foreground">
          How each analyst performs on markets they covered, compared directly against the shadow system&apos;s
          setup for the same market on the same day.
        </p>
      </div>

      <div className="space-y-2">
        {analysts.map(analyst => {
          const analystRows = byAnalyst.get(analyst.analyst_id) ?? []
          const isOpen = expanded.has(analyst.analyst_id)

          const analystTriggeredRows = analystRows.filter(r => r.analystTriggered)
          const shadowTriggeredRows = analystRows.filter(r => SHADOW_TRIGGERED_STATUSES.includes(r.shadowStatus))

          const analystWins = analystTriggeredRows.filter(r => r.analystR !== null && r.analystR > 0)
          const analystWinRate = analystTriggeredRows.length > 0 ? analystWins.length / analystTriggeredRows.length : null
          const analystTotalR = analystRows.reduce((s, r) => s + (r.analystR ?? 0), 0)

          const shadowWins = shadowTriggeredRows.filter(r => r.shadowR !== null && r.shadowR > 0)
          const shadowWinRate = shadowTriggeredRows.length > 0 ? shadowWins.length / shadowTriggeredRows.length : null
          const shadowTotalR = analystRows.reduce((s, r) => s + (r.shadowR ?? 0), 0)

          const edge = analystTotalR - shadowTotalR

          const analystTriggerPct = fmtPct(analystTriggeredRows.length, analystRows.length)
          const shadowTriggerPct = fmtPct(shadowTriggeredRows.length, analystRows.length)

          return (
            <div key={analyst.analyst_id} className="rounded-lg border border-border bg-card overflow-hidden">
              <button
                onClick={() => toggle(analyst.analyst_id)}
                className="w-full flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs text-muted-foreground transition-transform inline-block ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                  <span className="text-sm font-bold">{analyst.display_name}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <Chip label="Matched" value={analystRows.length} />
                  <Chip label="Trigger%" value={`${analystTriggerPct} / ${shadowTriggerPct}`} />
                  <Chip label="Analyst R" value={fmtR(analystTotalR)} valueClassName={rClass(analystTotalR)} />
                  <Chip label="Shadow R" value={fmtR(shadowTotalR)} valueClassName={rClass(shadowTotalR)} />
                  <Chip label="Analyst Edge" value={fmtR(edge)} valueClassName={rClass(edge)} />
                  <Chip
                    label="Win Rate:"
                    value={
                      <>
                        <span className="text-muted-foreground font-normal">Analyst</span>{' '}
                        {analystWinRate !== null ? `${Math.round(analystWinRate * 100)}%` : '—'}
                        <span className="text-muted-foreground font-normal"> / </span>
                        <span className="text-muted-foreground font-normal">Shadow</span>{' '}
                        {shadowWinRate !== null ? `${Math.round(shadowWinRate * 100)}%` : '—'}
                      </>
                    }
                  />
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border p-4 space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <StatBox label="Matched Setups" value={analystRows.length} />
                    <StatBox label="Analyst Triggered" value={fmtPctCount(analystTriggeredRows.length, analystRows.length)} />
                    <StatBox label="Shadow Triggered" value={fmtPctCount(shadowTriggeredRows.length, analystRows.length)} />
                    <StatBox
                      label="Analyst Edge"
                      value={fmtR(edge)}
                      valueClassName={rClass(edge)}
                      sublabel="Analyst R minus Shadow R — positive means analyst outperformed shadow"
                    />
                  </div>

                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">—</span> = trade not yet resolved or did not trigger.
                    Edge is only shown when both sides have a result.
                  </p>

                  <div className="rounded-lg border border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          {['Date', 'Market', 'Analyst Dir', 'Analyst R', 'Shadow Dir', 'Shadow R'].map(h => (
                            <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                          ))}
                          <th
                            className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap"
                            title="Analyst R minus Shadow R — positive means analyst outperformed shadow"
                          >
                            Edge (+ = analyst wins)
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {analystRows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-6 text-center text-xs text-muted-foreground">
                              No matched setups for the selected period.
                            </td>
                          </tr>
                        ) : [...analystRows].sort((a, b) => {
                          const dateCompare = b.date.localeCompare(a.date)
                          if (dateCompare !== 0) return dateCompare
                          return resolutionTier(b) - resolutionTier(a)
                        }).map((r, i) => {
                          const edgeR = r.analystR !== null && r.shadowR !== null ? r.analystR - r.shadowR : null
                          return (
                            <tr key={`${r.date}-${r.symbol}-${i}`} className={`hover:bg-muted/30 ${i % 2 === 1 ? 'bg-muted/20' : ''}`}>
                              <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{r.date}</td>
                              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap">{r.symbol}</td>
                              <td className="px-3 py-2 text-xs whitespace-nowrap"><DirectionBadge direction={r.analystDirection} /></td>
                              <td className="px-3 py-2 text-xs tabular-nums font-medium whitespace-nowrap">
                                {r.analystR !== null ? <span className={rClass(r.analystR)}>{fmtR(r.analystR)}</span> : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-3 py-2 text-xs whitespace-nowrap"><DirectionBadge direction={r.shadowDirection} /></td>
                              <td className="px-3 py-2 text-xs tabular-nums font-medium whitespace-nowrap">
                                {r.shadowR !== null ? <span className={rClass(r.shadowR)}>{fmtR(r.shadowR)}</span> : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-3 py-2 text-xs tabular-nums font-medium whitespace-nowrap">
                                {edgeR !== null ? <span className={rClass(edgeR)}>{fmtR(edgeR)}</span> : <span className="text-muted-foreground">—</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
