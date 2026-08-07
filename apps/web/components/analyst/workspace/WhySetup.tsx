import { formatR, formatPercent } from '@/lib/format'
import {
  zonePlainLabel, priceLocationRating, regimeFitRating, regimeFitInterpretation,
  historicalEvidenceRating, isTrendingRegimeLabel, BLOCK_RATING_CLASS,
} from '@/lib/workspaceUtils'
import type { WorkspaceRow } from './types'

interface Props {
  row: WorkspaceRow
  recommendationsGeneratedToday: number
  marketsAllocatedToday: number
}

function Block({ title, rating, children }: { title: string; rating: string | null; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
        {rating && <span className={`text-xs font-medium ${BLOCK_RATING_CLASS[rating as keyof typeof BLOCK_RATING_CLASS] ?? 'text-muted-foreground'}`}>{rating}</span>}
      </div>
      <div className="text-xs text-muted-foreground leading-relaxed">{children}</div>
    </div>
  )
}

function FunnelRow({ value, label, available }: { value: string; label: string; available: boolean }) {
  return (
    <div className={`text-xs ${available ? 'text-foreground' : 'text-muted-foreground'}`}>
      <span className="font-medium tabular-nums">{available ? value : '—'}</span>
      <span className={available ? 'text-muted-foreground' : 'text-muted-foreground/70'}> {label}</span>
    </div>
  )
}

// Section 4 -- compact evidence blocks (not prose), plus the selection funnel.
// Every number/statement here is either a WorkspaceRow field or an honestly
// unavailable "—" row, per the redesign's "never fabricate" rule.
export function WhySetup({ row, recommendationsGeneratedToday, marketsAllocatedToday }: Props) {
  const hasZoneData = row.currentZone != null && row.preferredZone != null
  const hasRegimeData = row.regime?.trendState != null && row.regime?.adx14 != null
  const hasHistoryData = row.historicalEdge.avgR != null

  return (
    <div className="space-y-4">
      <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Why This Setup?</h3>

      <div className="space-y-3">
        {hasZoneData && (
          <Block title="Price Location" rating={priceLocationRating(row.currentZone!, row.preferredZone!)}>
            <p>
              Price is in {zonePlainLabel(row.currentZone)}. Preferred entry: {zonePlainLabel(row.preferredZone)}.
            </p>
            {row.distanceLanguage && <p className="mt-0.5">{row.distanceLanguage}.</p>}
          </Block>
        )}

        {hasRegimeData && (
          <Block title="Regime Fit" rating={regimeFitRating(row.direction, row.regime!.trendState, row.regime!.adx14)}>
            <p>{isTrendingRegimeLabel(row.regime!.trendState, row.regime!.adx14)} market · ADX {row.regime!.adx14!.toFixed(0)}</p>
            <p className="mt-0.5">{regimeFitInterpretation(row.direction, row.regime!.trendState, row.regime!.adx14)}</p>
          </Block>
        )}

        <Block title="Historical Evidence" rating={hasHistoryData ? historicalEvidenceRating(row.historicalEdge.avgR!) : null}>
          {hasHistoryData ? (
            <>
              <p>{row.direction ?? '—'} · {row.symbol}{row.historicalEdge.regimeLabel ? ` · comparable conditions` : ''}</p>
              <p className="mt-0.5 tabular-nums">
                Win rate: {formatPercent(row.historicalEdge.winRate)} &nbsp; Expectancy: {formatR(row.historicalEdge.avgR)} &nbsp; Sample: {row.historicalEdge.trades} trades
              </p>
            </>
          ) : (
            <p>No trade history yet for this market.</p>
          )}
        </Block>

        <Block title="Why You're Seeing This" rating={null}>
          <p>{row.personalisation ?? 'This market has been assigned based on today’s conditions and your coverage profile.'}</p>
        </Block>
      </div>

      <div className="pt-2 border-t border-border/60 space-y-1.5">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">How This Was Selected</p>
        <FunnelRow value="" label="markets analysed today" available={false} />
        <FunnelRow value={String(recommendationsGeneratedToday)} label="with recommendations generated" available={true} />
        <FunnelRow value={String(marketsAllocatedToday)} label="allocated to you today" available={true} />
        <p className="text-xs text-muted-foreground">{row.symbol} ranked by event risk, then expected value</p>
      </div>
    </div>
  )
}
