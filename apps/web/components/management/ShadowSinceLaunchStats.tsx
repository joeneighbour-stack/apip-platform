interface ShadowOutcomeInput {
  trade_outcome_status: string
  result_r: number | null
  shadow_trade: { rr: number } | null
}
interface ActualTradeInput {
  triggered: boolean
  result_r: number | null
}
interface ActualPublicationInput {
  reconciliation_status: string
}

interface Props {
  shadowOutcomes: ShadowOutcomeInput[]
  actualTrades: ActualTradeInput[]
  actualPublications: ActualPublicationInput[]
}

function shadowResultR(outcome: ShadowOutcomeInput): number | null {
  if (outcome.result_r !== null) return outcome.result_r
  if (outcome.trade_outcome_status === 'TARGET_HIT') return outcome.shadow_trade?.rr ?? null
  if (outcome.trade_outcome_status === 'STOP_HIT') return -1
  return null
}

// The "Shadow vs Actual -- Since Platform Launch" 3-column stats panel -- extracted out of
// ShadowMonitoringPanel.tsx so Team Performance can show the exact same numbers rather than
// a differently-scoped lookalike. Self-contained: takes the same three raw arrays both
// pages already fetch and does its own aggregation, so neither caller has to duplicate the
// calculation.
export function ShadowSinceLaunchStats({ shadowOutcomes, actualTrades, actualPublications }: Props) {
  const triggered = shadowOutcomes.filter(o =>
    ['TARGET_HIT', 'STOP_HIT', 'TRIGGERED', 'CLOSED_PROFIT', 'CLOSED_LOSS'].includes(o.trade_outcome_status)
  )
  const resolved = shadowOutcomes.filter(o =>
    ['TARGET_HIT', 'STOP_HIT', 'CLOSED_PROFIT', 'CLOSED_LOSS'].includes(o.trade_outcome_status)
  )
  const wins = shadowOutcomes.filter(o => ['TARGET_HIT', 'CLOSED_PROFIT'].includes(o.trade_outcome_status))
  const shadowWinRate = triggered.length > 0 ? wins.length / triggered.length : null
  const shadowTriggerRate = shadowOutcomes.length > 0 ? triggered.length / shadowOutcomes.length : null
  const shadowTotalR = triggered.reduce((s, o) => s + (shadowResultR(o) ?? 0), 0)
  const shadowAvgRr = triggered.length > 0
    ? triggered.reduce((s, o) => s + (o.shadow_trade?.rr ?? 0), 0) / triggered.length
    : null

  const actualTriggered = actualTrades.filter(t => t.triggered && t.result_r !== null)
  const actualWins = actualTriggered.filter(t => (t.result_r ?? 0) > 0)
  const actualWinRate = actualTriggered.length > 0 ? actualWins.length / actualTriggered.length : null
  const actualTotalR = actualTriggered.reduce((s, t) => s + (t.result_r ?? 0), 0)
  const actualPublicationsTriggered = actualPublications.filter(p => p.reconciliation_status === 'WEBHOOK_TRUE')
  const actualTriggerRate = actualPublications.length > 0 ? actualPublicationsTriggered.length / actualPublications.length : null

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Shadow vs Actual &mdash; Since Platform Launch</h2>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shadow Benchmark</p>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Total setups</span><span className="font-medium">{shadowOutcomes.length}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Resolved</span><span className="font-medium">{resolved.length}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger rate</span><span className="font-medium">{shadowTriggerRate !== null ? `${Math.round(shadowTriggerRate * 100)}%` : '—'}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate</span><span className="font-medium">{shadowWinRate !== null ? `${Math.round(shadowWinRate * 100)}%` : '—'}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Avg RR</span><span className="font-medium">{shadowAvgRr !== null ? `${shadowAvgRr.toFixed(1)}:1` : '—'}</span></div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total R</span>
              <span className={`font-medium ${shadowTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {shadowTotalR > 0 ? '+' : ''}{shadowTotalR.toFixed(2)}R
              </span>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Analyst Actual (Since Shadow Launch)</p>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Total setups</span><span className="font-medium">{actualPublications.length}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Triggered</span><span className="font-medium">{actualPublicationsTriggered.length}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger rate</span><span className="font-medium">{actualTriggerRate !== null ? `${Math.round(actualTriggerRate * 100)}%` : '—'}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate</span><span className="font-medium">{actualWinRate !== null ? `${Math.round(actualWinRate * 100)}%` : '—'}</span></div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total R</span>
              <span className={`font-medium ${actualTotalR >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {actualTotalR > 0 ? '+' : ''}{actualTotalR.toFixed(2)}R
              </span>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delta (Shadow &minus; Actual)</p>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Win rate delta</span>
              <span className="font-medium">
                {shadowWinRate !== null && actualWinRate !== null ? `${((shadowWinRate - actualWinRate) * 100).toFixed(1)}pp` : '—'}
              </span>
            </div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Trigger delta</span>
              <span className="font-medium">
                {shadowTriggerRate !== null && actualTriggerRate !== null ? `${((shadowTriggerRate - actualTriggerRate) * 100).toFixed(1)}pp` : '—'}
              </span>
            </div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Status</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {triggered.length < 30 ? `Accumulating (${triggered.length}/30)` : 'Ready'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
