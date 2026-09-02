import type { MarketNewsItem } from '@/hooks/useMarketNews'

interface Props {
  news: MarketNewsItem | null
  lastFetched: Date | null
}

// Section 2 -- concise existing market-context/news feed, read like a short
// analyst briefing line, not a card. Hidden entirely when there's no headline --
// the interface should stay quiet rather than fill the space with placeholder text.
//
// Shows the article's own publication time rather than "as of {now}" -- when the
// headline is fetched live but the underlying article is old, "as of now" would
// misleadingly imply the content itself is current. A 2-hour staleness threshold
// separates a routine same-session publish timestamp from a warning that this
// article may no longer reflect current conditions.
export function MarketContext({ news, lastFetched }: Props) {
  if (!news) return null
  const { headline, publishedAt } = news

  const ageHours = publishedAt
    ? (Date.now() - new Date(publishedAt).getTime()) / 3600000
    : null

  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Market Context</p>
      <p className="text-sm text-foreground mt-0.5">{headline}</p>
      {ageHours !== null && ageHours > 2 && (
        <p className="text-xs text-amber-600 mt-1">
          ⚠ Published {ageHours < 24
            ? `${Math.round(ageHours)}h ago`
            : `${Math.round(ageHours / 24)} day(s) ago`} — content may not reflect current conditions
        </p>
      )}
      {ageHours !== null && ageHours <= 2 && lastFetched && (
        <p className="text-xs text-muted-foreground mt-1">
          Published {new Date(publishedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} UK
        </p>
      )}
    </div>
  )
}
