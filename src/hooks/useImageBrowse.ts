import { useInfiniteQuery } from '@tanstack/react-query'
import { useCallback, useRef, useEffect } from 'react'

// ----- Types -----

export interface BrowseImage {
  id: string
  url: string
  prompt: string
  generationId: string
  sessionName?: string
  projectId?: string
  projectName?: string
  width: number | null
  height: number | null
  createdAt: string
}

interface ProjectImagesPage {
  data: BrowseImage[]
  nextCursor: string | null
  hasMore: boolean
}

interface CrossProjectImagesPage {
  data: BrowseImage[]
  projects: Array<{ id: string; name: string }>
  nextCursor: string | null
  hasMore: boolean
}

// ----- Fetch Functions -----

const PAGE_SIZE = 40

async function fetchProjectImages({
  projectId,
  cursor,
}: {
  projectId: string
  cursor?: string
}): Promise<ProjectImagesPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (cursor) params.set('cursor', cursor)

  const response = await fetch(`/api/projects/${projectId}/images?${params}`)
  if (!response.ok) throw new Error('Failed to fetch project images')
  return response.json()
}

async function fetchAllImages({
  cursor,
  projectId,
}: {
  cursor?: string
  projectId?: string
}): Promise<CrossProjectImagesPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (cursor) params.set('cursor', cursor)
  if (projectId) params.set('projectId', projectId)

  const response = await fetch(`/api/images/browse?${params}`)
  if (!response.ok) throw new Error('Failed to browse images')
  return response.json()
}

// ----- Hooks -----

/**
 * Infinite query for browsing images within the current project.
 */
export function useProjectImages(projectId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['project-images', projectId],
    queryFn: ({ pageParam }) =>
      fetchProjectImages({ projectId, cursor: pageParam as string | undefined }),
    enabled: !!projectId && enabled,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined),
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
}

/**
 * Infinite query for browsing images across all accessible projects.
 * Optionally filter by a specific project.
 */
export function useCrossProjectImages(enabled: boolean, filterProjectId?: string) {
  return useInfiniteQuery({
    queryKey: ['cross-project-images', filterProjectId ?? 'all'],
    queryFn: ({ pageParam }) =>
      fetchAllImages({ cursor: pageParam as string | undefined, projectId: filterProjectId }),
    enabled,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
}

/**
 * Intersection observer hook for infinite scroll "load more" triggers.
 * Returns a ref to attach to a sentinel element at the bottom of the list.
 */
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
      rootMargin: '200px', // Start loading 200px before the sentinel is visible
    })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [observerCallback])

  return sentinelRef
}
