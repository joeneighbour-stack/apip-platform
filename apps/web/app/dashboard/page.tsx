import { getCurrentUser } from '@/lib/auth'
import { defaultDashboardPath } from '@/lib/auth'
import { redirect } from 'next/navigation'

// Root dashboard router -- sends each role to their home page.
// This page must NEVER contain role-specific content; it is only a router.
// All guarded pages redirect to /login (not /dashboard) on auth failure,
// so this page is only reached by authenticated users.
export default async function DashboardRootPage() {
  const user = await getCurrentUser()
  redirect(defaultDashboardPath(user.role))
}
