'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  FileText,
  FolderKanban,
  CheckCircle,
  Bookmark,
  BarChart3,
} from 'lucide-react'

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

// Top section - Dashboard and Analytics
const topNavItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    title: 'Analytics',
    href: '/analytics',
    icon: BarChart3,
  },
]

// Main section - Briefings, Projects, Review
const mainNavItems: NavItem[] = [
  {
    title: 'Briefings',
    href: '/briefings',
    icon: FileText,
  },
  {
    title: 'Projects',
    href: '/projects',
    icon: FolderKanban,
  },
  {
    title: 'Review',
    href: '/review',
    icon: CheckCircle,
  },
]

// Below divider - Bookmarks
const secondaryNavItems: NavItem[] = [
  {
    title: 'Bookmarks',
    href: '/bookmarks',
    icon: Bookmark,
  },
]

interface DashboardSidebarProps {
  className?: string
}

export function DashboardSidebar({ className }: DashboardSidebarProps) {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/'
    }
    return pathname.startsWith(href)
  }

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href)
    return (
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
          active
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
        )}
      >
        <item.icon className={cn('h-4 w-4', active ? 'text-primary-foreground' : '')} />
        <span>{item.title}</span>
      </Link>
    )
  }

  return (
    <aside
      className={cn(
        'hidden md:flex w-64 flex-col border-r border-border/50 bg-card/50 backdrop-blur-sm',
        className
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-border/50">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img
            src="/images/Loop-Vesper-White.svg"
            alt="Loop Vesper"
            className="h-5 dark:block hidden"
          />
          <img
            src="/images/Loop-Vesper-Black.svg"
            alt="Loop Vesper"
            className="h-5 dark:hidden block"
          />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 flex flex-col">
        {/* Dashboard & Analytics */}
        <div className="space-y-1">
          {topNavItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>

        {/* Divider */}
        <div className="my-3 h-px bg-border/50" />

        {/* Main Section - Briefings, Projects, Review */}
        <div className="space-y-1">
          {mainNavItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>

        {/* Divider */}
        <div className="my-3 h-px bg-border/50" />

        {/* Secondary - Bookmarks */}
        <div className="space-y-1">
          {secondaryNavItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>
      </nav>
    </aside>
  )
}

