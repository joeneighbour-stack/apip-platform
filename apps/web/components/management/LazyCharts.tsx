'use client'
import dynamic from 'next/dynamic'

// Lazy-loaded wrappers for the recharts-based components in this directory -- see
// components/analyst/LazyCharts.tsx for why this indirection exists (Server Component
// consumers can't call dynamic(..., { ssr: false }) directly, but can static-import the
// already-wrapped component from a 'use client' file like this one).

const ChartLoading = () => (
  <div className="min-h-[16rem] flex items-center justify-center text-sm text-muted-foreground">
    Loading…
  </div>
)

export const TeamPerformanceGrid = dynamic(
  () => import('./TeamPerformanceGrid').then(m => ({ default: m.TeamPerformanceGrid })),
  { ssr: false, loading: ChartLoading },
)

export const ShadowMonitoringPanel = dynamic(
  () => import('./ShadowMonitoringPanel').then(m => ({ default: m.ShadowMonitoringPanel })),
  { ssr: false, loading: ChartLoading },
)
