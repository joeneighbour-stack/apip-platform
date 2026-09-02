// apps/web/hooks/useMarketNews.ts
// Polls /api/news/acuity every 30 minutes for all of a session's symbols at once
// (rather than per-market as each row is expanded), so every market has fresh
// context simultaneously and analysts don't need to refresh the page to see it.
// Returns a map of symbol -> { headline, publishedAt }.

'use client'
import { useEffect, useState, useRef } from 'react'

export interface MarketNewsItem {
  headline: string
  publishedAt: string
}

export function useMarketNews(symbols: string[], pollIntervalMs = 30 * 60 * 1000) {
  const [news, setNews] = useState<Record<string, MarketNewsItem>>({})
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  async function fetchNews() {
    if (!symbols.length) return
    try {
      const res = await fetch('/api/news/acuity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      })
      if (!res.ok) return
      const data = await res.json()
      setNews(data)
      setLastFetched(new Date())
    } catch (err) {
      console.error('Failed to fetch market news:', err)
    }
  }

  useEffect(() => {
    if (symbols.length === 0) return
    fetchNews() // fetch immediately on mount
    timerRef.current = setInterval(fetchNews, pollIntervalMs) // then every 30 minutes
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [symbols.join(',')])

  return { news, lastFetched }
}
