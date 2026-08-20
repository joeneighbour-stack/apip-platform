'use client'
import dynamic from 'next/dynamic'

// Lazy-loaded wrappers for the recharts-based components in this directory -- see
// components/analyst/LazyCharts.tsx for why this indirection exists. Only used by
// AnalyticsPage.tsx's own direct chart usage: report/PerformanceReport.tsx's copies of
// these same four components stay statically imported there on purpose (it renders
// off-screen, not display:none, specifically so recharts has real layout dimensions
// before printing -- see that file's own comment), and its whole subtree is already kept
// out of the initial bundle one level up, via AnalyticsPage.tsx's dynamic() wrap of
// ReportBuilder.

const ChartLoading = () => (
  <div className="min-h-[16rem] flex items-center justify-center text-sm text-muted-foreground">
    Loading…
  </div>
)

export const TradeStatistics = dynamic(
  () => import('./TradeStatistics').then(m => ({ default: m.TradeStatistics })),
  { ssr: false, loading: ChartLoading },
)

export const ContributionChart = dynamic(
  () => import('./ContributionChart').then(m => ({ default: m.ContributionChart })),
  { ssr: false, loading: ChartLoading },
)

export const DrawdownChart = dynamic(
  () => import('./DrawdownChart').then(m => ({ default: m.DrawdownChart })),
  { ssr: false, loading: ChartLoading },
)

export const CumulativePerformanceChart = dynamic(
  () => import('./CumulativePerformanceChart').then(m => ({ default: m.CumulativePerformanceChart })),
  { ssr: false, loading: ChartLoading },
)
