import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

// Thresholds are currently hardcoded in intelligence-engine scripts.
// This endpoint is NOT wired to model_parameters yet -- it returns a 501
// so the UI can show a clear "not available" state rather than fake success.
export async function POST(_req: Request) {
  const user = await getCurrentUser()
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json(
    { ok: false, error: 'Threshold persistence not yet implemented. Values are hardcoded in engine scripts and must be changed there directly.' },
    { status: 501 }
  )
}
