import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

// Section 10 of the workspace redesign -- "was this opportunity useful", one row
// per analyst per opportunity, upserted so clicking the other button just changes
// the analyst's mind. ANALYST-only: this is the analyst's own signal about their
// own recommendation, not something another role should be able to write.
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST' || !user.analystId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { opportunityId, feedback } = await req.json()
  if (!opportunityId || !['useful', 'not_useful'].includes(feedback)) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
  }

  const supabase = await createClient()
  // as any: analyst_opportunity_feedback is a brand-new table (migrations/045) not yet
  // in the generated Supabase types -- same "insert payload infers as never" pattern as
  // every other untyped-schema insert/upsert call in this codebase.
  const { error } = await supabase
    .from('analyst_opportunity_feedback')
    .upsert(
      { opportunity_id: opportunityId, analyst_id: user.analystId, feedback } as any,
      { onConflict: 'analyst_id,opportunity_id' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
