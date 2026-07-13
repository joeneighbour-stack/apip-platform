'use client'

import { useState } from 'react'

const DEFAULT_THRESHOLDS = {
  atr_period: 14,
  zone_count: 4,
  minimum_rr: 2.0,
  min_trigger_sample: 5,
  stale_atr_threshold: 0.25,
  force_recalc_atr_threshold: 0.5,
  entry_distance_threshold_atr: 1.5,
  min_profile_trades: 5,
  min_shadow_sample: 20,
}

const DESCRIPTIONS: Record<string, string> = {
  atr_period: 'ATR lookback period (bars)',
  zone_count: 'Number of ATR zones (usually 4)',
  minimum_rr: 'Minimum risk:reward ratio for valid recommendation',
  min_trigger_sample: 'Minimum trades needed to compute trigger probability from history',
  stale_atr_threshold: 'ATR moves before recommendation marked STALE_PRICE',
  force_recalc_atr_threshold: 'ATR moves before recommendation marked DO_NOT_USE_RECALCULATE',
  entry_distance_threshold_atr: 'ATR distance before entry marked ENTRY_ALREADY_PASSED',
  min_profile_trades: 'Minimum trades to create an analyst profile entry',
  min_shadow_sample: 'Minimum shadow outcomes before using shadow-based trigger rate',
}

export function ThresholdsPanel() {
  const [values, setValues] = useState(DEFAULT_THRESHOLDS)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    const res = await fetch('/api/admin/thresholds/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Engine Thresholds</h2>
        <p className="text-xs text-muted-foreground">Changes take effect on next engine run</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          {Object.entries(values).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium">{key.replace(/_/g, ' ')}</p>
                <p className="text-xs text-muted-foreground">{DESCRIPTIONS[key]}</p>
              </div>
              <input
                type="number"
                value={value}
                step={key.includes('threshold') || key === 'minimum_rr' ? 0.05 : 1}
                onChange={e => setValues(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                className="text-xs px-2 py-1 rounded border border-border bg-background w-20 tabular-nums text-right"
              />
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-border flex items-center gap-3">
          <button onClick={handleSave} disabled={true}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            Save thresholds
          </button>
          {saved && <span className="text-xs text-green-700">✓ Saved</span>}
          <p className="text-xs text-muted-foreground">
            Note: thresholds are currently hardcoded in the engine. This UI is a placeholder for future model_parameters table integration.
          </p>
        </div>
      </div>
    </section>
  )
}
