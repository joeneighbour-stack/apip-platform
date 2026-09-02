interface Props {
  newsHeadline: string | null
}

// Section 2 -- concise existing market-context/news feed, read like a short
// analyst briefing line, not a card. Hidden entirely when there's no headline --
// the interface should stay quiet rather than fill the space with placeholder text.
export function MarketContext({ newsHeadline }: Props) {
  if (!newsHeadline) return null

  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Market Context</p>
      <p className="text-sm text-foreground mt-0.5">{newsHeadline}</p>
      <p className="text-xs text-muted-foreground mt-1">
        Market context as of {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} UK
      </p>
    </div>
  )
}
