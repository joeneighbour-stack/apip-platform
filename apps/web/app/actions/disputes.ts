'use server'
import { createServerClient } from '@supabase/ssr'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'

// Service role client -- bypasses RLS. Every mutation below (actual_trades,
// trade_disputes, audit_events) goes through this one client, not a mix of RLS-scoped
// and service-role clients -- a prior version used the RLS-scoped client for some of
// these writes, which Supabase silently no-ops when a policy blocks the row (no error,
// zero rows affected), rather than failing loudly. getCurrentUser() below still uses
// the RLS-scoped client internally (reading the caller's own session/app_users row is
// fine under RLS) -- only the trade_disputes/actual_trades/audit_events writes need to
// bypass it.
function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

export interface DisputeOverrides {
  exit_price?: number | null
  triggered?: boolean
  entry?: number | null // kept in case entry also needs correcting
}

// The single canonical dispute-resolution path. Replaces the old resolveDispute() (which
// always received an empty overrides object from its only caller, so never touched
// actual_trades) and /api/admin/disputes/resolve (which used the RLS-scoped client and
// silently wrote nothing). Both are gone; this is the only way to resolve a dispute now.
export async function resolveDispute(
  disputeId: string,
  adminNote: string,
  overrides: DisputeOverrides
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser()
  if (!['ADMIN', 'MANAGER'].includes(user.role)) {
    return { success: false, error: 'Insufficient permissions' }
  }
  if (!adminNote.trim()) {
    return { success: false, error: 'Admin note is required' }
  }

  const serviceClient = createServiceClient()

  // 1. Load the dispute, its current admin_note (may already hold a "raised on behalf
  // of" attribution note from raiseDispute() -- see below), and the trade it's about.
  // stop/direction are needed here (not just entry/triggered/result_r) because result_r
  // is no longer taken directly from the caller -- it's computed server-side from
  // exit_price + entry + stop + direction, the same way a manager's typed exit price
  // is never trusted as a pre-computed R from the client.
  const { data: dispute, error: loadError } = await serviceClient
    .from('trade_disputes')
    .select('trade_id, status, admin_note, trade:trade_id ( result_r, triggered, entry, stop, direction )')
    .eq('dispute_id', disputeId)
    .single()

  if (loadError || !dispute) return { success: false, error: 'Dispute not found' }
  if (dispute.status === 'RESOLVED' || dispute.status === 'REJECTED') {
    return { success: false, error: 'Dispute is already closed' }
  }

  const trade = dispute.trade as unknown as {
    result_r: number | null; triggered: boolean; entry: number | null; stop: number | null; direction: string
  } | null
  const hasOverrides = Object.keys(overrides).length > 0
  let overrideValuesForAudit: Record<string, unknown> | null = null

  // 2. If overrides were provided, snapshot the original values, compute the resulting R
  // from the exit price (if any), and apply to actual_trades before touching the
  // dispute's own status.
  if (hasOverrides && trade) {
    const original = {
      result_r: trade.result_r,
      triggered: trade.triggered,
      entry: trade.entry,
    }

    // entry can be corrected alongside the outcome (e.g. WRONG_ENTRY disputes) -- if it
    // is, the R calculation below uses the corrected value, not the stale one on file,
    // so the persisted result_r stays consistent with the persisted entry.
    const effectiveEntry = overrides.entry ?? trade.entry

    let computedResultR: number | null = trade.result_r
    if (overrides.triggered === false) {
      // Untriggered trades don't have a result -- if triggered is explicitly being set
      // to false, clear result_r regardless of what else was passed in.
      computedResultR = null
    } else if (overrides.exit_price != null && effectiveEntry != null && trade.stop != null) {
      const riskDistance = Math.abs(effectiveEntry - trade.stop)
      computedResultR = riskDistance > 0
        ? (trade.direction === 'BUY'
            ? (overrides.exit_price - effectiveEntry) / riskDistance
            : (effectiveEntry - overrides.exit_price) / riskDistance)
        : null
    }

    const tradeUpdate: { triggered?: boolean; result_r: number | null; entry?: number | null } = {
      triggered: overrides.triggered,
      result_r: computedResultR,
      entry: overrides.entry,
    }

    const { error: tradeError } = await serviceClient
      .from('actual_trades')
      .update(tradeUpdate)
      .eq('trade_id', dispute.trade_id)
    if (tradeError) return { success: false, error: `Failed to update trade: ${tradeError.message}` }

    overrideValuesForAudit = {
      exit_price: overrides.exit_price ?? null,
      computed_result_r: computedResultR,
      triggered: overrides.triggered,
      ...(overrides.entry != null ? { entry: overrides.entry } : {}),
    }

    const { error: valuesError } = await serviceClient
      .from('trade_disputes')
      .update({ original_values: original, override_values: overrideValuesForAudit })
      .eq('dispute_id', disputeId)
    if (valuesError) return { success: false, error: `Failed to record override: ${valuesError.message}` }
  }

  // 3. Resolve the dispute. If admin_note already holds a raise-time "on behalf of" note
  // (see raiseDispute()), append rather than overwrite it -- otherwise that attribution
  // is lost the moment a resolution note is added.
  const combinedNote = dispute.admin_note ? `${dispute.admin_note}\n\n${adminNote}` : adminNote

  const { error: resolveError } = await serviceClient
    .from('trade_disputes')
    .update({
      status: 'RESOLVED',
      admin_note: combinedNote,
      resolved_by_id: user.appUserId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('dispute_id', disputeId)

  if (resolveError) return { success: false, error: `Failed to update dispute: ${resolveError.message}` }

  // 4. Audit log -- best-effort, doesn't fail the resolution if it errors.
  const { error: auditError } = await serviceClient
    .from('audit_events')
    .insert({
      actor_type: 'USER',
      actor_id: user.appUserId,
      action: 'RESOLVE_DISPUTE',
      table_name: 'trade_disputes',
      record_id: disputeId,
      after_value: { admin_note: adminNote, overrides: overrideValuesForAudit ?? overrides },
    })
  if (auditError) console.error('Failed to write audit log:', auditError.message)

  // 5. KPI recalculation -- the subprocess-based trigger (spawn with shell: true) failed
  // on Railway because /bin/sh isn't at the expected path there. KPIs are weekly figures,
  // so rather than fixing the subprocess, recalculation is simply left to the existing
  // Monday scheduled job instead of being triggered synchronously from here.
  if (hasOverrides) console.log('KPI recalculation will run on next scheduled Monday job')

  revalidatePath('/dashboard/management')

  return { success: true }
}

export async function rejectDispute(
  disputeId: string,
  adminNote: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser()
  if (!['ADMIN', 'MANAGER'].includes(user.role)) {
    return { success: false, error: 'Insufficient permissions' }
  }
  if (!adminNote.trim()) {
    return { success: false, error: 'Admin note is required' }
  }

  const serviceClient = createServiceClient()

  const { data: dispute, error: loadError } = await serviceClient
    .from('trade_disputes')
    .select('status, admin_note')
    .eq('dispute_id', disputeId)
    .single()

  if (loadError || !dispute) return { success: false, error: 'Dispute not found' }
  if (dispute.status === 'RESOLVED' || dispute.status === 'REJECTED') {
    return { success: false, error: 'Dispute is already closed' }
  }

  const combinedNote = dispute.admin_note ? `${dispute.admin_note}\n\n${adminNote}` : adminNote

  const { error: auditError } = await serviceClient
    .from('audit_events')
    .insert({
      actor_type: 'USER',
      actor_id: user.appUserId,
      action: 'REJECT_DISPUTE',
      table_name: 'trade_disputes',
      record_id: disputeId,
      before_value: { status: dispute.status },
      after_value: { status: 'REJECTED', admin_note: adminNote },
    })
  if (auditError) console.error('Failed to write audit log:', auditError.message)

  const { error } = await serviceClient
    .from('trade_disputes')
    .update({
      status: 'REJECTED',
      admin_note: combinedNote,
      resolved_by_id: user.appUserId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('dispute_id', disputeId)

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/management')
  return { success: true }
}

// Raises a dispute for a trade. Analysts raise their own; managers/admins may raise one
// on behalf of another analyst while reviewing their trade history (TradeHistoryTable's
// Flag button, now visible to MANAGER/ADMIN too -- see that component). Moved server-side
// (was a direct client-side insert) specifically for the on-behalf-of case: trusting a
// client-supplied role/analystId for an attribution field that ends up in an audit trail
// is the same class of mistake this task's core fix (client-trust on a writer path) is
// about, so the same authority (getCurrentUser(), read server-side) decides who this
// dispute is raised for and by, not the browser.
export async function raiseDispute(
  viewedAnalystId: string,
  tradeId: string,
  disputeType: string,
  note: string,
  originalValues: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser()
  if (!['ANALYST', 'MANAGER', 'ADMIN'].includes(user.role)) {
    return { success: false, error: 'Insufficient permissions' }
  }
  if (user.role === 'ANALYST' && user.analystId !== viewedAnalystId) {
    return { success: false, error: 'Cannot raise a dispute for another analyst' }
  }

  const raisedByAnalystId = user.role === 'ANALYST' ? user.analystId! : viewedAnalystId
  const isOnBehalf = user.role !== 'ANALYST'

  const serviceClient = createServiceClient()

  let onBehalfNote: string | null = null
  if (isOnBehalf) {
    const { data: viewedAnalyst } = await serviceClient
      .from('analysts')
      .select('display_name')
      .eq('analyst_id', viewedAnalystId)
      .single()
    onBehalfNote = `Raised by ${user.displayName} on behalf of ${viewedAnalyst?.display_name ?? viewedAnalystId}.`
  }

  const { error } = await serviceClient
    .from('trade_disputes')
    .insert({
      trade_id: tradeId,
      raised_by_analyst_id: raisedByAnalystId,
      dispute_type: disputeType as any,
      analyst_note: note.trim() || null,
      original_values: originalValues as any,
      status: 'OPEN',
      admin_note: onBehalfNote,
    })

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/management')
  revalidatePath('/dashboard/analyst/monitor')
  return { success: true }
}
