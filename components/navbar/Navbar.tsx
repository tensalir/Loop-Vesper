'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FileText, FolderOpen, ClipboardCheck, Bookmark } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavbarProps {
  theme: 'light' | 'dark'
  projectId?: string
  onOpenBriefing?: () => void
  /** When true, navbar positions itself fixed in center. When false, it's just a pill (for use in a wrapper) */
  standalone?: boolean
}

export function Navbar({
  theme,
  projectId,
  onOpenBriefing,
  standalone = true,
}: NavbarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isExpanded, setIsExpanded] = useState(false)

  const navItems = [
    {
      label: 'Briefings',
      icon: FileText,
      onClick: onOpenBriefing || (() => {}),
      active: false,
    },
    {
      label: 'Projects',
      icon: FolderOpen,
      onClick: () => router.push('/projects'),
      active: pathname === '/projects',
    },
    {
      label: 'Review',
      icon: ClipboardCheck,
      onClick: () => router.push('/review'),
      active: pathname === '/review',
    },
    {
      label: 'divider',
      icon: null,
      onClick: () => {},
      active: false,
      isDivider: true,
    },
    {
      label: 'Bookmarks',
      icon: Bookmark,
      onClick: () => router.push('/bookmarks'),
      active: pathname === '/bookmarks',
      iconOnly: true,
    },
  ]

  const navContent = (
    <div 
      className={cn(
        "flex items-center h-12 px-3 rounded-lg border backdrop-blur-sm shadow-sm",
        "transition-all duration-300 ease-in-out",
        isExpanded 
          ? "bg-background/95 border-primary/60" 
          : "bg-background/40 border-primary/20"
      )}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      {/* Logo - always visible, mint green in dark mode */}
      <img
        src={theme === 'light' ? "/images/Loop-Vesper-Black.svg" : "/images/Loop-Vesper-Mint.svg"}
        alt="Loop Vesper Logo"
        className={cn(
          "h-4 object-contain cursor-pointer transition-all duration-500 ease-in-out flex-shrink-0",
          isExpanded ? "opacity-100" : "opacity-70 hover:opacity-90"
        )}
        onClick={() => router.push('/')}
        title="Back to Dashboard"
      />

      {/* Expandable section */}
      <div 
        className={cn(
          "flex items-center overflow-hidden transition-all duration-500 ease-in-out",
          isExpanded ? "max-w-[400px] opacity-100 ml-0" : "max-w-0 opacity-0 ml-0"
        )}
      >
        {/* Divider */}
        <div className={cn(
          "w-px h-6 bg-border mx-2 flex-shrink-0 transition-opacity duration-500",
          isExpanded ? "opacity-100" : "opacity-0"
        )} />

        {/* Navigation Items */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {navItems.map((item, index) => {
            // Render divider
            if (item.isDivider) {
              return (
                <div 
                  key={item.label} 
                  className={cn(
                    "w-px h-6 bg-border mx-1 flex-shrink-0 transition-opacity duration-500",
                    isExpanded ? "opacity-100" : "opacity-0"
                  )}
                />
              )
            }
            
            // Render button
            const IconComponent = item.icon
            return (
              <Button
                key={item.label}
                variant="ghost"
                size={item.iconOnly ? "icon" : "sm"}
                onClick={item.onClick}
                className={cn(
                  "font-medium rounded-md whitespace-nowrap",
                  "transition-all duration-300 ease-out",
                  item.iconOnly ? "h-8 w-8 p-0" : "h-8 px-3 gap-1.5 text-xs",
                  item.active && "bg-muted text-foreground"
                )}
                style={{
                  transitionDelay: isExpanded ? `${index * 50}ms` : '0ms'
                }}
                title={item.iconOnly ? item.label : undefined}
              >
                {IconComponent && <IconComponent className="h-3.5 w-3.5" />}
                {!item.iconOnly && <span>{item.label}</span>}
              </Button>
            )
          })}
        </div>
      </div>

      {/* Collapsed indicator - subtle hint there's more */}
      <div 
        className={cn(
          "flex items-center gap-0.5 ml-2 transition-all duration-500 ease-in-out",
          isExpanded ? "opacity-0 max-w-0" : "opacity-30 max-w-[30px]"
        )}
      >
        <span className="w-1 h-1 rounded-full bg-foreground/40" />
        <span className="w-1 h-1 rounded-full bg-foreground/40" />
        <span className="w-1 h-1 rounded-full bg-foreground/40" />
      </div>
    </div>
  )

  if (standalone) {
    return (
      <nav className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
        {navContent}
      </nav>
    )
  }

  return navContent
}

