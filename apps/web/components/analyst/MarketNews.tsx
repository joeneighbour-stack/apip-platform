'use client'
import { useEffect, useState } from 'react'

interface Props {
  symbols: string[]
}

export function MarketNews({ symbols }: Props) {
  const [headlines, setHeadlines] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!symbols.length) { setLoading(false); return }

    fetch('/api/news/acuity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols }),
    })
      .then(r => r.json())
      .then(data => { setHeadlines(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [symbols.join(',')])

  if (loading) return (
    <p className="text-[10px] text-muted-foreground italic animate-pulse">Loading news...</p>
  )

  const hasNews = symbols.some(s => headlines[s])
  if (!hasNews) return null

  return (
    <div className="space-y-1.5">
      {symbols.map(sym => {
        const headline = headlines[sym]
        if (!headline) return null
        return (
          <div key={sym} className="pl-2.5 border-l-2 border-primary/30">
            <p className="text-xs text-foreground leading-snug font-medium">{headline}</p>
          </div>
        )
      })}
    </div>
  )
}
