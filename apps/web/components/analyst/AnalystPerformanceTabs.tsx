'use client'
import { useState } from 'react'
import { AnalyticsPage } from '@/components/analytics/AnalyticsPage'

type Tab = 'MY_KPIS' | 'MY_PERFORMANCE'

type AnalyticsPageProps = React.ComponentProps<typeof AnalyticsPage>

interface Props {
  // AnalystProfileContent is an async server component -- it can't be imported and
  // rendered from inside this 'use client' file, so the parent server component renders
  // it and passes the resulting node down instead (same pattern as ReportBuilder/
  // PerformanceReport in AnalyticsPage.tsx).
  myKpisTab: React.ReactNode
  analyticsProps: AnalyticsPageProps
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'MY_KPIS', label: 'My KPIs' },
  { key: 'MY_PERFORMANCE', label: 'My Performance' },
]

// My Performance is only mounted once selected -- AnalyticsPage fires its own data fetch
// on mount, and there's no reason to pay for that on a page load that never visits the tab.
// My KPIs has no such cost: it was already rendered server-side before this component
// mounted, so toggling it is free either way.
export function AnalystPerformanceTabs({ myKpisTab, analyticsProps }: Props) {
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

      <div className={tab === 'MY_KPIS' ? '' : 'hidden'}>{myKpisTab}</div>
      {tab === 'MY_PERFORMANCE' && <AnalyticsPage {...analyticsProps} />}
    </div>
  )
}
