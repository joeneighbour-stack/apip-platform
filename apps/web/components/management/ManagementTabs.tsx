'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  overview: ReactNode
  monitor: ReactNode
}

// Simple two-tab switcher for the management page -- the inactive tab is unmounted
// rather than hidden via CSS, so the Monitor tab's (potentially large) trade table
// isn't sitting in the DOM while the Overview tab is showing. The tradeoff is that
// Monitor's own analyst-filter selection resets on tab switch, which is an acceptable
// cost for a page whose default view is Overview.
export function ManagementTabs({ overview, monitor }: Props) {
  const [tab, setTab] = useState<'overview' | 'monitor'>('overview')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setTab('overview')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'overview'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setTab('monitor')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'monitor'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Monitor
        </button>
      </div>
      {tab === 'overview' ? overview : monitor}
    </div>
  )
}
