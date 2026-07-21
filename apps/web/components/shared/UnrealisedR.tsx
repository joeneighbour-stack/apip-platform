// apps/web/components/shared/UnrealisedR.tsx
// Displays live unrealised R for an open trade given current price.

'use client'

interface Props {
  entry: number
  stop: number
  target: number
  direction: 'BUY' | 'SELL'
  currentPrice: number | null
  decimals?: number
}

export function UnrealisedR({ entry, stop, target, direction, currentPrice, decimals = 4 }: Props) {
  if (currentPrice === null) {
    return <span className="text-xs text-muted-foreground">—</span>
  }

  const stopDistance = Math.abs(entry - stop)
  if (stopDistance === 0) return <span className="text-xs text-muted-foreground">—</span>

  const pnl = direction === 'BUY'
    ? currentPrice - entry
    : entry - currentPrice

  const unrealisedR = pnl / stopDistance

  // Determine if at/beyond target or stop
  const atTarget = direction === 'BUY' ? currentPrice >= target : currentPrice <= target
  const atStop   = direction === 'BUY' ? currentPrice <= stop   : currentPrice >= stop

  const colour = atTarget
    ? 'text-green-700 font-semibold'
    : atStop
    ? 'text-red-700 font-semibold'
    : unrealisedR >= 0
    ? 'text-green-600'
    : 'text-red-600'

  const label = atTarget ? '(target)' : atStop ? '(stopped)' : ''

  return (
    <span className={`text-xs tabular-nums ${colour}`}>
      {unrealisedR > 0 ? '+' : ''}{unrealisedR.toFixed(2)}R {label}
    </span>
  )
}
