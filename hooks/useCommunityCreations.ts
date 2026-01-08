import { useQuery } from '@tanstack/react-query'

export interface CommunityCreation {
  id: string
  fileUrl: string
  fileType: 'image' | 'video'
  width?: number | null
  height?: number | null
  duration?: number | null
  createdAt: string
  generation: {
    id: string
    prompt: string
    modelId: string
    parameters: Record<string, any>
    createdAt: string
    user: {
      id: string
      displayName: string | null
      username: string | null
      avatarUrl: string | null
    }
    session: {
      id: string
      name: string
      project: {
        id: string
        name: string
      }
    }
  }
}

async function fetchCommunityCreations(limit: number = 8): Promise<CommunityCreation[]> {
  const response = await fetch(`/api/outputs/community?limit=${limit}`)
  if (!response.ok) {
    throw new Error('Failed to fetch community creations')
  }
  return response.json()
}

export function useCommunityCreations(limit: number = 8) {
  return useQuery({
    queryKey: ['communityCreations', limit],
    queryFn: () => fetchCommunityCreations(limit),
    // We want this to feel “live”: newest prompts should appear quickly.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  })
}
