import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProductUpdate } from '@/lib/updates/types'

interface UpdatesListResponse {
  items: ProductUpdate[]
  nextCursor: string | null
}

async function fetchLatestUnseen(): Promise<ProductUpdate | null> {
  const res = await fetch('/api/updates/latest-unseen', { cache: 'no-store' })
  if (!res.ok) {
    // Treat any non-200 as "nothing to show". The popup is non-critical UX —
    // we never want a backend hiccup to block dashboard rendering.
    return null
  }
  const data = await res.json()
  return data.update as ProductUpdate | null
}

async function fetchUpdates(cursor?: string | null): Promise<UpdatesListResponse> {
  const url = new URL('/api/updates', window.location.origin)
  if (cursor) url.searchParams.set('cursor', cursor)
  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load updates')
  return res.json()
}

async function markUpdateSeen(updateId: string): Promise<void> {
  const res = await fetch(`/api/updates/${updateId}/seen`, { method: 'POST' })
  if (!res.ok) {
    // Don't throw — the modal closes optimistically and a transient failure
    // just means the user sees the popup again on next load.
    console.warn('Failed to mark update seen', updateId, await res.text())
  }
}

/** Tight-budget query for the login popup. Cached briefly so flipping between
 *  dashboard sub-pages doesn't refetch; refetched on window focus so a fresh
 *  release shows up in the same session. */
export function useLatestUnseenUpdate(enabled = true) {
  return useQuery({
    queryKey: ['updates', 'latest-unseen'],
    queryFn: fetchLatestUnseen,
    enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

export function useUpdatesList() {
  return useQuery({
    queryKey: ['updates', 'list'],
    queryFn: () => fetchUpdates(null),
    staleTime: 30 * 1000,
  })
}

export function useMarkUpdateSeen() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markUpdateSeen,
    onSuccess: () => {
      queryClient.setQueryData(['updates', 'latest-unseen'], null)
      queryClient.invalidateQueries({ queryKey: ['updates', 'list'] })
    },
  })
}
