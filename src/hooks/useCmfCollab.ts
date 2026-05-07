'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type CmfPacketRole = 'owner' | 'approver' | 'editor' | 'viewer'

export interface CmfPersonRef {
  id: string
  displayName: string | null
  username: string | null
  avatarUrl: string | null
}

export interface CmfPacketMember {
  id: string
  role: 'viewer' | 'editor' | 'approver'
  invitedAt: string
  acceptedAt: string | null
  user: CmfPersonRef
}

export interface CmfMembership {
  role: CmfPacketRole
  owner: CmfPersonRef | null
  members: CmfPacketMember[]
}

export interface CmfComment {
  id: string
  packetId: string
  renderId: string | null
  userId: string
  body: string
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  updatedAt: string
  user: CmfPersonRef
  resolvedByUser: CmfPersonRef | null
}

export interface CmfActivityItem {
  id: string
  packetId: string
  userId: string
  action: string
  targetId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  user: CmfPersonRef
}

export interface CmfPresenceUser {
  userId: string
  displayName: string | null
  avatarUrl: string | null
  lastSeenAt: number
}

/* ─── Membership ────────────────────────────────────────────────────────── */

export function useCmfMembership(packetId: string | null) {
  return useQuery({
    queryKey: ['cmf', 'members', packetId],
    queryFn: async (): Promise<CmfMembership> => {
      const res = await fetch(`/api/cmf/packets/${packetId}/members`)
      if (!res.ok) throw new Error('Failed to load members')
      return res.json()
    },
    enabled: Boolean(packetId),
    staleTime: 30_000,
  })
}

export function useInviteCmfMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      packetId: string
      userId?: string
      username?: string
      role?: 'viewer' | 'editor' | 'approver'
    }): Promise<CmfPacketMember> => {
      const { packetId, ...body } = args
      const res = await fetch(`/api/cmf/packets/${packetId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Invite failed')
      }
      const data = await res.json()
      return data.member as CmfPacketMember
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'members', vars.packetId] })
      queryClient.invalidateQueries({ queryKey: ['cmf', 'activity', vars.packetId] })
    },
  })
}

export function useUpdateCmfMemberRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      packetId: string
      userId: string
      role: 'viewer' | 'editor' | 'approver'
    }) => {
      const res = await fetch(
        `/api/cmf/packets/${args.packetId}/members/${args.userId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: args.role }),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Update failed')
      }
      return (await res.json()).member as CmfPacketMember
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'members', vars.packetId] })
    },
  })
}

export function useRemoveCmfMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { packetId: string; userId: string }) => {
      const res = await fetch(
        `/api/cmf/packets/${args.packetId}/members/${args.userId}`,
        { method: 'DELETE' }
      )
      if (!res.ok && res.status !== 404) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Remove failed')
      }
      return args.userId
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'members', vars.packetId] })
    },
  })
}

/* ─── Comments ──────────────────────────────────────────────────────────── */

export function useCmfComments(packetId: string | null, renderId?: string | null) {
  return useQuery({
    queryKey: ['cmf', 'comments', packetId, renderId ?? 'packet'],
    queryFn: async (): Promise<CmfComment[]> => {
      const url = new URL(
        `/api/cmf/packets/${packetId}/comments`,
        window.location.origin
      )
      if (renderId) url.searchParams.set('renderId', renderId)
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error('Failed to load comments')
      return (await res.json()).comments as CmfComment[]
    },
    enabled: Boolean(packetId),
    staleTime: 15_000,
    refetchInterval: 12_000,
  })
}

export function useCreateCmfComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { packetId: string; body: string; renderId?: string | null }) => {
      const res = await fetch(`/api/cmf/packets/${args.packetId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: args.body, renderId: args.renderId ?? undefined }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Comment failed')
      }
      return (await res.json()).comment as CmfComment
    },
    onSuccess: (comment, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['cmf', 'comments', vars.packetId, vars.renderId ?? 'packet'],
      })
      queryClient.invalidateQueries({
        queryKey: ['cmf', 'comments', vars.packetId, 'packet'],
      })
      queryClient.invalidateQueries({ queryKey: ['cmf', 'activity', vars.packetId] })
    },
  })
}

export function useResolveCmfComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { commentId: string; resolved: boolean; packetId: string; renderId: string | null }) => {
      const res = await fetch(`/api/cmf/comments/${args.commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: args.resolved }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Update failed')
      }
      return (await res.json()).comment as CmfComment
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['cmf', 'comments', vars.packetId, vars.renderId ?? 'packet'],
      })
      queryClient.invalidateQueries({
        queryKey: ['cmf', 'comments', vars.packetId, 'packet'],
      })
    },
  })
}

export function useDeleteCmfComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { commentId: string; packetId: string; renderId: string | null }) => {
      const res = await fetch(`/api/cmf/comments/${args.commentId}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 404) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Delete failed')
      }
      return args.commentId
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['cmf', 'comments', vars.packetId, vars.renderId ?? 'packet'],
      })
      queryClient.invalidateQueries({
        queryKey: ['cmf', 'comments', vars.packetId, 'packet'],
      })
    },
  })
}

/* ─── Activity ──────────────────────────────────────────────────────────── */

export function useCmfActivity(packetId: string | null) {
  return useQuery({
    queryKey: ['cmf', 'activity', packetId],
    queryFn: async (): Promise<CmfActivityItem[]> => {
      const res = await fetch(`/api/cmf/packets/${packetId}/activity`)
      if (!res.ok) throw new Error('Failed to load activity')
      return (await res.json()).items as CmfActivityItem[]
    },
    enabled: Boolean(packetId),
    staleTime: 15_000,
    refetchInterval: 15_000,
  })
}

/* ─── Realtime presence ────────────────────────────────────────────────── */

interface UseCmfPacketPresenceArgs {
  packetId: string | null
  userId: string | null
  displayName: string | null
  avatarUrl: string | null
}

/**
 * Subscribe to a Supabase Realtime presence channel keyed by packetId.
 * Returns the live list of users currently viewing this packet (excluding
 * the local user). Drops out cleanly on unmount or packet switch.
 */
export function useCmfPacketPresence({
  packetId,
  userId,
  displayName,
  avatarUrl,
}: UseCmfPacketPresenceArgs): CmfPresenceUser[] {
  const [presence, setPresence] = useState<CmfPresenceUser[]>([])
  const supabase = useMemo(() => createClient(), [])
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    cleanupRef.current?.()
    setPresence([])

    if (!packetId || !userId) return

    const channelName = `cmf-packet:${packetId}`
    const channel = supabase.channel(channelName, {
      config: { presence: { key: userId } },
    })

    const sync = () => {
      const state = channel.presenceState() as Record<string, Array<Record<string, unknown>>>
      const flat: CmfPresenceUser[] = []
      const seen = new Set<string>()
      for (const [_key, metas] of Object.entries(state)) {
        for (const meta of metas) {
          const uid = String(meta.userId ?? '')
          if (!uid || uid === userId || seen.has(uid)) continue
          seen.add(uid)
          flat.push({
            userId: uid,
            displayName: (meta.displayName as string | null) ?? null,
            avatarUrl: (meta.avatarUrl as string | null) ?? null,
            lastSeenAt: Number(meta.lastSeenAt ?? Date.now()),
          })
        }
      }
      setPresence(flat)
    }

    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId,
            displayName,
            avatarUrl,
            lastSeenAt: Date.now(),
          })
        }
      })

    cleanupRef.current = () => {
      channel.untrack()
      supabase.removeChannel(channel)
    }
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [supabase, packetId, userId, displayName, avatarUrl])

  return presence
}
