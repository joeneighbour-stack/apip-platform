interface Props {
  title: string
  periodLabel: string
  segments: string[]
  analystSegment: string | null
  redactAnalysts: boolean
  tradeCount: number
}

// Single component for both the internal and report-safe universe description --
// `redactAnalysts` is the only thing that changes, so there is one place that decides
// what counts as analyst-identifying, not two hand-maintained copies of this text.
export function UniverseSummary({ title, periodLabel, segments, analystSegment, redactAnalysts, tradeCount }: Props) {
  const parts = [...segments, ...(!redactAnalysts && analystSegment ? [analystSegment] : [])]
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground">{periodLabel}</p>
      {parts.length > 0 && <p className="text-xs text-muted-foreground">{parts.join(' • ')}</p>}
      <p className="text-xs text-muted-foreground">{tradeCount.toLocaleString()} triggered trades</p>
    </div>
  )
}
