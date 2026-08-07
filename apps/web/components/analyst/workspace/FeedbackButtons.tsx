'use client'
import { useState } from 'react'

interface Props {
  opportunityId: string | null
}

type State = 'idle' | 'submitting' | 'useful' | 'not_useful' | 'error'

// Section 10 -- lightweight feedback, posted to /api/analyst/feedback and stored
// in analyst_opportunity_feedback (see migrations/045). Requires a real
// opportunity_id -- hidden entirely if one isn't available rather than silently
// no-op-ing on click.
export function FeedbackButtons({ opportunityId }: Props) {
  const [state, setState] = useState<State>('idle')
  if (!opportunityId) return null

  async function submit(feedback: 'useful' | 'not_useful') {
    setState('submitting')
    try {
      const res = await fetch('/api/analyst/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId, feedback }),
      })
      setState(res.ok ? feedback : 'error')
    } catch {
      setState('error')
    }
  }

  if (state === 'useful' || state === 'not_useful') {
    return <p className="text-[11px] text-muted-foreground">Thanks for the feedback.</p>
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground">Was this opportunity useful?</span>
      <button
        type="button"
        disabled={state === 'submitting'}
        onClick={() => submit('useful')}
        className="text-[11px] px-1.5 py-0.5 rounded border border-border hover:border-green-300 hover:bg-green-50 disabled:opacity-50"
      >
        👍 Useful
      </button>
      <button
        type="button"
        disabled={state === 'submitting'}
        onClick={() => submit('not_useful')}
        className="text-[11px] px-1.5 py-0.5 rounded border border-border hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
      >
        👎 Not useful
      </button>
      {state === 'error' && <span className="text-[11px] text-red-600">Couldn&apos;t save — try again.</span>}
    </div>
  )
}
