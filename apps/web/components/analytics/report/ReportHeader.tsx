import { COMPANY_NAME } from '@/lib/compliance'
import type { ReportSafeUniverse } from '@/lib/reportSanitiser'

interface Props {
  universe: ReportSafeUniverse
}

// Vector logo, inlined directly (not an <img src="/acuity-logo-black.svg">) -- browsers
// commonly block external resource loads (including same-origin /public assets) during
// window.print(), so an <img> tag risks rendering as a blank box in the actual printed/
// saved-as-PDF output even though it displays fine on-screen beforehand. Inlining the
// same paths as real SVG markup has no such dependency: it's part of the DOM already.
// Paths copied verbatim from public/acuity-logo-black.svg (itself extracted from the
// black wordmark PDF supplied for this report via PyMuPDF's SVG export, no
// rasterisation) -- that file is kept as the source of truth/reference copy; update both
// if the logo ever changes.
function ReportLogo() {
  return (
    <div>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 290 100"
        style={{ height: '20pt', width: 'auto' }}
        aria-label={COMPANY_NAME}
      >
        <defs>
          <clipPath id="clip_1">
            <path transform="matrix(1,0,0,-1,0,100)" d="M0 100H290V0H0Z"/>
          </clipPath>
        </defs>
        <g clipPath="url(#clip_1)">
          <path transform="matrix(1,0,0,-1,73.7,69.6)" d="M0 0C-4.6 5-6.9 11.7-6.9 20-6.9 28.3-4.6 35-.1 40 4.4 45 10.7 47.5 18.9 47.5 26.3 47.5 32 45.5 36.1 41.6 40.2 37.7 42.4 32.6 42.8 26.3H29C28.7 29 27.7 31.2 25.9 32.9 24.1 34.6 21.8 35.4 18.9 35.4 11.1 35.4 7.2 30.2 7.2 19.9 7.2 9.6 11.1 4.4 18.9 4.4 21.8 4.4 24.2 5.2 25.9 6.8 27.6 8.4 28.7 10.6 29 13.3H42.8C42.4 7 40.2 1.9 36.1-1.9 32-5.8 26.4-7.7 19.1-7.7 11-7.6 4.6-5 0 0"/>
          <path transform="matrix(1,0,0,-1,129.2,71.9)" d="M0 0C-3.5 3.5-5.3 8.2-5.3 14V49H8.4V17.9C8.4 10.8 11.7 7.2 18.2 7.2 21.5 7.2 24.1 8.3 26.1 10.5 28.1 12.7 29.1 15.7 29.1 19.4V49H42.8V-4.3H30.5L29.5 1.8H29.1C25.6-2.8 20.6-5.2 13.9-5.2 8.2-5.3 3.5-3.5 0 0"/>
          <path transform="matrix(1,0,0,-1,0,100)" d="M181.5 77.1H195.2V23.8H181.5Z"/>
          <path transform="matrix(1,0,0,-1,0,100)" d="M181.5 99.2H195.2V85.799999H181.5Z"/>
          <path transform="matrix(1,0,0,-1,204.4,22.900002)" d="M0 0V16.8H13.7V0H26.6V-11.7H13.8V-34.2C13.8-36.7 14.3-38.6 15.4-39.7 16.5-40.8 18.2-41.4 20.6-41.4H26.8V-53.4H16.8C11.1-53.4 6.9-51.9 4.2-49 1.5-46.1 .1-42.1 .1-37.2V-11.7 0Z"/>
          <path transform="matrix(1,0,0,-1,274.6,22.900002)" d="M0 0-12.7-39H-13.1L-25.4 0H-39.5V-1L-21.4-53.1-20.4-55.8-27.5-75.8V-76.8H-12.8L14.8-1V0Z"/>
          <path transform="matrix(1,0,0,-1,.6,45.6)" d="M0 0 17.5-30.3 34.9 0Z" fill="#f28f25"/>
          <path transform="matrix(1,0,0,-1,26.7,.30000306)" d="M0 0-8.7-15.1H-8.6L.1-30.2H0 .1L8.8-45.3 17.5-60.4V-60.5H17.6L26.3-75.5 26.2-75.6H43.7L35-60.5 26.3-45.4V-45.3H26.2L17.5-30.3 17.6-30.2H17.5L8.8-15.2V-15.1Z"/>
        </g>
      </svg>
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
