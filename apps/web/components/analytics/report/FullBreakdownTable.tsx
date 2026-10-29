import type { FullBreakdownRow, FullBreakdownGroup } from '@/lib/metrics'
import { formatR, formatPercent } from '@/lib/format'

// Shared by the Analyst report's Full Asset Breakdown and the Patterns report's
// Pattern Summary / Asset x Pattern tables -- all three need the same thing: an
// unfiltered, fully-populated table (no top/bottom N, no minimum-sample cutoff) that
// flows across as many printed pages as it needs, repeats its header row on each new
// page, and never splits a single row across a page break.
//
// Page-break behaviour relies on plain HTML table semantics, not anything bespoke:
// - A <thead> has `display: table-header-group` by default, which is exactly what
//   makes Chrome/Firefox repeat it on every page a <table> spans when printed -- as
//   long as nothing here overrides that display value, or wraps the table in a
//   fixed-height/overflow-hidden ancestor (neither happens here; compare
//   AttributionTable.tsx, which DOES wrap its table in an `overflow-hidden` div, but
//   that div has no height constraint either, so it isn't the cause of the bug this
//   component exists to fix -- see the root-cause writeup in the PR/commit).
// - Each <tr> gets `breakInside: avoid` (+ the legacy pageBreakInside alias) so a
//   single row is never split across a page boundary.
// The table itself is deliberately NOT wrapped in any height- or overflow-constrained
// container, so it can grow across pages instead of being clipped.

export type BreakdownTableRow =
  | { type: 'group-header'; label: string }
  | { type: 'data'; row: FullBreakdownRow; assetClass?: string; lowSample?: boolean }
  | { type: 'subtotal'; row: FullBreakdownRow }
  | { type: 'grand-total'; row: FullBreakdownRow }

interface Props {
  title: string
  rows: BreakdownTableRow[]
  // Adds the "Asset Class" column (Analyst report). Off for the Patterns report's
  // tables, which are grouped by asset or by pattern instead and have no asset-class
  // concept in their own column list.
  showAssetClass?: boolean
  lowSampleThreshold?: number
}

const trStyle: React.CSSProperties = { breakInside: 'avoid', pageBreakInside: 'avoid' }

function DataCells({ row }: { row: FullBreakdownRow }) {
  return (
    <>
      <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{row.trades.toLocaleString()}</td>
      <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{formatPercent(row.winRate)}</td>
      <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{formatR(row.avgR)}</td>
      <td className="py-1 pr-2 text-right tabular-nums font-medium whitespace-nowrap">{formatR(row.totalR)}</td>
      <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{row.profitFactor !== null ? row.profitFactor.toFixed(2) : '—'}</td>
      <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{row.payoutRatio !== null ? row.payoutRatio.toFixed(2) : '—'}</td>
      <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{formatR(row.bestTradeR)}</td>
      <td className="py-1 text-right tabular-nums whitespace-nowrap">{formatR(row.worstTradeR)}</td>
    </>
  )
}

export function FullBreakdownTable({ title, rows, showAssetClass = false, lowSampleThreshold }: Props) {
  // "+999.99R" (8 chars) is the widest value any R column can hold -- sized with margin.
  // Asset/Pattern label gets the remaining width; Asset Class (when shown) is narrow
  // (short fixed strings: FX/INDEX/COMMODITY/CRYPTO/EQUITY).
  const widths = showAssetClass
    ? ['24%', '10%', '7%', '8%', '9%', '9%', '9%', '9%', '7.5%', '7.5%']
    : ['36%', '8%', '7%', '8%', '9%', '9%', '7.5%', '7.5%', '8%']
  const headers = showAssetClass
    ? ['Asset', 'Asset Class', 'Trades', 'Win Rate', 'Avg R', 'Total R', 'Profit Factor', 'Payout Ratio', 'Best Trade (R)', 'Worst Trade (R)']
    : ['', 'Trades', 'Win Rate', 'Avg R', 'Total R', 'Profit Factor', 'Payout Ratio', 'Best Trade (R)', 'Worst Trade (R)']

  return (
    <div>
      <p className="text-[8pt] font-semibold uppercase tracking-wide mb-1">{title}</p>
      <table className="w-full text-[8pt]" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <thead>
          <tr className="border-b border-black/30" style={trStyle}>
            {headers.map((h, i) => (
              <th key={i} className={`py-1 font-medium ${i === 0 ? 'text-left' : 'text-right pr-2'} ${i === headers.length - 1 ? 'pr-0' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(() => {
            // Data rows are keyed by `${currentGroup}-${row.key}`, not array index: in a
            // grouped table the same row key can legitimately repeat across groups (e.g.
            // the "FLAG" pattern appears as its own sub-row under every asset that
            // produced a Flag signal), which produced React's "two children with the
            // same key" warning when r.row.key (bare pattern code, no group scoping) was
            // used directly. `rows` is a flat sequence with group-header markers
            // interspersed (see buildGroupedBreakdownRows), so the current group's label
            // is tracked here across the iteration rather than threaded through props.
            let currentGroup = 'flat'
            return rows.map((r, i) => {
              if (r.type === 'group-header') {
                currentGroup = r.label
                return (
                  <tr key={`gh-${i}`} style={trStyle}>
                    <td colSpan={headers.length} className="pt-3 pb-1 font-semibold text-[8.5pt] border-b border-black/20">
                      {r.label}
                    </td>
                  </tr>
                )
              }
              if (r.type === 'subtotal') {
                return (
                  <tr key={`st-${currentGroup}`} className="border-b border-black/20 bg-black/[0.04] font-medium" style={trStyle}>
                    <td className="py-1 pr-2">{r.row.label} Subtotal</td>
                    {showAssetClass && <td className="py-1 pr-2" />}
                    <DataCells row={r.row} />
                  </tr>
                )
              }
              if (r.type === 'grand-total') {
                return (
                  <tr key="gt" className="border-t-2 border-black/60 font-semibold" style={trStyle}>
                    <td className="py-1.5 pr-2">{r.row.label}</td>
                    {showAssetClass && <td className="py-1.5 pr-2" />}
                    <DataCells row={r.row} />
                  </tr>
                )
              }
              const low = r.lowSample === true
              return (
                <tr key={`d-${currentGroup}-${r.row.key}`} className={`border-b border-black/5 ${low ? 'bg-black/[0.05]' : ''}`} style={trStyle}>
                  {/* No truncate here (unlike AttributionTable) -- pattern names run far
                      longer than market symbols ("Sym. Triangle (Bull Continuation)" etc.),
                      and clipping them with an ellipsis is exactly the kind of "nothing is
                      clipped" bug this component exists to avoid. Wraps to a second line
                      instead; break-inside:avoid on the <tr> (trStyle) still keeps a wrapped
                      row from splitting across a page boundary. */}
                  <td className="py-1 pr-2 break-words">
                    {r.row.label}
                    {low && <span className="ml-1 text-black/45 font-normal whitespace-nowrap">(low sample)</span>}
                  </td>
                  {showAssetClass && <td className="py-1 pr-2 text-right text-black/60">{r.assetClass ?? ''}</td>}
                  <DataCells row={r.row} />
                </tr>
              )
            })
          })()}
        </tbody>
      </table>
      {lowSampleThreshold !== undefined && (
        <p className="text-[7pt] text-black/50 mt-1">
          Rows shaded grey and marked (low sample) have fewer than {lowSampleThreshold} trades -- shown, not excluded, but too thin a sample to read as a reliable signal.
        </p>
      )}
    </div>
  )
}

// Builds the row sequence for a two-level grouped breakdown (group header -> its rows,
// sorted by Total R desc -> group subtotal), ending in a single grand-total row.
// `groupLabel` is used as the per-row "Asset Class" column value when showAssetClass
// is passed to FullBreakdownTable; omit it (undefined) for a grouping dimension that
// isn't itself an asset class (e.g. Patterns' Asset x Pattern table, grouped by asset).
export function buildGroupedBreakdownRows(
  groups: FullBreakdownGroup[],
  grandTotal: FullBreakdownRow,
  options?: { rowGroupLabelAsAssetClass?: boolean; lowSampleThreshold?: number },
): BreakdownTableRow[] {
  const rows: BreakdownTableRow[] = []
  for (const g of groups) {
    rows.push({ type: 'group-header', label: g.groupLabel })
    for (const row of g.rows) {
      rows.push({
        type: 'data',
        row,
        assetClass: options?.rowGroupLabelAsAssetClass ? g.groupLabel : undefined,
        lowSample: options?.lowSampleThreshold !== undefined ? row.trades < options.lowSampleThreshold : undefined,
      })
    }
    rows.push({ type: 'subtotal', row: g.subtotal })
  }
  rows.push({ type: 'grand-total', row: grandTotal })
  return rows
}

// Flat (ungrouped) row sequence, already sorted by Total R desc by fullBreakdownBy() --
// used for the Patterns report's Pattern Summary table, which has no grouping at all.
export function buildFlatBreakdownRows(
  dataRows: FullBreakdownRow[],
  lowSampleThreshold?: number,
): BreakdownTableRow[] {
  return dataRows.map(row => ({
    type: 'data' as const,
    row,
    lowSample: lowSampleThreshold !== undefined ? row.trades < lowSampleThreshold : undefined,
  }))
}
