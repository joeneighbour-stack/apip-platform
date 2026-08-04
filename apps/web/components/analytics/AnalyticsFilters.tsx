'use client'
import { useState } from 'react'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { MARKET_GROUPS, marketGroupSymbols } from '@/lib/marketGroups'
import { DATE_PRESET_OPTIONS } from '@/lib/dateRanges'
import { PRODUCT_OPTIONS, hasActiveFilters, DEFAULT_FILTERS, type AnalyticsFilterState } from '@/lib/analyticsFilters'

interface Analyst { analyst_id: string; display_name: string; active: boolean }
interface Market { market_id: string; symbol: string; asset_class: string }

interface Props {
  filters: AnalyticsFilterState
  onChange: (filters: AnalyticsFilterState) => void
  analysts: Analyst[]
  markets: Market[]
}

const DIRECTION_OPTIONS = [{ value: 'BUY', label: 'BUY' }, { value: 'SELL', label: 'SELL' }]
const SESSION_OPTIONS = [
  { value: 'EUROPEAN', label: 'European' }, { value: 'US', label: 'US' },
  { value: 'APAC', label: 'APAC' }, { value: 'CRYPTO', label: 'Crypto' },
]

export function AnalyticsFilters({ filters, onChange, analysts, markets }: Props) {
  const [moreOpen, setMoreOpen] = useState(false)

  function set<K extends keyof AnalyticsFilterState>(key: K, value: AnalyticsFilterState[K]) {
    onChange({ ...filters, [key]: value })
  }

  const assetClasses = [...new Set(markets.map(m => m.asset_class))].sort()
  const filteredMarkets = filters.assetClasses.length === 0
    ? markets
    : markets.filter(m => filters.assetClasses.includes(m.asset_class))

  function applyMarketGroup(groupKey: string) {
    const symbols = new Set(marketGroupSymbols(groupKey))
    const ids = markets.filter(m => symbols.has(m.symbol)).map(m => m.market_id)
    set('marketIds', ids)
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Filters</p>
        {hasActiveFilters(filters) && (
          <button onClick={() => onChange(DEFAULT_FILTERS)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Clear all
          </button>
        )}
      </div>

      {/* Date */}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Date</p>
        <div className="flex flex-wrap gap-1.5">
          {DATE_PRESET_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => set('datePreset', opt.key)}
              className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                filters.datePreset === opt.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/50'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
        {filters.datePreset === 'CUSTOM' && (
          <div className="flex items-center gap-2 pt-1">
            <input type="date" value={filters.customStart ?? ''} onChange={e => set('customStart', e.target.value || null)}
              className="text-xs px-2 py-1.5 rounded-md border border-border bg-background" />
            <span className="text-xs text-muted-foreground">to</span>
            <input type="date" value={filters.customEnd ?? ''} onChange={e => set('customEnd', e.target.value || null)}
              className="text-xs px-2 py-1.5 rounded-md border border-border bg-background" />
          </div>
        )}
      </div>

      {/* Product / Analyst / Asset class / Market */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Product / Strategy</p>
          <select value={filters.product} onChange={e => set('product', e.target.value as AnalyticsFilterState['product'])}
            className="w-full text-xs px-2 py-2 rounded-md border border-border bg-background">
            {PRODUCT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <MultiSelect label="Analyst (internal only)"
          options={analysts.filter(a => a.active).map(a => ({ value: a.analyst_id, label: a.display_name }))}
          selected={filters.analystIds} onChange={v => set('analystIds', v)} placeholder="All analysts" />
        <MultiSelect label="Asset Class"
          options={assetClasses.map(c => ({ value: c, label: c }))}
          selected={filters.assetClasses}
          onChange={v => onChange({ ...filters, assetClasses: v, marketIds: [] })}
          placeholder="All classes" />
        <MultiSelect label="Market"
          options={filteredMarkets.map(m => ({ value: m.market_id, label: m.symbol }))}
          selected={filters.marketIds} onChange={v => set('marketIds', v)} placeholder="All markets" />
      </div>

      {/* Market group bundles */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">Bundles:</span>
        {MARKET_GROUPS.map(g => (
          <button key={g.key} onClick={() => applyMarketGroup(g.key)}
            className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors">
            {g.label}
          </button>
        ))}
      </div>

      {/* More filters */}
      <div className="border-t border-border pt-3">
        <button onClick={() => setMoreOpen(!moreOpen)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          {moreOpen ? '▲ Fewer filters' : '▼ More filters'}
        </button>
        {moreOpen && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mt-3">
            <MultiSelect label="Direction" options={DIRECTION_OPTIONS} selected={filters.directions}
              onChange={v => set('directions', v)} placeholder="Both" />
            <MultiSelect label="Session" options={SESSION_OPTIONS} selected={filters.sessions}
              onChange={v => set('sessions', v)} placeholder="All sessions" />
            <div>
              <p className="text-xs text-muted-foreground mb-1">Trigger Status</p>
              <select value={filters.triggerStatus} onChange={e => set('triggerStatus', e.target.value as AnalyticsFilterState['triggerStatus'])}
                className="w-full text-xs px-2 py-2 rounded-md border border-border bg-background">
                <option value="ALL">All</option>
                <option value="TRIGGERED">Triggered</option>
                <option value="NOT_TRIGGERED">Not Triggered / Expired</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
