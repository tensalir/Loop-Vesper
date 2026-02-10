import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { Project } from '@/types/project'

interface ProjectsResponse {
  data: Array<Project & { thumbnailUrl?: string | null }>
  nextCursor: string | null
  hasMore: boolean
}

async function fetchProjects(): Promise<(Project & { thumbnailUrl?: string | null })[]> {
  // Ensure we don't read a cached HTTP response after mutations (e.g. delete).
  const response = await fetch('/api/projects/with-thumbnails', { cache: 'no-store' })
  
  if (!response.ok) {
    throw new Error('Failed to fetch projects')
  }
  
  const json = await response.json() as ProjectsResponse
  
  // Parse dates from strings to Date objects
  return json.data.map((p: any) => ({
    ...p,
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  }))
}

type ProjectsPage = ProjectsResponse

async function fetchProjectsPage({
  pageParam,
  pageSize,
}: {
  pageParam: string | null
  pageSize: number
}): Promise<ProjectsPage> {
  const searchParams = new URLSearchParams()
  searchParams.set('limit', String(pageSize))
  if (pageParam) {
    searchParams.set('cursor', pageParam)
  }

  const response = await fetch(`/api/projects/with-thumbnails?${searchParams.toString()}`, {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('Failed to fetch projects')
  }

  const json = await response.json() as ProjectsResponse

  return {
    ...json,
    data: json.data.map((p: any) => ({
      ...p,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
    })),
  }
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 5 * 60 * 1000, // 5 minutes - projects rarely change
    gcTime: 30 * 60 * 1000, // 30 minutes - keep in memory for faster navigation
    refetchOnMount: false, // Use cached data if fresh (within staleTime)
    refetchOnWindowFocus: false, // Don't refetch on window focus
  })
}

export function useProjectsInfinite(pageSize = 20) {
  const query = useInfiniteQuery({
    queryKey: ['projects', 'infinite', pageSize],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchProjectsPage({ pageParam, pageSize }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : null),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  return {
    ...query,
    projects: query.data?.pages.flatMap((page) => page.data) ?? [],
  }
}

