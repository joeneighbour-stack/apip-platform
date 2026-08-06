import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AnalystProfileContent } from '@/components/analyst/AnalystProfileContent'

interface PageProps {
  params: Promise<{ analystId: string }>
}

// Full profile (recommendations, KPIs, performance breakdown, coaching compliance,
// trade log) -- kept available for management via the "Full profile ↗" link on the
// KPI-only view at /dashboard/management/analyst/[analystId], which is the default now.
export default async function AnalystFullProfilePage({ params }: PageProps) {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const { analystId } = await params

  return (
    <AnalystProfileContent
      analystId={analystId}
      subtitle="Full analyst profile — management view"
      backHref="/dashboard/management"
      backLabel="Back to Management"
      mode="full"
    />
  )
}
