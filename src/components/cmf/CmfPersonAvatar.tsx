'use client'

import { cn } from '@/lib/utils'
import type { CmfPersonRef } from '@/hooks/useCmfCollab'

interface CmfPersonAvatarProps {
  person: Pick<CmfPersonRef, 'displayName' | 'username' | 'avatarUrl'> | { displayName: string | null; avatarUrl: string | null; username?: string | null }
  size?: 'xs' | 'sm' | 'md'
  className?: string
  /** Renders a thin halo to indicate live presence. */
  live?: boolean
}

/**
 * Compact avatar used by the members list, presence stack, comment threads,
 * and activity feed. Falls back to coloured initials when no avatar URL is
 * present so a person is always recognisable at a glance.
 */
export function CmfPersonAvatar({ person, size = 'sm', className, live }: CmfPersonAvatarProps) {
  const sizes = {
    xs: 'h-5 w-5 text-[9px]',
    sm: 'h-7 w-7 text-[10px]',
    md: 'h-9 w-9 text-xs',
  } as const

  const label = person.displayName?.trim() || person.username?.trim() || '·'
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('') || '·'

  // Stable color from a hash of the label so the same person always gets the
  // same tint; saves us from designing a palette of 12 avatars.
  const hash = Array.from(label).reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const hue = hash % 360

  return (
    <span
      className={cn(
        'relative inline-flex items-center justify-center rounded-full border border-border/60 bg-background overflow-hidden flex-shrink-0',
        sizes[size],
        className
      )}
      style={{
        backgroundColor: person.avatarUrl
          ? undefined
          : `color-mix(in oklch, hsl(${hue} 70% 60%) 22%, hsl(var(--card)))`,
        color: person.avatarUrl ? undefined : `hsl(${hue} 70% 35%)`,
      }}
      title={label}
    >
      {person.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={person.avatarUrl}
          alt={label}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="font-semibold leading-none tracking-wider">{initials}</span>
      )}
      {live && (
        <span
          aria-hidden
          className="absolute -inset-0.5 rounded-full pointer-events-none"
          style={{
            boxShadow: `0 0 0 2px hsl(var(--background)), 0 0 0 3px hsl(var(--primary))`,
          }}
        />
      )}
    </span>
  )
}
