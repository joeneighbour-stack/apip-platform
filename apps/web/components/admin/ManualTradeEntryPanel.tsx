'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Analyst {
  analyst_id: string
  display_name: string
  active: boolean
}
interface Market {
  market_id: string
  symbol: string
  asset_class: string
  active: boolean
}

interface Props {
  analysts: Analyst[]
  markets: Market[]
}

type Direction = 'BUY' | 'SELL'

const EMPTY_FORM = { analystId: '', marketId: '', direction: 'BUY' as Direction, date: '', entry: '', stop: '', target: '', exit: '' }

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function calcResultR(direction: Direction, entry: number, stop: number, exit: number): number {
  const r = direction === 'BUY' ? (exit - entry) / (entry - stop) : (entry - exit) / (stop - entry)
  return Math.round(r * 1000) / 1000
}

interface DuplicateRow { trade_id: string; published_at: string; result_r: number | null; triggered: boolean; source_system: string }

export function ManualTradeEntryPanel({ analysts, markets }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM, date: todayIso() })
  const [marketSearch, setMarketSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateRow[] | null>(null)
  const [success, setSuccess] = useState<{ resultR: number; kpiMessage: string } | null>(null)

  const activeAnalysts = useMemo(() => analysts.filter(a => a.active), [analysts])
  const activeMarkets = useMemo(() => markets.filter(m => m.active), [markets])
  const filteredMarkets = useMemo(() => {
    if (!marketSearch.trim()) return activeMarkets
    const q = marketSearch.trim().toLowerCase()
    return activeMarkets.filter(m => m.symbol.toLowerCase().includes(q) || m.asset_class.toLowerCase().includes(q))
  }, [activeMarkets, marketSearch])

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: typeof EMPTY_FORM[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setDuplicates(null)
    setSuccess(null)
  }

  const entry = Number(form.entry), stop = Number(form.stop), target = Number(form.target), exit = Number(form.exit)
  const numbersFilled = form.entry !== '' && form.stop !== '' && form.target !== '' && form.exit !== ''
  const numbersValid = numbersFilled && [entry, stop, target, exit].every(v => Number.isFinite(v) && v > 0)

  const stopPoints = numbersValid ? Math.abs(entry - stop) : null
  const targetPoints = numbersValid ? Math.abs(entry - target) : null
  const resultR = numbersValid ? calcResultR(form.direction, entry, stop, exit) : null
  const triggeredIndicator = numbersValid ? exit !== stop : null
  const winLoss = resultR === null ? null : resultR > 0 ? 'Win' : resultR < 0 ? 'Loss' : 'Flat'

  const orderingValid = numbersValid && (form.direction === 'BUY' ? stop < entry && entry < target : target < entry && entry < stop)
  const rangeValid = resultR !== null && resultR >= -1 && resultR <= 15
  const canSubmit = form.analystId && form.marketId && form.date && numbersValid && orderingValid && rangeValid && !submitting

  const orderingHint = form.direction === 'BUY' ? 'BUY requires stop < entry < target' : 'SELL requires target < entry < stop'

  async function submit(confirmDuplicate: boolean) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/trades/manual-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, entry, stop, target, exit, confirmDuplicate }),
      })
      const data = await res.json()
      if (res.status === 409 && data.duplicate) {
        setDuplicates(data.existing)
        return
      }
      if (!res.ok) {
        setError(data.error ?? 'Failed to add trade.')
        return
      }
      setSuccess({ resultR: data.resultR, kpiMessage: data.kpiRecalc?.message ?? 'KPI recalculation status unknown.' })
      setDuplicates(null)
      setForm({ ...EMPTY_FORM, date: todayIso() })
      setMarketSearch('')
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Manual Trade Entry</h2>
        <button onClick={() => setOpen(!open)}
          className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
          {open ? 'Close' : 'Add trade'}
        </button>
      </div>

      {open && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Inserts directly into actual_trades as a MANUAL_BACKFILL row (source_system keeps this
            structurally separate from live webhook data -- no collision possible). Use for corrections
            or trades that never came through the API feed.
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Analyst</p>
              <select value={form.analystId} onChange={e => set('analystId', e.target.value)}
                className="w-full text-sm px-2.5 py-2 rounded-md border border-border bg-background">
                <option value="">Select analyst</option>
                {activeAnalysts.map(a => <option key={a.analyst_id} value={a.analyst_id}>{a.display_name}</option>)}
              </select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Market</p>
              <input type="text" value={marketSearch} onChange={e => setMarketSearch(e.target.value)}
                placeholder="Search symbol..."
                className="w-full text-sm px-2.5 py-2 rounded-md border border-border bg-background mb-1" />
              <select value={form.marketId} onChange={e => set('marketId', e.target.value)}
                className="w-full text-sm px-2.5 py-2 rounded-md border border-border bg-background">
                <option value="">Select market</option>
                {filteredMarkets.map(m => <option key={m.market_id} value={m.market_id}>{m.symbol} ({m.asset_class})</option>)}
              </select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Direction</p>
              <div className="flex rounded-md border border-border overflow-hidden text-sm">
                {(['BUY', 'SELL'] as Direction[]).map(d => (
                  <button key={d} type="button" onClick={() => set('direction', d)}
                    className={`flex-1 px-2.5 py-2 transition-colors ${
                      form.direction === d ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'
                    }`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Date</p>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
                className="w-full text-sm px-2.5 py-2 rounded-md border border-border bg-background" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['entry', 'stop', 'target', 'exit'] as const).map(field => (
              <div key={field}>
                <p className="text-xs text-muted-foreground mb-1 capitalize">{field === 'exit' ? 'Exit price' : `${field} price`}</p>
                <input type="number" step="any" value={form[field]} onChange={e => set(field, e.target.value)}
                  className="w-full text-sm px-2.5 py-2 rounded-md border border-border bg-background tabular-nums" />
              </div>
            ))}
          </div>

          {/* Live-calculated fields */}
          <div className="rounded-md bg-muted/50 border border-border p-3 grid grid-cols-2 gap-3 sm:grid-cols-5 text-xs">
            <div><p className="text-muted-foreground">Stop (pts)</p><p className="font-medium tabular-nums">{stopPoints !== null ? stopPoints.toFixed(2) : '—'}</p></div>
            <div><p className="text-muted-foreground">Target (pts)</p><p className="font-medium tabular-nums">{targetPoints !== null ? targetPoints.toFixed(2) : '—'}</p></div>
            <div><p className="text-muted-foreground">Result R</p><p className="font-medium tabular-nums">{resultR !== null ? resultR.toFixed(3) : '—'}</p></div>
            <div><p className="text-muted-foreground">Triggered</p><p className="font-medium">{triggeredIndicator === null ? '—' : triggeredIndicator ? 'Yes' : 'No'}</p></div>
            <div>
              <p className="text-muted-foreground">Result</p>
              <p className={`font-medium ${winLoss === 'Win' ? 'text-green-700' : winLoss === 'Loss' ? 'text-red-700' : ''}`}>{winLoss ?? '—'}</p>
            </div>
          </div>

          {numbersValid && !orderingValid && (
            <p className="text-xs text-red-700">{orderingHint}.</p>
          )}
          {numbersValid && orderingValid && resultR !== null && !rangeValid && (
            <p className="text-xs text-red-700">Result R ({resultR}) is outside the plausible range (-1 to +15) -- check the entered prices.</p>
          )}
          {error && <p className="text-xs text-red-700">{error}</p>}

          {duplicates && duplicates.length > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-2">
              <p className="text-xs font-medium text-amber-800">
                {duplicates.length} existing trade{duplicates.length > 1 ? 's' : ''} already recorded for this analyst/market/direction/date:
              </p>
              <ul className="text-xs text-amber-800 space-y-0.5">
                {duplicates.map(d => (
                  <li key={d.trade_id}>
                    {d.published_at.slice(0, 10)} &middot; {d.source_system} &middot; R={d.result_r ?? '—'} &middot; {d.triggered ? 'triggered' : 'not triggered'}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button onClick={() => submit(true)} disabled={submitting}
                  className="text-xs px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors">
                  {submitting ? 'Saving...' : 'Add anyway'}
                </button>
                <button onClick={() => setDuplicates(null)}
                  className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {success && (
            <div className="rounded-md bg-green-50 border border-green-200 p-3">
              <p className="text-xs font-medium text-green-800">
                &#10003; Trade added. Result R: {success.resultR.toFixed(3)}.
              </p>
              <p className="text-xs text-green-700 mt-0.5">{success.kpiMessage}</p>
            </div>
          )}

          {!duplicates && (
            <div className="flex gap-2">
              <button onClick={() => submit(false)} disabled={!canSubmit}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {submitting ? 'Saving...' : 'Add trade'}
              </button>
              <button onClick={() => { setForm({ ...EMPTY_FORM, date: todayIso() }); setMarketSearch(''); setError(null); setDuplicates(null); setSuccess(null) }}
                className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
                Reset
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
