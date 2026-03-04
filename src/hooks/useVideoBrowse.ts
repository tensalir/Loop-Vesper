import { useInfiniteQuery } from '@tanstack/react-query'
import { useCallback, useRef, useEffect } from 'react'

export interface BrowseVideo {
  id: string
  url: string
  prompt: string
  generationId: string
  sessionName?: string
  projectId?: string
  width: number | null
  height: number | null
  durationMs: number | null
  createdAt: string
}

interface ProjectVideosPage {
  data: BrowseVideo[]
  nextCursor: string | null
  hasMore: boolean
}

const PAGE_SIZE = 24

async function fetchProjectVideos({
  projectId,
  cursor,
}: {
  projectId: string
  cursor?: string
}): Promise<ProjectVideosPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (cursor) params.set('cursor', cursor)

  const response = await fetch(`/api/projects/${projectId}/videos?${params}`)
  if (!response.ok) throw new Error('Failed to fetch project videos')
  return response.json()
}

export function useProjectVideos(projectId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['project-videos', projectId],
    queryFn: ({ pageParam }) =>
      fetchProjectVideos({ projectId, cursor: pageParam as string | undefined }),
    enabled: !!projectId && enabled,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
}

export function useLoadMoreObserver(
  hasNextPage: boolean | undefined,
  isFetchingNextPage: boolean,
  fetchNextPage: () => void
) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  const observerCallback = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries
      if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  )

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(observerCallback, {
      rootMargin: '200px',
    })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [observerCallback])

  return sentinelRef
}
