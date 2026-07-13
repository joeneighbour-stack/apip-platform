import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

// Executive dashboard -- redirects to Team Performance as the primary view.
// Analytics is accessible via nav. Future: dedicated executive summary page.
export default async function ExecutiveDashboardPage() {
  const user = await getCurrentUser()
  if (!['EXECUTIVE', 'ADMIN'].includes(user.role)) redirect('/login')
  redirect('/dashboard/management/performance')
}
