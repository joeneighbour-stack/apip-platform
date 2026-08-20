import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { defaultDashboardPath } from '@/lib/auth'

export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()
  // PGRST116 ("no rows returned") just means this auth user has no app_users row yet --
  // the normal path into the redirect below, not a failure worth logging.
  if (appUserError && appUserError.code !== 'PGRST116') {
    console.error('[RootPage] Failed to fetch app_users:', appUserError.message)
  }

  if (!appUser) {
    redirect('/login')
  }

  redirect(defaultDashboardPath(appUser.role as any))
}
