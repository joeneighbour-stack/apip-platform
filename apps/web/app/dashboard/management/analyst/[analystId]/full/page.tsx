import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AnalystProfileContent } from '@/components/analyst/AnalystProfileContent'

interface PageProps {
  params: Promise<{ analystId: string }>
}

// Full performance history (KPIs, performance breakdown, coaching compliance) -- kept
// available for management via the "Performance history ↗" link on the KPI-only view
// at /dashboard/management/analyst/[analystId], which is the default now. Today's
// Recommendations and the trade log were dropped from this view -- both are redundant
// with the analyst workspace and the management Monitor tab respectively.
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
