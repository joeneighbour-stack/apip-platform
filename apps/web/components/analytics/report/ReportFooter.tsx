import { FOOTER_RISK_LINE, FCA_REGULATORY_STATEMENT } from '@/lib/compliance'

interface Props {
  pageLabel: string
}

export function ReportFooter({ pageLabel }: Props) {
  return (
    <footer className="mt-4 pt-2 border-t border-black/10 flex items-start justify-between gap-4 text-[7.5pt] text-black/60">
      <span>{FOOTER_RISK_LINE}</span>
      <span className="text-right shrink-0">{FCA_REGULATORY_STATEMENT}</span>
      <span className="shrink-0">{pageLabel}</span>
    </footer>
  )
}
