import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  // Placeholder -- thresholds are currently hardcoded in engine scripts
  // Future: write to model_parameters table
  const body = await req.json()
  console.log('[admin] Threshold update requested:', body)
  return NextResponse.json({ ok: true, note: 'Thresholds noted. Apply to engine scripts manually until model_parameters table is wired up.' })
}
