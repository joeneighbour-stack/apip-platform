'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { TradeStatisticsSummary, DistributionBucket } from '@/lib/metrics'
import { formatR, formatPercent } from '@/lib/format'

interface Props {
  stats: TradeStatisticsSummary
  distribution: DistributionBucket[]
}

const ROWS: { key: keyof TradeStatisticsSummary; label: string; fmt: (v: any) => string }[] = [
  { key: 'winRate', label: 'Win Rate', fmt: formatPercent },
  { key: 'lossRate', label: 'Loss Rate', fmt: formatPercent },
  { key: 'avgWinner', label: 'Average Winner', fmt: formatR },
  { key: 'avgLoser', label: 'Average Loser', fmt: formatR },
  { key: 'avgR', label: 'Avg R / Trade', fmt: formatR },
  { key: 'profitFactor', label: 'Profit Factor', fmt: v => v !== null ? v.toFixed(2) : '—' },
  { key: 'triggerRate', label: 'Trigger Rate', fmt: formatPercent },
  { key: 'generated', label: 'Number Generated', fmt: v => v.toLocaleString() },
  { key: 'triggered', label: 'Number Triggered', fmt: v => v.toLocaleString() },
  { key: 'expired', label: 'Expired / Not Triggered', fmt: v => v.toLocaleString() },
  { key: 'avgDurationHours', label: 'Average Duration', fmt: v => v !== null ? `${v.toFixed(1)}h` : '—' },
]

// Kept analytical rather than decorative -- this is the section that answers whether
// performance is consistent, dependent on outsized winners, or a high-frequency-small-
// wins pattern, not a stylistic flourish.
export function TradeStatistics({ stats, distribution }: Props) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Trade Statistics</p>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {ROWS.map(r => (
                <tr key={r.key}>
                  <td className="px-4 py-2 text-muted-foreground">{r.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{r.fmt(stats[r.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {distribution.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Winner / Loser Distribution</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distribution} margin={{ top: 4, right: 8, left: 0, bottom: 20 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false}
                  interval={0} angle={-40} textAnchor="end" height={40} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                <Tooltip formatter={(v: any) => [v, 'Trades']} contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {distribution.map((b, i) => <Cell key={i} fill={b.rangeStart >= 0 ? '#22c55e' : '#ef4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
