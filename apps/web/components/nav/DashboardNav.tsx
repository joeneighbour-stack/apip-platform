'use client'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { AppRole } from '@/lib/auth'

interface NavItem {
  href: string
  label: string
  roles: AppRole[]
  icon?: typeof Settings
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard/analyst',                label: 'My Workspace',       roles: ['ANALYST'] },
  { href: '/dashboard/analyst/performance', label: 'My Performance', roles: ['ANALYST'] },
  { href: '/dashboard/analyst/monitor', label: 'My Monitor', roles: ['ANALYST'] },
  { href: '/dashboard/analyst/availability',   label: 'My Availability',    roles: ['ANALYST'] },
  { href: '/dashboard/analyst/settings',       label: 'Settings',           roles: ['ANALYST'], icon: Settings },
  { href: '/dashboard/management',             label: 'Management',         roles: ['MANAGER', 'ADMIN'] },
  { href: '/dashboard/management/performance', label: 'Team Performance',   roles: ['MANAGER', 'ADMIN', 'EXECUTIVE'] },
  { href: '/dashboard/management/shadow',      label: 'Shadow Monitoring',  roles: ['MANAGER', 'ADMIN', 'RESEARCH'] },
  { href: '/dashboard/analytics',              label: 'Analytics',          roles: ['MANAGER', 'ADMIN', 'EXECUTIVE', 'RESEARCH'] },
  { href: '/dashboard/admin',                  label: 'Admin Centre',       roles: ['ADMIN', 'MANAGER'] },
]

interface NavProps {
  role: AppRole
  displayName: string
}

async function handleSignOut() {
  const supabase = createClient()
  await supabase.auth.signOut()
  window.location.href = '/login'
}

export function DashboardNav({ role, displayName }: NavProps) {
  const visibleItems = NAV_ITEMS.filter(item => item.roles.includes(role))
  return (
    <nav className="flex items-center justify-between px-6 py-3 border-b border-border bg-card print:hidden">
      <div className="flex items-center gap-8">
        <span className="font-semibold text-sm tracking-tight text-foreground">APIP</span>
        <div className="flex items-center gap-1">
          {visibleItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {item.icon && <item.icon className="w-3.5 h-3.5" />}
              {item.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{displayName}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
          {role}
        </span>
        <button
          onClick={handleSignOut}
          className="text-sm px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}


