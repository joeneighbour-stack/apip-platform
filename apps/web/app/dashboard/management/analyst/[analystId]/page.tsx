import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AnalystProfileContent } from '@/components/analyst/AnalystProfileContent'

interface PageProps {
  params: Promise<{ analystId: string }>
}

export default async function AnalystProfilePage({ params }: PageProps) {
  const user = await getCurrentUser()
  if (!['MANAGER', 'ADMIN'].includes(user.role)) redirect('/login')

  const { analystId } = await params

  return (
    <AnalystProfileContent
      analystId={analystId}
      subtitle="KPI summary — management view"
      backHref="/dashboard/management"
      backLabel="Back to Management"
      mode="kpi-only"
    />
  )
}
