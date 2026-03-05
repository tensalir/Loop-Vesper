import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

export interface ProjectOutput {
  id: string
  fileUrl: string
  fileType: 'image' | 'video'
  width: number | null
  height: number | null
  duration: number | null
  createdAt: string
  prompt: string
  generationId: string
  sessionId?: string
  sessionName: string
}

interface OutputsPage {
  data: ProjectOutput[]
  nextCursor: string | null
  hasMore: boolean
}

async function fetchOutputs(projectId: string, cursor?: string): Promise<OutputsPage> {
  const params = new URLSearchParams({ limit: '60' })
  if (cursor) params.set('cursor', cursor)
  const response = await fetch(`/api/projects/${projectId}/outputs?${params}`)
  if (!response.ok) throw new Error('Failed to fetch project outputs')
  return response.json()
}

export function useTimelineOutputs(projectId: string | null) {
  const query = useInfiniteQuery({
    queryKey: ['timeline-outputs', projectId],
    queryFn: ({ pageParam }) =>
      fetchOutputs(projectId!, pageParam as string | undefined),
    enabled: !!projectId,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const outputs = useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  )

  return {
    outputs,
    isLoading: query.isLoading,
    hasMore: query.hasNextPage,
    fetchMore: query.fetchNextPage,
    refetch: query.refetch,
  }
}
