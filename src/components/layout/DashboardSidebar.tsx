'use client'

import { useMemo } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useProfile } from '@/hooks/useProfile'
import {
  LayoutDashboard,
  FileText,
  FolderKanban,
  CheckCircle,
  Bookmark,
  BarChart3,
  Globe,
  Palette,
} from 'lucide-react'

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
  /** Hide entirely (for surfaces parked until later — keeps the import warm). */
  hidden?: boolean
  /**
   * Visual tone. `subdued` adds a subtle primary-tinted gradient to the
   * resting state so a section reads as a subordinate "tools" group
   * without losing the active-state hierarchy.
   */
  tone?: 'default' | 'subdued'
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

// Main section - Briefings, Brand World (hidden until ready), Projects, Review.
// Product moved to its own subsection below; Brand World is parked.
const mainNavItems: NavItem[] = [
  {
    title: 'Briefings',
    href: '/briefings',
    icon: FileText,
  },
  {
    title: 'Brand World',
    href: '/brand-world',
    icon: Globe,
    adminOnly: true,
    hidden: true,
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

// Tools subsection — sits between two dividers as its own visual group.
// Distinct tone signals "subordinate workflow tools" without competing
// with the main nav for attention.
const toolsNavItems: NavItem[] = [
  {
    title: 'Product',
    href: '/product',
    icon: Palette,
    tone: 'subdued',
  },
]

// Bottom section — Bookmarks lives below its own divider.
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
  const { data: profile } = useProfile()
  const isAdmin = profile?.role === 'admin'

  const isVisible = (item: NavItem) =>
    !item.hidden && (!item.adminOnly || isAdmin)

  const visibleMainNavItems = useMemo(
    () => mainNavItems.filter(isVisible),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin]
  )
  const visibleToolsNavItems = useMemo(
    () => toolsNavItems.filter(isVisible),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin]
  )

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/'
    }
    return pathname.startsWith(href)
  }

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href)
    const subdued = item.tone === 'subdued'
    return (
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
          active
            ? 'bg-primary text-primary-foreground shadow-sm'
            : subdued
            ? // Resting state for subordinate "tools" — soft primary-tinted
              // gradient so the row reads distinct from the main nav without
              // competing with the active-state hierarchy.
              'text-foreground/80 hover:text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
        )}
        style={
          !active && subdued
            ? {
                backgroundImage:
                  'linear-gradient(135deg, color-mix(in oklch, hsl(var(--primary)) 8%, transparent) 0%, color-mix(in oklch, hsl(var(--primary)) 3%, transparent) 100%)',
              }
            : undefined
        }
      >
        <item.icon
          className={cn(
            'h-4 w-4',
            active
              ? 'text-primary-foreground'
              : subdued
              ? 'text-primary/85'
              : ''
          )}
        />
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

        {/* Divider — separates dashboard from main work surfaces */}
        <div className="my-3 h-px bg-border/50" />

        {/* Main Section — Briefings, Projects, Review */}
        <div className="space-y-1">
          {visibleMainNavItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>

        {/* Divider — separates main nav from tooling subsection */}
        {visibleToolsNavItems.length > 0 && (
          <>
            <div className="my-3 h-px bg-border/50" />
            <div className="space-y-1">
              {visibleToolsNavItems.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          </>
        )}

        {/* Divider — separates tools from bookmarks */}
        <div className="my-3 h-px bg-border/50" />

        {/* Bookmarks */}
        <div className="space-y-1">
          {secondaryNavItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>
      </nav>
    </aside>
  )
}

