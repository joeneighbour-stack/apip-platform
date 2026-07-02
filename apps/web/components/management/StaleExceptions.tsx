'use client'

interface StaleRec {
  recommendation_version_id: string
  recommendation_validity_status: string
  volatility_warning: string | null
  atr_move_since_generation: number | null
  generated_at: string
  opportunity: {
    direction: string
    analyst_action: string
    market: { symbol: string } | null
  } | null
}

interface StaleExceptionsProps {
  recommendations: StaleRec[]
}

export function StaleExceptions({ recommendations }: StaleExceptionsProps) {
  function statusConfig(status: string) {
    if (status === 'STALE_PRICE') return { label: 'Stale Price', cls: 'bg-amber-50 text-amber-700' }
    if (status === 'ZONE_CHANGED') return { label: 'Zone Changed', cls: 'bg-orange-50 text-orange-700' }
    if (status === 'DO_NOT_USE_RECALCULATE') return { label: 'Do Not Use', cls: 'bg-red-50 text-red-700' }
    return { label: status, cls: 'bg-muted text-muted-foreground' }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Recommendation Exceptions</h2>
        {recommendations.length > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700">
            {recommendations.length} requiring attention
          </span>
        )}
      </div>
      {recommendations.length === 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">No stale or invalid recommendations.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Market</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">ATR Move</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Warning</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Generated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recommendations.map((rec) => {
                const cfg = statusConfig(rec.recommendation_validity_status)
                const opp = rec.opportunity as any
                const symbol = opp?.market?.symbol ?? opp?.markets?.symbol ?? opp?.market?.[0]?.symbol ?? 'Unknown'
                const age = rec.generated_at
                  ? Math.round((Date.now() - new Date(rec.generated_at).getTime()) / 60000) + 'm ago'
                  : 'Unknown'
                return (
                  <tr key={rec.recommendation_version_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{symbol}</td>
                    <td className="px-4 py-2.5">
                      <span className={'text-xs font-medium px-2 py-0.5 rounded-full ' + cfg.cls}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-xs text-muted-foreground">
                      {rec.atr_move_since_generation !== null
                        ? Number(rec.atr_move_since_generation).toFixed(2) + ' ATR'
                        : 'Unknown'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">
                      {rec.volatility_warning ?? 'None'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{age}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
