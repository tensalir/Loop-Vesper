import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { BrandWorldOutput } from '@/lib/brand-world/placement'

interface OutputsPage {
  data: BrandWorldOutput[]
  nextCursor: string | null
  hasMore: boolean
}

async function fetchProjectOutputs({
  projectId,
  cursor,
}: {
  projectId: string
  cursor?: string
}): Promise<OutputsPage> {
  const params = new URLSearchParams({ limit: '60' })
  if (cursor) params.set('cursor', cursor)

  const response = await fetch(`/api/projects/${projectId}/outputs?${params}`)
  if (!response.ok) throw new Error('Failed to fetch project outputs')
  return response.json()
}

export function useProjectOutputs(projectId: string | null) {
  const query = useInfiniteQuery({
    queryKey: ['brand-world-outputs', projectId],
    queryFn: ({ pageParam }) =>
      fetchProjectOutputs({ projectId: projectId!, cursor: pageParam as string | undefined }),
    enabled: !!projectId,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const outputs = useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data]
  )

  return {
    outputs,
    isLoading: query.isLoading,
    hasMore: query.hasNextPage,
    fetchMore: query.fetchNextPage,
    refetch: query.refetch,
  }
}
