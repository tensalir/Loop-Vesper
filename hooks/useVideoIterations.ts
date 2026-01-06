'use client'

import { useQuery } from '@tanstack/react-query'

export interface VideoIterationOutput {
  id: string
  fileUrl: string
  fileType: string
  width: number | null
  height: number | null
  duration: number | null
  createdAt: Date
}

export interface VideoIteration {
  id: string
  sessionId: string
  userId: string
  modelId: string
  prompt: string
  negativePrompt: string | null
  parameters: {
    aspectRatio?: string
    resolution?: number
    duration?: number
    sourceOutputId?: string
    referenceImageUrl?: string
  }
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  cost: number | null
  createdAt: Date
  session: {
    id: string
    name: string
    type: string
  }
  outputs: VideoIterationOutput[]
}

export interface VideoIterationsResponse {
  iterations: VideoIteration[]
  count: number
  hasProcessing: boolean
  latestStatus: string | null
  sourceOutputId: string
}

async function fetchVideoIterations(
  outputId: string,
  limit: number
): Promise<VideoIterationsResponse> {
  const response = await fetch(
    `/api/outputs/${outputId}/video-iterations?limit=${limit}`
  )
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${response.status}`)
  }
  
  return response.json()
}

/**
 * Hook to fetch video iterations (videos generated from a specific image output).
 * 
 * Features:
 * - Polls every 2s while any iteration is 'processing'
 * - Stops polling when all iterations are complete
 * - Uses generous staleTime to avoid request explosion in gallery views
 * 
 * @param outputId - The source image output ID
 * @param options.limit - Max iterations to fetch (default 10)
 * @param options.enabled - Whether to enable the query (default true)
 */
export function useVideoIterations(
  outputId: string | null,
  options: { limit?: number; enabled?: boolean } = {}
) {
  const { limit = 10, enabled = true } = options

  const query = useQuery({
    queryKey: ['videoIterations', outputId, limit],
    queryFn: () => fetchVideoIterations(outputId!, limit),
    enabled: !!outputId && enabled,
    staleTime: 1000 * 30, // 30s - generous to avoid request explosion in gallery
    gcTime: 1000 * 60 * 5, // 5 minutes
    // Smart polling: refetch every 2s while any iteration is processing
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.hasProcessing) {
        return 2000 // 2s polling while processing
      }
      return false // Stop polling when all done
    },
  })

  return {
    iterations: query.data?.iterations ?? [],
    count: query.data?.count ?? 0,
    latestStatus: query.data?.latestStatus ?? null,
    hasProcessing: query.data?.hasProcessing ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}

