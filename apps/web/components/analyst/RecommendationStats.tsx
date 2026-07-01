'use client'

import { Tooltip } from '@/components/ui/Tooltip'

interface RecommendationStatsProps {
  triggerProbability: number
  expectedR: number
}

export function RecommendationStats({ triggerProbability, expectedR }: RecommendationStatsProps) {
  return (
    <div className="flex items-center gap-4 text-sm shrink-0">
      <Tooltip content="The percentage of similar historical setups in this zone and session where price reached the entry range. Based on the analyst profile and session history.">
        <span className="text-muted-foreground cursor-default">
          Trigger{' '}
          <span className="font-medium text-foreground underline decoration-dotted decoration-muted-foreground">
            {Math.round(triggerProbability * 100)}%
          </span>
        </span>
      </Tooltip>
      <Tooltip content="The average R-multiple achieved in similar historical setups where the trade triggered. Reflects how the risk/reward has played out in comparable conditions — not a guarantee of future performance.">
        <span className="text-muted-foreground cursor-default">
          Expected R{' '}
          <span className="font-medium text-foreground underline decoration-dotted decoration-muted-foreground">
            {Number(expectedR).toFixed(2)}R
          </span>
        </span>
      </Tooltip>
    </div>
  )
}
