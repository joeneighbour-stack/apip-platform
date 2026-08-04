import { COMPANY_NAME } from '@/lib/compliance'
import type { ReportSafeUniverse } from '@/lib/reportSanitiser'

interface Props {
  universe: ReportSafeUniverse
}

// Text wordmark placeholder -- no logo asset exists anywhere in the repo (verified: no
// /public dir, no SVG/PNG anywhere). Swapping in a real logo file later only means
// replacing the contents of ReportLogo, not touching layout elsewhere.
function ReportLogo() {
  return (
    <div>
      <p className="text-[15pt] font-bold tracking-tight">{COMPANY_NAME}</p>
      <p className="text-[8pt] uppercase tracking-widest text-black/60">Performance Research</p>
    </div>
  )
}

export function ReportHeader({ universe }: Props) {
  return (
    <header className="flex items-start justify-between border-b border-black/20 pb-3 mb-3">
      <ReportLogo />
      <div className="text-right">
        <p className="text-[12pt] font-semibold">{universe.title}</p>
        <p className="text-[9pt] text-black/70">{universe.subtitle}</p>
        <p className="text-[9pt] text-black/70">{universe.periodLabel}</p>
        {universe.filterSummary && <p className="text-[8pt] text-black/60 mt-0.5">{universe.filterSummary}</p>}
      </div>
    </header>
  )
}
