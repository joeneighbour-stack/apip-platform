import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export type AppRole = 'ANALYST' | 'MANAGER' | 'EXECUTIVE' | 'ADMIN' | 'RESEARCH'

export interface CurrentUser {
  authUserId: string
  appUserId: string
  email: string
  displayName: string
  role: AppRole
  analystId: string | null
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('app_user_id, email, display_name, role, analyst_id')
    .eq('auth_user_id', user.id)
    .single()

  if (appUserError || !appUser) redirect('/login')

  return {
    authUserId: user.id,
    appUserId: appUser.app_user_id,
    email: appUser.email,
    displayName: appUser.display_name,
    role: appUser.role as AppRole,
    analystId: appUser.analyst_id,
  }
}

export function defaultDashboardPath(role: AppRole): string {
  switch (role) {
    case 'ANALYST':   return '/dashboard/analyst'
    case 'MANAGER':   return '/dashboard/management'
    case 'EXECUTIVE': return '/dashboard/executive'
    case 'RESEARCH':  return '/dashboard/research'
    case 'ADMIN':     return '/dashboard/admin'
  }
}
