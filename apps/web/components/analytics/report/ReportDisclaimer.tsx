import { COMPANY_NAME, FCA_REGULATORY_STATEMENT, DISCLAIMER_PARAGRAPHS, PAST_PERFORMANCE_WARNING } from '@/lib/compliance'
import type { ReportSafeUniverse } from '@/lib/reportSanitiser'

interface Props {
  universe: ReportSafeUniverse
  showMethodology: boolean
}

// Full compliance section. Font sizes here are deliberately not smaller than the rest
// of the report -- risk/regulatory language must never be the "fine print" nobody reads.
// The methodology bullet list is user-toggleable (`showMethodology`); the FCA statement,
// disclaimer, sanctions line and past-performance warning below it are NOT -- they
// always render regardless, since the Report Builder never offers a control that could
// disable them (spec: mandatory disclosures cannot be author-edited or removed).
export function ReportDisclaimer({ universe, showMethodology }: Props) {
  return (
    <div className="text-[8.5pt] leading-relaxed text-black/80 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-black">Methodology, Risk &amp; Regulatory Information</h2>

      {showMethodology && (
        <div className="space-y-1">
          <h3 className="text-[9pt] font-semibold text-black">Methodology</h3>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>Reporting period: {universe.periodLabel}</li>
            <li>Data through: {universe.dataThrough}</li>
            <li>Number of trades: {universe.tradeCount.toLocaleString()}</li>
            <li>R (risk multiple) expresses each closed recommendation&rsquo;s result relative to its planned initial risk.</li>
            <li>Figures reflect triggered recommendations only — a recommendation must have entered the market and closed with a recorded result to contribute to performance.</li>
            <li>Recommendations that were generated but never triggered (&ldquo;expired&rdquo;) are excluded from performance calculations and reported separately under operational statistics.</li>
            <li>Maximum drawdown is measured as the largest peak-to-trough decline in cumulative realised R over the period shown.</li>
          </ul>
        </div>
      )}

      <div className="space-y-1">
        <h3 className="text-[9pt] font-semibold text-black">Regulatory Statement</h3>
        <p>{FCA_REGULATORY_STATEMENT}</p>
      </div>

      <div className="space-y-1">
        <h3 className="text-[9pt] font-semibold text-black">Disclaimer</h3>
        {DISCLAIMER_PARAGRAPHS.map((p, i) => <p key={i}>{p}</p>)}
      </div>

      <p className="font-semibold text-black">{PAST_PERFORMANCE_WARNING}</p>

      <p className="text-[7.5pt] text-black/50 pt-2 border-t border-black/10">
        © {new Date().getFullYear()} {COMPANY_NAME}. This document is confidential and intended solely for the named recipient.
      </p>
    </div>
  )
}
