import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export type AppRole = 'ANALYST' | 'MANAGER' | 'EXECUTIVE' | 'ADMIN' | 'RESEARCH'

export interface CurrentUser {
  authUserId: string
  email: string
  displayName: string
  role: AppRole
  analystId: string | null // null for non-analyst roles
}

/**
 * Server-only. Fetches the current authenticated user plus their role
 * from app_users. Redirects to /login if not authenticated.
 * Call this at the top of every protected server component.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('email, display_name, role, analyst_id')
    .eq('auth_user_id', user.id)
    .single()

  if (appUserError || !appUser) {
    // Authenticated but no app_users row -- account not fully set up.
    redirect('/login')
  }

  return {
    authUserId: user.id,
    email: appUser.email,
    displayName: appUser.display_name,
    role: appUser.role as AppRole,
    analystId: appUser.analyst_id,
  }
}

/**
 * Returns the default dashboard path for a given role.
 * Used by the root redirect and role-aware nav.
 */
export function defaultDashboardPath(role: AppRole): string {
  switch (role) {
    case 'ANALYST':    return '/dashboard/analyst'
    case 'MANAGER':    return '/dashboard/management'
    case 'EXECUTIVE':  return '/dashboard/executive'
    case 'RESEARCH':   return '/dashboard/research'
    case 'ADMIN':      return '/dashboard/admin'
  }
}
