import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!['ADMIN', 'MANAGER'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { marketId, active, price_data_provider, price_data_symbol } = await req.json()
  const supabase = await createClient()

  const updates: Record<string, any> = {}
  if (active !== undefined) updates.active = active
  if (price_data_provider !== undefined) updates.price_data_provider = price_data_provider
  if (price_data_symbol !== undefined) updates.price_data_symbol = price_data_symbol

  const { error } = await supabase
    .from('markets')
    .update(updates)
    .eq('market_id', marketId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
