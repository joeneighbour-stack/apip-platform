import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

// Research dashboard -- redirects to Analytics as the primary view.
// Future: pattern analysis, AI tooling, PDF report generation.
export default async function ResearchDashboardPage() {
  const user = await getCurrentUser()
  if (!['RESEARCH', 'ADMIN'].includes(user.role)) redirect('/login')
  redirect('/dashboard/analytics')
}
