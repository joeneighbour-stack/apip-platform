'use client'
import { useEffect, useState } from 'react'
import { PerformanceAnalytics } from './PerformanceAnalytics'

interface Analyst { analyst_id: string; display_name: string; active: boolean }
interface Market { market_id: string; symbol: string; asset_class: string }

interface Props {
  analysts: Analyst[]
  markets: Market[]
}

export function PerformanceAnalyticsClient({ analysts, markets }: Props) {
  const [kpis, setKpis] = useState<any[]>([])
  const [trades, setTrades] = useState<any[]>([])
  const [kpisLoading, setKpisLoading] = useState(true)
  const [tradesLoading, setTradesLoading] = useState(false)
  const [tradesLoaded, setTradesLoaded] = useState(false)

  // Load KPIs immediately — fast, pre-calculated
  useEffect(() => {
    fetch('/api/analytics/kpis?from=2017-01-01')
      .then(r => r.json())
      .then(data => { setKpis(data); setKpisLoading(false) })
      .catch(() => setKpisLoading(false))
  }, [])

  // Load trades on demand — called by PerformanceAnalytics when advanced filters applied
  function loadTrades() {
    if (tradesLoaded || tradesLoading) return
    setTradesLoading(true)
    const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    fetch(`/api/analytics/trades?from=${from}`)
      .then(r => r.json())
      .then(data => {
        setTrades(data)
        setTradesLoaded(true)
        setTradesLoading(false)
      })
      .catch(() => setTradesLoading(false))
  }

  if (kpisLoading) {
    return (
      <div className="rounded-lg border border-border p-12 text-center space-y-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground">Loading performance data...</p>
      </div>
    )
  }

  return (
    <PerformanceAnalytics
      analysts={analysts}
      markets={markets}
      kpis={kpis}
      trades={trades}
      tradesLoading={tradesLoading}
      tradesLoaded={tradesLoaded}
      onLoadTrades={loadTrades}
    />
  )
}

