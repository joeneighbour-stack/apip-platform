'use client'
import { useEffect, useState } from 'react'
import { PerformanceAnalytics } from './PerformanceAnalytics'

interface Analyst { analyst_id: string; display_name: string }
interface Market { market_id: string; symbol: string; asset_class: string }

interface Props {
  analysts: Analyst[]
  markets: Market[]
}

export function PerformanceAnalyticsClient({ analysts, markets }: Props) {
  const [trades, setTrades] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [count, setCount] = useState(0)

  useEffect(() => {
    async function loadTrades() {
      setLoading(true)
      const res = await fetch('/api/analytics/trades')
      if (res.ok) {
        const data = await res.json()
        setTrades(data)
        setCount(data.length)
      }
      setLoading(false)
    }
    loadTrades()
  }, [])

  if (loading) {
    return (
      <div className="rounded-lg border border-border p-12 text-center space-y-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground">Loading trade history{count > 0 ? ` (${count.toLocaleString()} trades)` : ''}...</p>
      </div>
    )
  }

  return <PerformanceAnalytics analysts={analysts} markets={markets} trades={trades} />
}
