'use server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

// Service role client -- bypasses RLS for admin operations (trade override + audit log)
function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

// Regular client -- for role checks (uses the user's session)
async function createUserClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (c: { name: string; value: string; options?: any }[]) => { try { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} }
      }
    }
  )
}

export async function resolveDispute(
  disputeId: string,
  adminNote: string,
  overrideValues: Record<string, unknown>
): Promise<{ error?: string }> {
  const userClient = await createUserClient()

  // Verify caller is ADMIN
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: appUser } = await userClient
    .from('app_users')
    .select('app_user_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!appUser || (appUser as any).role !== 'ADMIN') return { error: 'Insufficient permissions' }

  // Get the dispute to find the trade_id and original values
  const { data: dispute } = await userClient
    .from('trade_disputes')
    .select('trade_id, original_values, status')
    .eq('dispute_id', disputeId)
    .single()

  if (!dispute) return { error: 'Dispute not found' }
  if ((dispute as any).status === 'RESOLVED' || (dispute as any).status === 'REJECTED') {
    return { error: 'Dispute is already closed' }
  }

  const serviceClient = createServiceClient()

  // 1. Update actual_trades with the override values
  if (Object.keys(overrideValues).length > 0) {
    const { error: tradeError } = await serviceClient
      .from('actual_trades')
      .update(overrideValues as any)
      .eq('trade_id', dispute.trade_id)
    if (tradeError) return { error: `Failed to update trade: ${tradeError.message}` }
  }

  // 2. Write to audit_events (correct table and column names)
  const { error: auditError } = await serviceClient
    .from('audit_events')
    .insert({
      actor_type: 'USER',
      actor_id: appUser.app_user_id,
      action: 'DISPUTE_RESOLVED',
      table_name: 'actual_trades',
      record_id: dispute.trade_id,
      before_value: dispute.original_values,
      after_value: overrideValues,
    })
  if (auditError) return { error: `Failed to write audit log: ${auditError.message}` }

  // 3. Update the dispute status
  const { error: disputeError } = await serviceClient
    .from('trade_disputes')
    .update({
      status: 'RESOLVED',
      admin_note: adminNote,
      override_values: overrideValues,
      resolved_by_id: appUser.app_user_id,
      resolved_at: new Date().toISOString(),
    })
    .eq('dispute_id', disputeId)

  if (disputeError) return { error: `Failed to update dispute: ${disputeError.message}` }

  revalidatePath('/dashboard/management')
  return {}
}

export async function rejectDispute(
  disputeId: string,
  adminNote: string
): Promise<{ error?: string }> {
  const userClient = await createUserClient()

  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: appUser } = await userClient
    .from('app_users')
    .select('app_user_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!appUser || !['ADMIN', 'MANAGER'].includes(appUser.role)) {
    return { error: 'Insufficient permissions' }
  }

  const serviceClient = createServiceClient()

  // Write rejection to audit_events
  const { error: auditError } = await serviceClient
    .from('audit_events')
    .insert({
      actor_type: 'USER',
      actor_id: appUser.app_user_id,
      action: 'DISPUTE_REJECTED',
      table_name: 'trade_disputes',
      record_id: disputeId,
      before_value: { status: 'OPEN' },
      after_value: { status: 'REJECTED', admin_note: adminNote },
    })
  if (auditError) console.error('Failed to write audit log:', auditError.message)

  const { error } = await serviceClient
    .from('trade_disputes')
    .update({
      status: 'REJECTED',
      admin_note: adminNote,
      resolved_by_id: appUser.app_user_id,
      resolved_at: new Date().toISOString(),
    })
    .eq('dispute_id', disputeId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/management')
  return {}
}




