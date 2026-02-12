'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SpendingTracker } from '@/components/navbar/SpendingTracker'
import { GeminiRateLimitTracker } from '@/components/navbar/GeminiRateLimitTracker'
import { createClient } from '@/lib/supabase/client'
import {
  Sun,
  Moon,
  LogOut,
  Menu,
  LayoutDashboard,
  FolderKanban,
  CheckCircle,
  Bookmark,
  Settings,
  X,
  BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface DashboardHeaderProps {
  className?: string
}

const mobileNavItems = [
  { title: 'Dashboard', href: '/', icon: LayoutDashboard },
  { title: 'Analytics', href: '/analytics', icon: BarChart3 },
  { title: 'Projects', href: '/projects', icon: FolderKanban },
  { title: 'Review', href: '/review', icon: CheckCircle },
  { title: 'Bookmarks', href: '/bookmarks', icon: Bookmark },
  { title: 'Settings', href: '/settings', icon: Settings },
]

export function DashboardHeader({ className }: DashboardHeaderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [isAdmin, setIsAdmin] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Initialize theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
    if (savedTheme) {
      setTheme(savedTheme)
      document.documentElement.classList.toggle('dark', savedTheme === 'dark')
    }
  }, [])

  // Check admin status
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const response = await fetch('/api/profile')
        if (response.ok) {
          const profile = await response.json()
          setIsAdmin(profile.role === 'admin')
        }
      } catch (error) {
        console.error('Failed to check admin status:', error)
      }
    }
    checkAdmin()
  }, [])

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <>
      <header
        className={cn(
          'h-16 flex items-center justify-between px-4 md:px-6 border-b border-border/50 bg-card/50 backdrop-blur-sm',
          className
        )}
      >
        {/* Mobile menu button + logo */}
        <div className="flex items-center gap-3 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Link href="/" className="flex items-center">
            <img
              src="/images/Loop-Vesper-White.svg"
              alt="Loop Vesper"
              className="h-4 dark:block hidden"
            />
            <img
              src="/images/Loop-Vesper-Black.svg"
              alt="Loop Vesper"
              className="h-4 dark:hidden block"
            />
          </Link>
        </div>

        {/* Desktop: Page title placeholder (can be used for breadcrumbs later) */}
        <div className="hidden md:block" />

        {/* Right side actions */}
        <div className="flex items-center gap-1">
          <GeminiRateLimitTracker isAdmin={isAdmin} />
          <SpendingTracker isAdmin={isAdmin} />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-9 w-9 transition-transform hover:rotate-12"
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
          </Button>
          <Link href="/settings">
            <Button
              variant="ghost"
              size="icon"
              title="Settings"
              className="h-9 w-9"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            title="Sign out"
            className="h-9 w-9"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Mobile navigation drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          
          {/* Drawer */}
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-card border-r border-border shadow-xl">
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-4 border-b border-border/50">
              <Link href="/" onClick={() => setMobileMenuOpen(false)}>
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
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Nav items */}
            <nav className="p-4 space-y-1">
              {mobileNavItems.map((item) => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </Link>
                )
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  )
}

