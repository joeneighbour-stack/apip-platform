'use client'

import { useState } from 'react'

interface Market {
  market_id: string
  symbol: string
  asset_class: string
  price_data_provider: string | null
  price_data_symbol: string | null
  active: boolean
}

export function MarketManagementPanel({ markets }: { markets: Market[] }) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [changes, setChanges] = useState<Record<string, Partial<Market>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [filter, setFilter] = useState<'engine' | 'active' | 'inactive' | 'all'>('engine')

  const filtered = markets.filter(m => {
    if (filter === 'engine' && !m.price_data_provider) return false
    if (filter === 'active' && !m.active) return false
    if (filter === 'inactive' && m.active) return false
    if (search && !m.symbol.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function updateChange(marketId: string, field: keyof Market, value: any) {
    setChanges(prev => ({ ...prev, [marketId]: { ...prev[marketId], [field]: value } }))
  }

  async function handleSave(market: Market) {
    setSaving(market.market_id)
    setMessage(null)
    const updates = changes[market.market_id] ?? {}
    try {
      const res = await fetch('/api/admin/markets/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId: market.market_id, ...updates }),
      })
      const data = await res.json()
      setMessage(res.ok ? `Updated ${market.symbol}` : data.error ?? 'Failed')
      if (res.ok) setEditing(null)
    } finally {
      setSaving(null)
    }
  }

  function getVal<T>(marketId: string, field: keyof Market, fallback: T): T {
    return (changes[marketId]?.[field] as T) ?? fallback
  }

  const engineCount = markets.filter(m => m.price_data_provider).length

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Market Management</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search markets..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-background w-40"
          />
          <select value={filter} onChange={e => setFilter(e.target.value as any)}
            className="text-xs px-2 py-1.5 rounded-md border border-border bg-background">
            <option value="engine">Engine markets ({engineCount})</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
            <option value="all">All markets</option>
          </select>
          <span className="text-xs text-muted-foreground">{filtered.length} shown</span>
        </div>
      </div>

      {message && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2">
          <p className="text-xs text-blue-800">{message}</p>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Symbol</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Class</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Provider</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Price Symbol</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Active</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(market => (
              <tr key={market.market_id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium">{market.symbol}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{market.asset_class}</td>
                <td className="px-4 py-2.5">
                  {editing === market.market_id ? (
                    <input
                      value={getVal(market.market_id, 'price_data_provider', market.price_data_provider ?? '')}
                      onChange={e => updateChange(market.market_id, 'price_data_provider', e.target.value)}
                      className="text-xs px-2 py-0.5 rounded border border-border bg-background w-36"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">{market.price_data_provider ?? '—'}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {editing === market.market_id ? (
                    <input
                      value={getVal(market.market_id, 'price_data_symbol', market.price_data_symbol ?? '')}
                      onChange={e => updateChange(market.market_id, 'price_data_symbol', e.target.value)}
                      className="text-xs px-2 py-0.5 rounded border border-border bg-background w-40"
                    />
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground">{market.price_data_symbol ?? '—'}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {editing === market.market_id ? (
                    <button
                      onClick={() => updateChange(market.market_id, 'active', !getVal(market.market_id, 'active', market.active))}
                      className={`text-xs font-medium px-2 py-0.5 rounded-full transition-colors ${
                        getVal(market.market_id, 'active', market.active)
                          ? 'bg-green-100 text-green-800'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {getVal(market.market_id, 'active', market.active) ? 'Active' : 'Inactive'}
                    </button>
                  ) : (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      market.active ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'
                    }`}>
                      {market.active ? 'Active' : 'Inactive'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {editing === market.market_id ? (
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleSave(market)} disabled={saving === market.market_id}
                        className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                        {saving === market.market_id ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => setEditing(null)}
                        className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setEditing(market.market_id)}
                      className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors">
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
