import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AnalystSettings } from '@/components/analyst/AnalystSettings'

export default async function AnalystSettingsPage() {
  const user = await getCurrentUser()
  if (user.role !== 'ANALYST') redirect('/login')
  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-xl font-semibold">Account Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and password</p>
      </div>
      <AnalystSettings email={user.email ?? ''} />
    </div>
  )
}
