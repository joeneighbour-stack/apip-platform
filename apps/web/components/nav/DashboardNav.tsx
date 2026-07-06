import Link from 'next/link'
import type { AppRole } from '@/lib/auth'

interface NavItem {
  href: string
  label: string
  roles: AppRole[]
}

const NAV_ITEMS: NavItem[] = [
  // Phase 1.7 -- operational daily workflow
  { href: '/dashboard/analyst',             label: 'My Workspace',   roles: ['ANALYST'] },
  { href: '/dashboard/analyst/performance', label: 'My Performance', roles: ['ANALYST'] },
  { href: '/dashboard/analyst/availability',label: 'My Availability',roles: ['ANALYST'] },
  { href: '/dashboard/management',             label: 'Management',      roles: ['MANAGER', 'ADMIN'] },
  { href: '/dashboard/management/performance', label: 'Team Performance', roles: ['MANAGER', 'ADMIN'] },
  { href: '/dashboard/analytics',              label: 'Analytics',        roles: ['MANAGER', 'ADMIN', 'EXECUTIVE'] },
  { href: '/dashboard/opportunities', label: 'Opportunities',      roles: ['ANALYST', 'MANAGER', 'ADMIN'] },
  // Phase 2+ -- not built yet, listed for nav completeness
  // { href: '/dashboard/executive',  label: 'Overview',            roles: ['EXECUTIVE', 'MANAGER', 'ADMIN'] },
  // { href: '/dashboard/shadow',     label: 'Shadow Monitoring',   roles: ['MANAGER', 'RESEARCH', 'ADMIN'] },
  // { href: '/dashboard/research',   label: 'Research',            roles: ['RESEARCH', 'ADMIN'] },
  // { href: '/dashboard/admin',      label: 'Admin',               roles: ['ADMIN'] },
]

interface NavProps {
  role: AppRole
  displayName: string
}

export function DashboardNav({ role, displayName }: NavProps) {
  const visibleItems = NAV_ITEMS.filter(item => item.roles.includes(role))

  return (
    <nav className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
      <div className="flex items-center gap-8">
        <span className="font-semibold text-sm tracking-tight text-foreground">APIP</span>
        <div className="flex items-center gap-1">
          {visibleItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{displayName}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
          {role}
        </span>
      </div>
    </nav>
  )
}
