// apps/web/hooks/useLivePrices.ts
// Polls /api/prices/live every 30 seconds for current prices.
// Returns a map of symbol -> current price.

'use client'
import { useEffect, useState, useRef } from 'react'

export function useLivePrices(symbols: string[], pollIntervalMs = 1800000) {
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  async function fetchPrices() {
    if (!symbols.length) return
    try {
      const res = await fetch('/api/prices/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      })
      if (res.ok) {
        const data = await res.json()
        setPrices(data)
        setLastUpdated(new Date())
      }
    } catch {
      // Silent fail — prices just won't update
    }
  }

  useEffect(() => {
    if (!symbols.length) return
    fetchPrices()
    timerRef.current = setInterval(fetchPrices, pollIntervalMs)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [symbols.join(',')])

  return { prices, lastUpdated }
}

