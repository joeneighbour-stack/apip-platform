import { COMPANY_NAME } from '@/lib/compliance'
import type { ReportSafeUniverse } from '@/lib/reportSanitiser'

interface Props {
  universe: ReportSafeUniverse
}

// Vector logo (public/acuity-logo-black.svg) -- extracted from the black wordmark PDF
// supplied directly for this report (no rasterisation: PyMuPDF's SVG export reproduces
// the PDF's own vector paths, so it stays crisp at any print size). Plain <img>, not
// next/image -- this component sits off-screen at all times via PerformanceReport.tsx's
// `absolute -left-[9999px]` (only flips into flow under @media print), and next/image's
// lazy-loading is keyed off viewport intersection, which off-screen content never
// triggers -- the same reasoning that component's own comment gives for why its charts
// render off-screen rather than only-on-print.
function ReportLogo() {
  return (
    <div>
      <img src="/acuity-logo-black.svg" alt={COMPANY_NAME} className="h-[20pt] w-auto" />
      <p className="text-[7pt] uppercase tracking-widest text-black/60 mt-1">{COMPANY_NAME} &middot; Performance Research</p>
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
      </div>
    </header>
  )
}
