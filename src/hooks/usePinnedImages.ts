import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export interface PinnedImage {
  id: string
  projectId: string
  imageUrl: string
  label: string | null
  sortOrder: number
  createdAt: string
  pinnedBy: string
  user: {
    id: string
    displayName: string | null
  }
}

async function fetchPinnedImages(projectId: string): Promise<PinnedImage[]> {
  const response = await fetch(`/api/projects/${projectId}/pinned-images`)
  
  if (!response.ok) {
    throw new Error('Failed to fetch pinned images')
  }
  
  const data = await response.json()
  return data.pinnedImages || []
}

async function pinImage(projectId: string, imageUrl: string, label?: string): Promise<PinnedImage> {
  const response = await fetch(`/api/projects/${projectId}/pinned-images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl, label }),
  })
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to pin image' }))
    throw new Error(error.error || 'Failed to pin image')
  }
  
  const data = await response.json()
  return data.pinnedImage
}

async function unpinImage(projectId: string, imageId: string): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/pinned-images/${imageId}`, {
    method: 'DELETE',
  })
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to unpin image' }))
    throw new Error(error.error || 'Failed to unpin image')
  }
}

export function usePinnedImages(projectId: string | undefined) {
  const queryClient = useQueryClient()
  
  const query = useQuery({
    queryKey: ['pinnedImages', projectId],
    queryFn: () => fetchPinnedImages(projectId!),
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  })
  
  const pinMutation = useMutation({
    mutationFn: ({ imageUrl, label }: { imageUrl: string; label?: string }) =>
      pinImage(projectId!, imageUrl, label),
    onSuccess: (newImage) => {
      // Optimistically add to cache
      queryClient.setQueryData<PinnedImage[]>(['pinnedImages', projectId], (old) =>
        old ? [...old, newImage] : [newImage]
      )
    },
    onError: () => {
      // Refetch on error to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['pinnedImages', projectId] })
    },
  })
  
  const unpinMutation = useMutation({
    mutationFn: (imageId: string) => unpinImage(projectId!, imageId),
    onMutate: async (imageId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['pinnedImages', projectId] })
      
      // Snapshot the previous value
      const previousImages = queryClient.getQueryData<PinnedImage[]>(['pinnedImages', projectId])
      
      // Optimistically update to remove the image
      queryClient.setQueryData<PinnedImage[]>(['pinnedImages', projectId], (old) =>
        old ? old.filter((img) => img.id !== imageId) : []
      )
      
      return { previousImages }
    },
    onError: (_err, _imageId, context) => {
      // Rollback on error
      if (context?.previousImages) {
        queryClient.setQueryData(['pinnedImages', projectId], context.previousImages)
      }
    },
    onSettled: () => {
      // Refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['pinnedImages', projectId] })
    },
  })
  
  return {
    pinnedImages: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    pinImage: pinMutation.mutate,
    unpinImage: unpinMutation.mutate,
    isPinning: pinMutation.isPending,
    isUnpinning: unpinMutation.isPending,
  }
}
