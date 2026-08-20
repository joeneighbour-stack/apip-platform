'use client'
import dynamic from 'next/dynamic'

// Lazy-loaded wrappers for the recharts-based components in this directory. The
// dynamic()/ssr:false calls have to live in a 'use client' file -- that's disallowed
// directly inside a Server Component -- but a Server Component can freely static-import
// the resulting component from here, so every consumer (server or client) just imports
// from this file instead of the original, no per-callsite dynamic() needed. ssr:false
// specifically (not just code-splitting) matters for recharts: its ResponsiveContainer
// measures via the DOM, so an SSR pass renders it at zero size before hydration fixes
// it -- skipping SSR entirely avoids that flash.

const ChartLoading = () => (
  <div className="min-h-[16rem] flex items-center justify-center text-sm text-muted-foreground">
    Loading…
  </div>
)

export const KpiSummary = dynamic(
  () => import('./KpiSummary').then(m => ({ default: m.KpiSummary })),
  { ssr: false, loading: ChartLoading },
)

export const PerformanceBreakdown = dynamic(
  () => import('./PerformanceBreakdown').then(m => ({ default: m.PerformanceBreakdown })),
  { ssr: false, loading: ChartLoading },
)
