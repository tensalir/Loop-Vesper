'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/navbar/Navbar'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { LogOut, Moon, Settings, Sun } from 'lucide-react'

/**
 * Page chrome for /product/* routes. Mirrors the floating-Navbar pattern
 * used by /projects/[id]: no dashboard sidebar, no full-width header, just a
 * pill nav floating top-center and lightweight theme/account controls
 * pinned top-right. The page below is full-bleed so the CMF pipeline can
 * own the visual rhythm.
 */
export function ProductChrome({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const supabase = createClient()
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    const saved = localStorage.getItem('theme') as 'light' | 'dark' | null
    if (saved) {
      setTheme(saved)
      document.documentElement.classList.toggle('dark', saved === 'dark')
    }
  }, [])

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem('theme', next)
    document.documentElement.classList.toggle('dark', next === 'dark')
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-background relative">
      {/* Atmosphere — a quiet radial wash that hints at the brand without
          calling attention to itself. The CMF pipeline is the centerpiece. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'radial-gradient(120% 80% at 50% -10%, hsl(var(--primary) / 0.10), transparent 55%), radial-gradient(80% 60% at 100% 100%, hsl(var(--primary) / 0.06), transparent 60%)',
        }}
      />

      <Navbar theme={theme} />

      {/* Top-right utility cluster — kept tiny so it never competes with
          the pipeline. Account / theme only; no sidebar duplicates here. */}
      <div className="fixed top-4 right-4 z-40 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="h-9 w-9 rounded-full bg-background/40 backdrop-blur-sm border border-border/40"
          title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {theme === 'light' ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/settings')}
          className="h-9 w-9 rounded-full bg-background/40 backdrop-blur-sm border border-border/40"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={signOut}
          className="h-9 w-9 rounded-full bg-background/40 backdrop-blur-sm border border-border/40"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Reserve top space for the floating navbar */}
      <main className="pt-24 pb-16 px-4 md:px-8">{children}</main>
    </div>
  )
}
