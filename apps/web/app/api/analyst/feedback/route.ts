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
  // (supabase as any): migrations/045_analyst_opportunity_feedback.sql defines this
  // table, but it has never actually been applied to the live database (confirmed
  // via PostgREST schema introspection -- the table genuinely does not exist yet,
  // not just a stale-types gap). This call will fail at runtime with a real
  // PostgREST "schema cache" error until that migration is run. Escaping the whole
  // client (not just the payload) because .from()'s own table-name argument -- not
  // just the upsert payload -- fails to type-check against a table absent from
  // types/database.ts.
  const { error } = await (supabase as any)
    .from('analyst_opportunity_feedback')
    .upsert(
      { opportunity_id: opportunityId, analyst_id: user.analystId, feedback },
      { onConflict: 'analyst_id,opportunity_id' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
