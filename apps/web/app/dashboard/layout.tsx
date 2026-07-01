import { getCurrentUser } from '@/lib/auth'
import { DashboardNav } from '@/components/nav/DashboardNav'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // getCurrentUser redirects to /login if not authenticated.
  // Every dashboard page is protected -- no extra guards needed in child pages.
  const user = await getCurrentUser()

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardNav role={user.role} displayName={user.displayName} />
      <main className="flex-1 px-6 py-6 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  )
}
