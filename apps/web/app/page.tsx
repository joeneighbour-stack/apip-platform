import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { defaultDashboardPath } from '@/lib/auth'

export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()

  if (!appUser) {
    redirect('/login')
  }

  redirect(defaultDashboardPath(appUser.role as any))
}
