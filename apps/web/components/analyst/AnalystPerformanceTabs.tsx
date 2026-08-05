'use client'
import { useState } from 'react'
import { AnalystKpiSummary } from './AnalystKpiSummary'
import { AnalyticsPage } from '@/components/analytics/AnalyticsPage'

type Tab = 'MY_KPIS' | 'MY_PERFORMANCE'

type KpiSummaryProps = React.ComponentProps<typeof AnalystKpiSummary>
type AnalyticsPageProps = React.ComponentProps<typeof AnalyticsPage>

interface Props {
  kpiSummaryProps: KpiSummaryProps
  analyticsProps: AnalyticsPageProps
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'MY_KPIS', label: 'My KPIs' },
  { key: 'MY_PERFORMANCE', label: 'My Performance' },
]

// My Performance is only mounted once selected -- AnalyticsPage fires its own data fetch
// on mount, and there's no reason to pay for that on a page load that never visits the tab.
export function AnalystPerformanceTabs({ kpiSummaryProps, analyticsProps }: Props) {
  const [tab, setTab] = useState<Tab>('MY_KPIS')

  return (
    <div className="space-y-6">
      <div className="flex gap-2 print:hidden">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              tab === t.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:border-primary/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'MY_KPIS' ? (
        <AnalystKpiSummary {...kpiSummaryProps} />
      ) : (
        <AnalyticsPage {...analyticsProps} />
      )}
    </div>
  )
}
