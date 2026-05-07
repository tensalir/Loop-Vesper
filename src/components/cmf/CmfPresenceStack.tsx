'use client'

import { useProfile } from '@/hooks/useProfile'
import {
  useCmfMembership,
  useCmfPacketPresence,
} from '@/hooks/useCmfCollab'
import { CmfPersonAvatar } from './CmfPersonAvatar'
import { cn } from '@/lib/utils'

interface CmfPresenceStackProps {
  packetId: string | null
  onClick?: () => void
}

/**
 * Live avatar cluster shown in the workspace header. Combines:
 *   - Local user (always first, with a subtle "you" hint)
 *   - Other live presences from Supabase Realtime
 *   - Static members not currently online (faded)
 *
 * Click jumps to the members dialog where roles can be managed.
 */
export function CmfPresenceStack({ packetId, onClick }: CmfPresenceStackProps) {
  const { data: profile } = useProfile()
  const { data: membership } = useCmfMembership(packetId)
  const presence = useCmfPacketPresence({
    packetId,
    userId: profile?.id ?? null,
    displayName: profile?.displayName ?? profile?.username ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
  })

  if (!packetId) return null

  const liveIds = new Set(presence.map((p) => p.userId))
  const ownerId = membership?.owner?.id

  // Build the list: owner + members, with "live" flag annotated.
  const everyone = [
    ...(membership?.owner ? [{ ...membership.owner, role: 'owner' as const }] : []),
    ...(membership?.members ?? []).map((m) => ({ ...m.user, role: m.role })),
  ]

  // Filter out the local user; we render them separately.
  const others = everyone.filter((p) => p.id !== profile?.id)

  // Show up to 4 avatars, then a "+N" pill.
  const visible = others.slice(0, 4)
  const overflow = Math.max(0, others.length - visible.length)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group inline-flex items-center gap-2 rounded-full border border-border/40 bg-card/40 backdrop-blur-sm px-2 py-1.5',
        'hover:border-border/70 hover:bg-card/60 transition-colors'
      )}
      title="Manage members"
    >
      {profile && (
        <CmfPersonAvatar
          person={profile}
          size="sm"
          live
          className="ring-2 ring-background"
        />
      )}
      <div className="flex items-center -space-x-1.5">
        {visible.map((person) => (
          <CmfPersonAvatar
            key={person.id}
            person={person}
            size="sm"
            live={liveIds.has(person.id)}
            className={cn(
              'ring-2 ring-background',
              !liveIds.has(person.id) && 'opacity-60'
            )}
          />
        ))}
        {overflow > 0 && (
          <span
            className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-border/60 bg-background text-[10px] font-semibold text-muted-foreground ring-2 ring-background"
            style={{ marginLeft: '-6px' }}
          >
            +{overflow}
          </span>
        )}
      </div>
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground/80 px-1">
        {presence.length > 0
          ? `${presence.length + 1} live`
          : `${others.length + 1} ${others.length === 0 ? 'member' : 'members'}`}
      </span>
    </button>
  )
}
