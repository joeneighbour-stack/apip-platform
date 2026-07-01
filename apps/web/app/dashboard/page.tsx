import { getCurrentUser, defaultDashboardPath } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const user = await getCurrentUser()
  redirect(defaultDashboardPath(user.role))
}
